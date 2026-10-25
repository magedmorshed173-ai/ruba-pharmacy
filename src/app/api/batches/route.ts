import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth, requireRole } from "@/lib/api-guard";
import { toInt } from "@/lib/money";

/**
 * GET /api/batches?medicineId=&soon=30 — قائمة الدفعات
 *   بدون medicineId: كل الدفعات النشطة (للتقارير)
 *   soon=N: الدفعات التي تنتهي خلال N يوماً
 *   expired=1: الدفعات المنتهية فقط
 * POST — إضافة دفعة جديدة (صيدلي فما فوق)
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const medicineId = sp.get("medicineId")?.trim();
  const soon = sp.get("soon");
  const expired = sp.get("expired");

  const where: Record<string, unknown> = { isActive: true };
  if (medicineId) where.medicineId = medicineId;
  if (soon) {
    const days = Math.max(1, Math.min(365, toInt(soon, 30)));
    const until = new Date(Date.now() + days * 86400000);
    where.expiryDate = { lte: until };
  }
  if (expired === "1") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    where.expiryDate = { lte: today };
  }

  try {
    const batches = await db.batch.findMany({
      where,
      include: {
        medicine: {
          select: { name: true, barcode: true, sellingPrice: true, minQuantity: true },
        },
      },
      orderBy: [{ expiryDate: "asc" }],
      take: 200,
    });
    return ok({ batches });
  } catch {
    return fail("تعذر جلب الدفعات", 500);
  }
}

export async function POST(request: NextRequest) {
  const { user, error } = await requireRole("pharmacist");
  if (error) return error;

  try {
    const body = await request.json();
    const medicineId = String(body.medicineId ?? "").trim();
    const lotNumber = String(body.lotNumber ?? "").trim();
    const quantity = toInt(body.quantity, 0);
    const expiryRaw = String(body.expiryDate ?? "").trim();

    if (!medicineId) return fail("معرّف الدواء مطلوب");
    if (!lotNumber) return fail("رقم التشغيلة (LOT) مطلوب");
    if (quantity <= 0) return fail("الكمية يجب أن تكون موجبة");

    const expiryDate = new Date(expiryRaw);
    if (isNaN(expiryDate.getTime())) return fail("تاريخ صلاحية غير صالح");

    const created = await db.$transaction(async (tx) => {
      const med = await tx.medicine.findUnique({ where: { id: medicineId } });
      if (!med) throw new Error("NOT_FOUND");
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (expiryDate.getTime() <= today.getTime())
        throw new Error("EXPIRED_LOT");

      const existing = await tx.batch.findUnique({
        where: { medicineId_lotNumber: { medicineId, lotNumber } },
      });
      if (existing) throw new Error("DUPLICATE_LOT");

      const batch = await tx.batch.create({
        data: {
          medicineId,
          lotNumber,
          expiryDate,
          quantity,
          unitCost: Math.max(0, toInt(body.unitCost, med.purchasePrice)),
          supplier: String(body.supplier ?? "").trim() || null,
        },
      });
      const newQty = med.quantity + quantity;
      await tx.medicine.update({
        where: { id: medicineId },
        data: {
          quantity: newQty,
          expiryDate: expiryDate < med.expiryDate ? expiryDate : med.expiryDate,
        },
      });
      await tx.stockMovement.create({
        data: {
          medicineId,
          type: "restock",
          delta: quantity,
          balanceAfter: newQty,
          reference: `LOT ${lotNumber}`,
          userId: user.id,
        },
      });
      return batch;
    });

    return ok({ batch: created, message: `تمت إضافة دفعة ${created.lotNumber}` }, 201);
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "NOT_FOUND") return fail("الدواء غير موجود", 404);
      if (e.message === "DUPLICATE_LOT")
        return fail("رقم التشغيلة موجود مسبقاً لهذا الدواء — استخدم التعبئة لدمجه", 409);
      if (e.message === "EXPIRED_LOT")
        return fail("لا يمكن إدخال دفعة منتهية أو تنتهي اليوم", 400);
    }
    return fail("تعذر إضافة الدفعة", 500);
  }
}
