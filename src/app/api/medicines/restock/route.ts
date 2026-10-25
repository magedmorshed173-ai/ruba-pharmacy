import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { toInt } from "@/lib/money";

// POST /api/medicines/restock — إعادة تعبئة (صيدلي فما فوق)
// ✅ إصلاح ثغرة v2.0: فحص الدور مركزي هنا قبل التنفيذ (كان يُتجاوز في Django)
export async function POST(request: NextRequest) {
  const { user, error } = await requireRole("pharmacist");
  if (error) return error;

  try {
    const body = await request.json();
    const medicineId = String(body.medicineId ?? "").trim();
    const quantity = toInt(body.quantity, 0);
    const reference = String(body.reference ?? "").trim() || null;

    if (!medicineId) return fail("معرّف الدواء مطلوب");
    if (quantity <= 0) return fail("الكمية يجب أن تكون موجبة");

    const result = await db.$transaction(async (tx) => {
      const med = await tx.medicine.findUnique({ where: { id: medicineId } });
      if (!med) throw new Error("NOT_FOUND");
      const newQty = med.quantity + quantity;
      await tx.medicine.update({
        where: { id: medicineId },
        data: { quantity: newQty },
      });
      const movement = await tx.stockMovement.create({
        data: {
          medicineId,
          type: "restock",
          delta: quantity,
          balanceAfter: newQty,
          reference,
          userId: user.id,
        },
      });
      return { medicine: { ...med, quantity: newQty }, movement };
    });

    return ok({ medicine: result.medicine, message: "تمت التعبئة بنجاح" }, 201);
  } catch (e) {
    if (e instanceof Error && e.message === "NOT_FOUND")
      return fail("الدواء غير موجود", 404);
    return fail("تعذر تنفيذ التعبئة", 500);
  }
}
