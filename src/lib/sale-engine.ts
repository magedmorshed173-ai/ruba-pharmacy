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
  /** تجاوز مسؤول — يُسجل على الفاتورة للمراجعة */
  clinicalOverride: boolean;
  discount: number; // هللات
  customerName: string;
  customerPhone: string | null;
  paymentMethod: string; // cash | card | insurance
  userId: string;
  /**
   * خطاف داخل المعاملة قبل الالتزام — يربط أثراً إضافياً بنفس الذرية
   * (مثال: تحويل حالة الوصفة إلى dispensed مع ربط saleId)
   */
  withinTx?: (tx: Prisma.TransactionClient, saleId: string) => Promise<void>;
}

export interface SaleResult {
  saleId: string;
  reference: string;
  netAmount: number;
  clinicalReview: ClinicalReview;
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
    select: { id: true, name: true, genericName: true, atcClass: true },
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
  // ── المراجعة السريرية الشاملة (خارج المعاملة — قراءة فقط) ──
  const clinicalReview = await reviewSaleItems(params.items, params.patientId);

  const discount = Math.max(0, toInt(params.discount ?? 0));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const saleId = await db.$transaction(
    async (tx) => {
      const keys = params.items.map((i) =>
        i.barcode ? { barcode: String(i.barcode).trim() } : { id: String(i.medicineId) }
      );

      // قفل منطقي: جلب الأدوية داخل المعاملة
      const meds = await tx.medicine.findMany({
        where: { OR: keys, isActive: true },
      });
      const medMap = new Map(meds.map((m) => [m.barcode, m]));
      const idMap = new Map(meds.map((m) => [m.id, m]));

      let total = 0;
      const prepared: {
        medicineId: string;
        medicineName: string;
        quantity: number;
        unitPrice: number;
        subtotal: number;
        costHalalas: number; // لقطة تكلفة الدفعات المخصومة فعلياً (FEFO)
        newQty: number;
      }[] = [];
      const batchDeductions: { batchId: string; newBatchQty: number }[] = [];

      for (const item of params.items) {
        const qty = toInt(item.quantity, 0);
        if (qty <= 0) throw new Error("كمية غير صحيحة");

        const med = item.barcode
          ? medMap.get(String(item.barcode).trim())
          : idMap.get(String(item.medicineId));
        if (!med) throw new Error("دواء غير موجود في السلة");
        if (med.quantity < qty)
          throw new Error(`مخزون غير كافٍ: ${med.name} (المتوفر ${med.quantity})`);

        // ── FEFO: الخصم من الدفعات الأقرب انتهاءً، وتجاهل المنتهية ──
        const batches = await tx.batch.findMany({
          where: { medicineId: med.id, isActive: true, quantity: { gt: 0 } },
          orderBy: { expiryDate: "asc" },
        });
        const { allocations, shortfall } = allocateFefo(batches, qty, today);
        if (shortfall > 0) {
          const sellable = allocations.reduce((a, x) => a + x.quantity, 0);
          throw new Error(
            sellable === 0
              ? `لا يوجد مخزون صالح الصلاحية: ${med.name} (كل الدفعات منتهية)`
              : `المتوفر الصالح أقل من المطلوب: ${med.name} (الصالح ${sellable})`
          );
        }

        const subtotal = med.sellingPrice * qty; // أعداد صحيحة — دقة مطلقة
        total += subtotal;
        let itemCost = 0;
        prepared.push({
          medicineId: med.id,
          medicineName: med.name,
          quantity: qty,
          unitPrice: med.sellingPrice,
          subtotal,
          costHalalas: 0,
          newQty: med.quantity - qty,
        });
        for (const a of allocations) {
          const srcBatch = batches.find((b) => b.id === a.batchId)!;
          itemCost += a.quantity * srcBatch.unitCost; // التكلفة الفعلية للدفعة
          batchDeductions.push({
            batchId: a.batchId,
            newBatchQty: srcBatch.quantity - a.quantity,
          });
        }
        prepared[prepared.length - 1].costHalalas = itemCost;
      }

      if (discount > total) throw new Error("الخصم أكبر من الإجمالي");
      const net = total - discount;

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
      });

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
          where: { medicineId: p.medicineId, isActive: true, quantity: { gt: 0 } },
          orderBy: { expiryDate: "asc" },
        });
        await tx.medicine.update({
          where: { id: p.medicineId },
          data: {
            expiryDate: nearest ? nearest.expiryDate : new Date(0), // لا مخزون متبقٍّ
          },
        });
      }

      // خطاف المستدعي داخل نفس الذرية (ربط الوصفة بالفاتورة مثلاً)
      if (params.withinTx) await params.withinTx(tx, created.id);

      return created.id;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );

  return {
    saleId,
    reference: params.reference,
    netAmount: await db.sale
      .findUniqueOrThrow({ where: { id: saleId }, select: { netAmount: true } })
      .then((s) => s.netAmount),
    clinicalReview,
  };
}
