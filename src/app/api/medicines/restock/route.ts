import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { toInt } from "@/lib/money";

// POST /api/medicines/restock — إعادة تعبئة (صيدلي فما فوق)
// ✅ إصلاح ثغرة v2.0: فحص الدور مركزي هنا قبل التنفيذ (كان يُتجاوز في Django)
// v3.1: التعبئة تُسجَّل كدفعة (LOT) بصلاحية مستقلة — يفعّل FEFO في البيع
export async function POST(request: NextRequest) {
  const { user, error } = await requireRole("pharmacist");
  if (error) return error;

  try {
    const body = await request.json();
    const medicineId = String(body.medicineId ?? "").trim();
    const quantity = toInt(body.quantity, 0);
    const reference = String(body.reference ?? "").trim() || null;

    // بيانات الدفعة (اختيارية — مع قيم افتراضية ذكية)
    const lotNumber =
      String(body.lotNumber ?? "").trim() ||
      `LOT-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const unitCost = Math.max(0, toInt(body.unitCost ?? 0));
    const supplier = String(body.supplier ?? "").trim() || null;

    if (!medicineId) return fail("معرّف الدواء مطلوب");
    if (quantity <= 0) return fail("الكمية يجب أن تكون موجبة");

    const result = await db.$transaction(async (tx) => {
      const med = await tx.medicine.findUnique({ where: { id: medicineId } });
      if (!med) throw new Error("NOT_FOUND");

      // صلاحية الدفعة: من الطلب إن وُجد، وإلا صلاحية الدواء المسجلة
      let expiryDate = med.expiryDate;
      if (body.expiryDate) {
        const d = new Date(String(body.expiryDate));
        if (isNaN(d.getTime())) throw new Error("BAD_EXPIRY");
        expiryDate = d;
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (expiryDate.getTime() <= today.getTime()) throw new Error("EXPIRED_LOT");

      // إنشاء/تجميع الدفعة (نفس رقم اللوت = دمج كميات)
      const batch = await tx.batch.upsert({
        where: { medicineId_lotNumber: { medicineId, lotNumber } },
        create: {
          medicineId,
          lotNumber,
          expiryDate,
          quantity,
          unitCost: unitCost || med.purchasePrice,
          supplier,
        },
        update: {
          quantity: { increment: quantity },
          expiryDate,
          unitCost: unitCost || med.purchasePrice,
        },
      });

      const newQty = med.quantity + quantity;
      await tx.medicine.update({
        where: { id: medicineId },
        data: {
          quantity: newQty,
          // أقرب صلاحية = دقة أرفع للتنبيهات
          expiryDate: expiryDate < med.expiryDate ? expiryDate : med.expiryDate,
        },
      });
      const movement = await tx.stockMovement.create({
        data: {
          medicineId,
          type: "restock",
          delta: quantity,
          balanceAfter: newQty,
          reference: reference ? `${reference} · LOT ${lotNumber}` : `LOT ${lotNumber}`,
          userId: user.id,
        },
      });
      return { medicine: { ...med, quantity: newQty }, batch, movement };
    });

    return ok(
      {
        medicine: result.medicine,
        batch: result.batch,
        message: `تمت التعبئة بنجاح — دفعة ${result.batch.lotNumber}`,
      },
      201
    );
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "NOT_FOUND") return fail("الدواء غير موجود", 404);
      if (e.message === "BAD_EXPIRY") return fail("تاريخ صلاحية غير صالح", 400);
      if (e.message === "EXPIRED_LOT")
        return fail("لا يمكن إدخال دفعة منتهية أو تنتهي اليوم", 400);
    }
    return fail("تعذر تنفيذ التعبئة", 500);
  }
}
