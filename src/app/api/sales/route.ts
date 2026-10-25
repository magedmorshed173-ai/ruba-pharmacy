import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";
import { toInt } from "@/lib/money";
import { allocateFefo } from "@/lib/fefo";
import {
  reviewCartClinical,
  type ClinicalReview,
} from "@/lib/clinical-review";

interface CheckoutItem {
  barcode?: string;
  medicineId?: string;
  quantity: number;
}

/**
 * POST /api/sales — إتمام البيع (عملية ذرّية)
 * الإصلاحات مقابل v2.0:
 *  - معاملة ذرّية واحدة (بيع + بنود + خصم مخزون + حركات تدقيق)
 *  - Idempotency عبر reference فريد (محمي بقيود قاعدة البيانات)
 *  - فحص صلاحية + وفرة + صرف FEFO
 * الإضافات السريرية v3.5:
 *  - بوابة سلامة دوائية: «ممنوع سريرياً» وتعارض الحساسية يحجبان البيع
 *    (الفني محجوب دائماً؛ الصيدلي/المدير يتجاوز بـ clinicalOverride المسؤول)
 *  - مراجعة سريرية كاملة في الاستجابة: تداخلات + حساسية + علاج مكرر
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  try {
    const body = await request.json();
    const items: CheckoutItem[] = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return fail("السلة فارغة");

    const reference =
      String(body.transactionId ?? "").trim() ||
      `POS-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const patientId = String(body.patientId ?? "").trim() || null;
    const clinicalOverride = body.clinicalOverride === true;

    // Idempotency: إن كانت العملية مسجلة مسبقاً أعدها دون تكرار
    const existing = await db.sale.findUnique({
      where: { reference },
      include: { items: true },
    });
    if (existing) {
      return ok({
        duplicated: true,
        saleId: existing.id,
        reference: existing.reference,
        netAmount: existing.netAmount,
        message: "هذه العملية مسجلة مسبقاً",
      });
    }

    // ── المراجعة السريرية الشاملة (تحذير + بوابة حجب) ──
    const reviewKeys = items.map((i) =>
      i.barcode ? { barcode: String(i.barcode).trim() } : { id: String(i.medicineId) }
    );
    const reviewMeds = await db.medicine.findMany({
      where: { OR: reviewKeys, isActive: true },
      select: { id: true, name: true, genericName: true, atcClass: true },
    });
    const clinicalReview = await reviewCartClinical(reviewMeds, patientId ?? undefined);
    if (clinicalReview.blocking) {
      if (user.role === "technician") {
        return fail(
          "يوجد ممنوع سريرياً أو تعارض حساسية في السلة — يجب مراجعة صيدلي قبل الإتمام",
          403,
          { clinicalBlock: true, clinicalReview }
        );
      }
      if (!clinicalOverride) {
        return fail(
          "تعارض سريري خطر — يتطلب تأكيد تجاوز مسؤول من الصيدلي",
          409,
          { clinicalBlock: true, clinicalReview }
        );
      }
    }

    const discount = Math.max(0, toInt(body.discount ?? 0)); // هللات
    const customerName = String(body.customerName ?? "").trim() || "عميل نقدي";
    const customerPhone = String(body.customerPhone ?? "").trim() || null;
    const paymentMethod = ["cash", "card", "insurance"].includes(body.paymentMethod)
      ? body.paymentMethod
      : "cash";

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      const sale = await db.$transaction(
        async (tx) => {
          const keys = items.map((i) =>
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
          const batchDeductions: {
            batchId: string;
            newBatchQty: number;
          }[] = [];

          for (const item of items) {
            const qty = toInt(item.quantity, 0);
            if (qty <= 0) throw new Error("كمية غير صحيحة");

            const med = item.barcode
              ? medMap.get(String(item.barcode).trim())
              : idMap.get(String(item.medicineId));
            if (!med) throw new Error(`دواء غير موجود في السلة`);
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
                shortfall > 0 && sellable === 0
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
              customerName,
              customerPhone,
              itemsCount: prepared.length,
              totalAmount: total,
              discount,
              netAmount: net,
              paymentMethod,
              reference,
              userId: user.id,
              patientId: clinicalReview.patient?.id ?? null,
              patientName: clinicalReview.patient?.name ?? null,
              clinicalOverride: clinicalReview.blocking && clinicalOverride,
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
                reference,
                userId: user.id,
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
                expiryDate: nearest
                  ? nearest.expiryDate
                  : new Date(0), // لا مخزون متبقٍّ
              },
            });
          }

          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      const full = await db.sale.findUnique({
        where: { id: sale.id },
        include: {
          items: { include: { medicine: { select: { barcode: true, quantity: true } } } },
          user: { select: { username: true, fullName: true } },
        },
      });

      return ok(
        {
          duplicated: false,
          saleId: sale.id,
          reference: sale.reference,
          netAmount: sale.netAmount,
          interactionWarnings: clinicalReview.interactions,
          clinicalReview,
          message: "تم البيع بنجاح",
          sale: full,
        },
        201
      );
    } catch (e) {
      // سباق التزامن: إن سجلت معاملة أخرى نفس المرجع — أعدacedها
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const dup = await db.sale.findUnique({ where: { reference } });
        return ok({ duplicated: true, saleId: dup?.id, reference, message: "عملية مكررة" });
      }
      const msg = e instanceof Error ? e.message : "تعذر إتمام البيع";
      return fail(msg);
    }
  } catch {
    return fail("طلب غير صالح", 400);
  }
}

// GET /api/sales?q=&page=&pageSize=&days= — سجل المبيعات
export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const page = Math.max(1, toInt(sp.get("page"), 1));
  const pageSize = Math.min(100, Math.max(5, toInt(sp.get("pageSize"), 15)));

  const where: Record<string, unknown> = {};
  if (q)
    where.OR = [
      { reference: { contains: q } },
      { customerName: { contains: q } },
      { customerPhone: { contains: q } },
    ];

  try {
    const [total, sales] = await Promise.all([
      db.sale.count({ where }),
      db.sale.findMany({
        where,
        include: {
          items: true,
          user: { select: { username: true, fullName: true } },
        },
        orderBy: { saleDate: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return ok({ total, page, pageSize, sales });
  } catch {
    return fail("تعذر جلب المبيعات", 500);
  }
}
