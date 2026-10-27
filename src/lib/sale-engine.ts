/**
 * محرك البيع الذري — v3.6
 * المسار الوحيد لكل خصم مخزون في النظام: نقطة البيع الحرة وصرف الوصفات المحققة
 * يجريان عبر هذا المحرك نفسه — بلا تكرار لمنطق FEFO أو الدفتر أو لقطات التكلفة.
 *
 * الضمانات (مُختبرة حياً في tests/e2e):
 *  - معاملة Serializable واحدة: بيع + بنود + خصم دفعات FEFO + حركات StockMovement
 *  - Idempotency عبر reference فريد (قيد قاعدة البيانات)
 *  - مراجعة سريرية كاملة تعاد مع كل نداء (تداخلات + حساسية + تكرار ATC + جرعة قصوى)
 *  - لقطة تكلفة فعلية لكل بند (أساس تقارير الأرباح الدقيقة)
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { toInt } from "@/lib/money";
import { allocateFefo } from "@/lib/fefo";
import {
  reviewCartClinical,
  type ClinicalReview,
} from "@/lib/clinical-review";
import { isRegistryHardBlock } from "@/lib/registry";
import { isLicenseHardBlock, parseLicenseStatus } from "@/lib/national-license";
import {
  assertAvailable,
  mapActiveReservations,
} from "@/lib/reservations";
import { splitInsurancePayment } from "@/lib/insurance";
import {
  buildSimplifiedQr,
  formatInvoiceNumber,
  netOfVat,
  vatFromInclusive,
  ZATCA_VAT_RATE,
  type ZatcaSeller,
} from "@/lib/zatca";

/** خطأ حجب تنظيمي — تُحوّله المسارات إلى 409 مع علم registryBlock */
export class RegistryBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryBlockError";
  }
}

export interface SaleItemInput {
  barcode?: string;
  medicineId?: string;
  quantity: number;
}

export interface CreateSaleParams {
  items: SaleItemInput[];
  /** معرف فريد للعملية — التكرار محجوب بقيد قاعدة البيانات */
  reference: string;
  patientId: string | null;
  /** تجاوز مسؤول — يُسجل على الفاتورة للمراجعة (سريري فقط — التنظيمي بلا تجاوز) */
  clinicalOverride: boolean;
  discount: number; // هللات
  customerName: string;
  customerPhone: string | null;
  paymentMethod: string; // cash | card | insurance
  userId: string;
  /**
   * صرف وصفة؟ حجوزات هذه الوصفة لا تُحسب ضدها (وحداتها موعودة لها أصلاً)
   */
  excludeReservationFor?: string;
  /**
   * v4.6 — فرع الصادر منه البيع (اختياري — يُحلّ من الموظف في المسار)
   */
  branchId?: string | null;
  /**
   * v4.6 — تأمين طبي: تقسيم المطلوب وفتح مطالبة تلقائية.
   * تُحلّ البوليصة وتُفحص صلاحيتها في المسار (خدمياً — لا تُؤمَن قيم العميل)،
   * والمحرك يعتمد القيم المحسوبة ويربطها بالفاتورة.
   */
  insurance?: {
    policyId: string;
    providerId: string;
    coverageBps: number;
    copayFixed?: number | null;
  };
  /**
   * خطاف داخل المعاملة قبل الالتزام — يربط أثراً إضافياً بنفس الذرية
   * (مثال: تحويل حالة الوصفة إلى dispensed مع ربط saleId)
   */
  withinTx?: (tx: Prisma.TransactionClient, saleId: string) => Promise<void>;
  /**
   * v4.5 — هوية البائع الضريبية (ZATCA). تُحسب حقول الضريبة دائماً حتى بلا هوية؛
   * أما رقم الفاتورة التسلسلي وQR فيُولَّدان فقط عند توفرها (env: ZATCA_VAT_NUMBER).
   */
  zatca?: { seller: ZatcaSeller; vatRate?: number };
}

export interface SaleResult {
  saleId: string;
  reference: string;
  netAmount: number;
  clinicalReview: ClinicalReview;
  /** v4.5 — ZATCA: تفاصيل الفاتورة الضريبية للإيصال */
  vatRate: number;
  vatTotal: number;
  netOfVat: number;
  invoiceNumber: string | null;
  zatcaQr: string | null;
  /** v4.6 — التأمين: تقسيم المطلوب وحالة المطالبة */
  insurerAmount: number;
  patientAmount: number;
  claimStatus: string | null;
}

