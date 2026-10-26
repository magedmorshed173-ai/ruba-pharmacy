import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";

/**
 * POST /api/prescriptions/[id]/reject — رفض وصفة بسبب موثق (صيدلي فما فوق)
 * الرفض قرار صيدلي مسؤول: الجرعة غير منطقية، الوصفة غير مقروءة،
 * تعارض خطر بدون بديل… السبب إلزامي ويظهر في سجل الطابور.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireRole("pharmacist");
  if (error) return error;
  const { id } = await params;

  try {
    const body = await request.json();
    const reason = String(body.reason ?? "").trim();
    if (!reason) return fail("سبب الرفض مطلوب — الرفض بلا توثيق لا يُقبل");

    const prescription = await db.prescription.findUnique({ where: { id } });
    if (!prescription) return fail("الوصفة غير موجودة", 404);
    if (prescription.status === "dispensed")
      return fail("لا يمكن رفض وصفة مصروفة — راجع إلغاء الفاتورة", 409);
    if (prescription.status === "rejected")
      return fail("الوصفة مرفوضة مسبقاً", 409);

    const updated = await db.prescription.update({
      where: { id },
      data: { status: "rejected", rejectReason: reason },
      include: { items: true },
    });

    return ok({
      prescription: updated,
      message: `رُفضت الوصفة رقم ${prescription.number} وسُجّل السبب`,
    });
  } catch {
    return fail("طلب غير صالح", 400);
  }
}
