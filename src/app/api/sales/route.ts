import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";
import { toInt } from "@/lib/money";
import { allocateFefo } from "@/lib/fefo";

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
 *  - فحص صلاحية + وفرة + تداخلات دوائية داخل السلة
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

    // تداخلات دوائية داخل السلة (تحذير غير معطِّل)
    const interactionWarnings = await checkCartInteractions(items);

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
          interactionWarnings,
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

/** فحص التداخلات الدوائية بين بنود السلة */
async function checkCartInteractions(items: CheckoutItem[]) {
  const keys = items.map((i) =>
    i.barcode ? { barcode: String(i.barcode).trim() } : { id: String(i.medicineId) }
  );
  if (keys.length < 2) return [];
  const meds = await db.medicine.findMany({
    where: { OR: keys, isActive: true },
    select: { genericName: true, name: true },
  });
  const generics = Array.from(
    new Set(meds.map((m) => m.genericName.toLowerCase()).filter(Boolean))
  );
  if (generics.length < 2) return [];

  const hits = await db.drugInteraction.findMany({
    where: { isActive: true, genericA: { in: generics }, genericB: { in: generics } },
  });

  // تجاهل التداخل الذاتي (نفس المادة)
  return hits
    .filter((h) => h.genericA.toLowerCase() !== h.genericB.toLowerCase())
    .map((h) => ({
      genericA: h.genericA,
      genericB: h.genericB,
      severity: h.severity,
      description: h.description,
      management: h.management,
    }));
}