/** مراجعة سريرية لبنود بيع/وصفة — تُستدعى قبل الإتمام وفي تفاصيل طابور التحقق */
export async function reviewSaleItems(
  items: SaleItemInput[],
  patientId: string | null
): Promise<ClinicalReview> {
  const reviewKeys = items.map((i) =>
    i.barcode ? { barcode: String(i.barcode).trim() } : { id: String(i.medicineId) }
  );
  const reviewMeds = await db.medicine.findMany({
    where: { OR: reviewKeys, isActive: true },
    select: {
      id: true,
      name: true,
      genericName: true,
      atcClass: true,
      registryStatus: true,
      registrationNo: true,
      sellingPrice: true,
      maxRetailPrice: true,
      // v4.1 — مفاتيح المطابقة مع السجل الوطني المرخص
      barcode: true,
      dosage: true,
      nationalDrugId: true,
      // v4.3 — بوابة المريض الخاصة (حمل/عمر)
      pregnancyCategory: true,
      minAge: true,
    },
  });
  return reviewCartClinical(reviewMeds, patientId ?? undefined);
}

/** تحقق شكل بنود البيع قبل أي معالجة */
export function parseSaleItems(raw: unknown): SaleItemInput[] | null {
  const items = Array.isArray(raw) ? raw : [];
  if (items.length === 0) return null;
  return items as SaleItemInput[];
}

/**
 * تنفيذ البيع الذري الكامل. يرمي Error برسالة عربية عند نقص المخزون
 * أو خصم أكبر من الإجمالي أو بنود غير صحيحة — المستدعي يحوّلها لاستجابة.
 */
