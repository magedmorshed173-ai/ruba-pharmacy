import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { assertClaimTransition, isClaimStatus } from "@/lib/insurance";

/**
 * PATCH /api/insurance/claims/[saleId] — تحويل حالة مطالبة (مدير فقط)
 * القرار المالي (اعتماد/رفض/تحصيل) قرار مدير — عبر آلة حالات صارمة:
 * pending→approved|rejected، approved→paid، rejected→pending، paid نهائية.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireRole("admin");
  if (error) return error;
  const { id } = await params;

  try {
    const body = await request.json();
    const next = String(body.status ?? "").trim();
    if (!isClaimStatus(next))
      return fail("حالة المطالبة يجب أن تكون: pending | approved | rejected | paid");

    const sale = await db.sale.findUnique({
      where: { id },
      select: { id: true, claimStatus: true, status: true, reference: true },
    });
    if (!sale || !sale.claimStatus)
      return fail("لا توجد مطالبة تأمين على هذه الفاتورة", 404);
    if (sale.status !== "completed")
      return fail("الفاتورة ملغاة — مطالبتها ميتة ولا تُدار", 409);

    try {
      assertClaimTransition(sale.claimStatus, next);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "انتقال غير مسموح", 409);
    }

    const updated = await db.sale.update({
      where: { id },
      data: { claimStatus: next, claimUpdatedAt: new Date() },
      select: {
        id: true,
        reference: true,
        claimStatus: true,
        claimUpdatedAt: true,
        insurerAmount: true,
        patientAmount: true,
      },
    });
    return ok({ claim: updated, message: "تم تحديث حالة المطالبة" });
  } catch {
    return fail("تعذر تحديث حالة المطالبة", 500);
  }
}