export async function createSale(params: CreateSaleParams): Promise<SaleResult> {
  // ── المراجعة السريرية والتنظيمية الشاملة (خارج المعاملة — قراءة فقط) ──
  const clinicalReview = await reviewSaleItems(params.items, params.patientId);

  // الحجب التنظيمي المطلق (معلق/محظور) — لا تجاوز له حتى للصيدلي
  if (clinicalReview.registryBlocking) {
    const first = clinicalReview.registryAlerts.find((a) => a.blocking);
    throw new RegistryBlockError(first?.message ?? "دواء محجوب تنظيمياً");
  }

  const discount = Math.max(0, toInt(params.discount ?? 0));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const txResult = await db.$transaction(
    async (tx) => {
      const keys = params.items.map((i) =>
        i.barcode ? { barcode: String(i.barcode).trim() } : { id: String(i.medicineId) }
      );

      // قفل منطقي: جلب الأدوية داخل المعاملة (مع سجل الترخيص الوطني المرتبط)
      const meds = await tx.medicine.findMany({
        where: { OR: keys, isActive: true },
        include: {
          nationalDrug: { select: { licenseStatus: true, tradeName: true } },
        },
      });
      const medMap = new Map(meds.map((m) => [m.barcode, m]));
      const idMap = new Map(meds.map((m) => [m.id, m]));

      // حجب تنظيمي حارس سباق: الحالة قد تغيّر بين المراجعة والمعاملة
      for (const med of meds) {
        if (isRegistryHardBlock(med.registryStatus))
          throw new RegistryBlockError(
            `«${med.name}» محجوب تنظيمياً من السجل الوطني — لا يُصرف`
          );
        // v4.1 — حجب تلقائي للترخيص المسحوب/المعلق (حتى لو لم تُنفّذ مزامنة الحالة بعد)
        if (med.nationalDrug && isLicenseHardBlock(med.nationalDrug.licenseStatus)) {
          const lic = parseLicenseStatus(med.nationalDrug.licenseStatus);
          throw new RegistryBlockError(
            lic === "withdrawn"
              ? `«${med.name}» مسحوب من السوق بقرار الهيئة — حجب تلقائي ولا يُصرف`
              : `ترخيص «${med.name}» معلق لدى الهيئة — الحجب تلقائي ولا يُصرف`
          );
        }
      }

      // المحجوز للوصفات الأخرى قيد الطابور — حماية الوحدات الموعودة
      const reservedMap = await mapActiveReservations(
        tx,
        meds.map((m) => m.id),
        params.excludeReservationFor
      );

      let total = 0;
      const prepared: {
        medicineId: string;
        medicineName: string;
        quantity: number;
        unitPrice: number;
        subtotal: number;
        costHalalas: number; // لقطة تكلفة الدفعات المخصومة فعلياً (FEFO)
        newQty: number;
        batchAllocations: { batchId: string; lotNumber: string; quantity: number }[];
      }[] = [];
      const batchDeductions: { batchId: string; newBatchQty: number }[] = [];

      for (const item of params.items) {
        const qty = toInt(item.quantity, 0);
        if (qty <= 0) throw new Error("كمية غير صحيحة");

        const med = item.barcode
          ? medMap.get(String(item.barcode).trim())
          : idMap.get(String(item.medicineId));
        if (!med) throw new Error("دواء غير موجود في السلة");

        // المتاح = الرصيد − المحجوز لوصفات أخرى (الحجز يسبق فحص الرصيد الخام)
        assertAvailable(
          med.name,
          qty,
          med.quantity,
          reservedMap.get(med.id) ?? 0
        );

        // ── FEFO: الخصم من الدفعات الأقرب انتهاءً، تجاهل المنتهية والمسحوبة ──
        const batches = await tx.batch.findMany({
          where: {
            medicineId: med.id,
            isActive: true,
            isRecalled: false,
            quantity: { gt: 0 },
          },
          orderBy: { expiryDate: "asc" },
        });
        const { allocations, shortfall } = allocateFefo(batches, qty, today);
        if (shortfall > 0) {
          const sellable = allocations.reduce((a, x) => a + x.quantity, 0);
          if (sellable === 0) {
            // تمييز سبب النضوب: دفعات مسحوبة تنظيمياً ≠ دفعات منتهية الصلاحية
            const recalledStock = await tx.batch.aggregate({
              where: {
                medicineId: med.id,
                isActive: true,
                isRecalled: true,
                quantity: { gt: 0 },
              },
              _sum: { quantity: true },
            });
            if ((recalledStock._sum.quantity ?? 0) > 0)
              throw new Error(
                `لا يوجد مخزون صالح للصرف: ${med.name} (كل الدفعات المتاحة مسحوبة من التداول بقرار تنظيمي)`
              );
            throw new Error(
              `لا يوجد مخزون صالح الصلاحية: ${med.name} (كل الدفعات منتهية)`
            );
          }
          throw new Error(
            `المتوفر الصالح أقل من المطلوب: ${med.name} (الصالح ${sellable})`
          );
        }

        const subtotal = med.sellingPrice * qty; // أعداد صحيحة — دقة مطلقة
        total += subtotal;
        let itemCost = 0;
        const itemAllocations: { batchId: string; lotNumber: string; quantity: number }[] = [];
        prepared.push({
          medicineId: med.id,
          medicineName: med.name,
          quantity: qty,
          unitPrice: med.sellingPrice,
          subtotal,
          costHalalas: 0,
          newQty: med.quantity - qty,
          batchAllocations: itemAllocations,
        });
        for (const a of allocations) {
          const srcBatch = batches.find((b) => b.id === a.batchId)!;
          itemCost += a.quantity * srcBatch.unitCost; // التكلفة الفعلية للدفعة
          itemAllocations.push({
            batchId: a.batchId,
            lotNumber: a.lotNumber,
            quantity: a.quantity,
          });
          batchDeductions.push({
            batchId: a.batchId,
            newBatchQty: srcBatch.quantity - a.quantity,
          });
        }
        prepared[prepared.length - 1].costHalalas = itemCost;
      }

      if (discount > total) throw new Error("الخصم أكبر من الإجمالي");
      const net = total - discount;

      // ── v4.6 — التأمين: تقسيم المطلوب + فتح مطالبة تلقائياً ──
      const ins = params.insurance;
      const split = ins
        ? splitInsurancePayment(net, ins.coverageBps, ins.copayFixed)
        : { insurerDue: 0, patientDue: net };

      // ── v4.5 — ZATCA: الضريبة ضمن الإجمالي + ترقيم تسلسلي ذري ──
      const vatRate = params.zatca?.vatRate ?? ZATCA_VAT_RATE;
      const vatTotal = vatFromInclusive(net, vatRate);
      const netOfVatValue = netOfVat(net, vatTotal);
      let invoiceNumber: string | null = null;
      if (params.zatca) {
        // زيادة ذرية ببيان واحد — السباقان يحصلان على رقمن مختلفين بلا قفل
        const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
          INSERT INTO "InvoiceCounter" ("year", "lastNumber") VALUES (${today.getFullYear()}, 1)
          ON CONFLICT ("year") DO UPDATE SET "lastNumber" = "InvoiceCounter"."lastNumber" + 1
          RETURNING "lastNumber"
        `;
        invoiceNumber = formatInvoiceNumber(today.getFullYear(), rows[0].lastNumber);
      }

      const created = await tx.sale.create({
        data: {
          customerName: params.customerName,
          customerPhone: params.customerPhone,
          itemsCount: prepared.length,
          totalAmount: total,
          discount,
          netAmount: net,
          paymentMethod: params.paymentMethod,
          reference: params.reference,
          userId: params.userId,
          patientId: clinicalReview.patient?.id ?? params.patientId,
          patientName: clinicalReview.patient?.name ?? null,
          clinicalOverride: clinicalReview.blocking && params.clinicalOverride,
          vatRate,
          vatTotal,
          netOfVat: netOfVatValue,
          invoiceNumber,
          zatcaQr: params.zatca
            ? buildSimplifiedQr({
                seller: params.zatca.seller,
                issuedAt: today,
                totalHalalas: net,
                vatHalalas: vatTotal,
              })
            : null,
          insuranceProviderId: ins?.providerId ?? null,
          insurancePolicyId: ins?.policyId ?? null,
          insurerAmount: split.insurerDue,
          patientAmount: split.patientDue,
          claimStatus: ins ? "pending" : null,
          branchId: params.branchId ?? null,
          items: {
            create: prepared.map((p) => ({
              medicineId: p.medicineId,
              medicineName: p.medicineName,
              quantity: p.quantity,
              unitPrice: p.unitPrice,
              subtotal: p.subtotal,
              costHalalas: p.costHalalas,
            })),
          },
        },
        include: { items: { select: { id: true } } },
      });

      // تتبع دفعات الصرف — أي LOT صُرف منه في أي فاتورة
      // (أساس التتبع الأمامي عند سحب دفعة — نمط GS1 Track & Trace)
      const itemIds = created.items.map((i) => i.id);
      for (let idx = 0; idx < prepared.length; idx++) {
        const allocs = prepared[idx].batchAllocations;
        for (const a of allocs) {
          await tx.saleItemBatch.create({
            data: {
              saleItemId: itemIds[idx],
              batchId: a.batchId,
              lotNumber: a.lotNumber,
              quantity: a.quantity,
            },
          });
        }
      }

      for (const p of prepared) {
        await tx.medicine.update({
          where: { id: p.medicineId },
          data: { quantity: p.newQty },
        });
        await tx.stockMovement.create({
          data: {
            medicineId: p.medicineId,
            type: "sale",
            delta: -p.quantity,
            balanceAfter: p.newQty,
            reference: params.reference,
            userId: params.userId,
          },
        });
      }
      // خصم الكميات من الدفعات نفسها (FEFO)
      for (const d of batchDeductions) {
        await tx.batch.update({
          where: { id: d.batchId },
          data: { quantity: d.newBatchQty },
        });
      }
      // مزامنة «أقرب صلاحية» على مستوى الدواء مع الدفعات المتبقية
      for (const p of prepared) {
        const nearest = await tx.batch.findFirst({
          where: {
            medicineId: p.medicineId,
            isActive: true,
            isRecalled: false,
            quantity: { gt: 0 },
          },
          orderBy: { expiryDate: "asc" },
        });
        await tx.medicine.update({
          where: { id: p.medicineId },
          data: {
            expiryDate: nearest ? nearest.expiryDate : new Date(0), // لا مخزون متبقٍّ قابل للصرف
          },
        });
      }

      // خطاف المستدعي داخل نفس الذرية (ربط الوصفة بالفاتورة مثلاً)
      if (params.withinTx) await params.withinTx(tx, created.id);

      return {
        id: created.id,
        netAmount: created.netAmount,
        invoiceNumber: created.invoiceNumber,
        zatcaQr: created.zatcaQr,
        vatRate,
        vatTotal,
        netOfVat: netOfVatValue,
        insurerAmount: split.insurerDue,
        patientAmount: split.patientDue,
        claimStatus: ins ? "pending" : null,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );

  return {
    saleId: txResult.id,
    reference: params.reference,
    netAmount: txResult.netAmount,
    clinicalReview,
    vatRate: txResult.vatRate,
    vatTotal: txResult.vatTotal,
    netOfVat: txResult.netOfVat,
    invoiceNumber: txResult.invoiceNumber,
    zatcaQr: txResult.zatcaQr,
    insurerAmount: txResult.insurerAmount,
    patientAmount: txResult.patientAmount,
    claimStatus: txResult.claimStatus,
  };
}
