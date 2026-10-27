import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { FULL_COVERAGE_BPS } from "@/lib/insurance";

/** PATCH /api/insurance/policies/[id] — تعديل بوليصة أو إيقافها (صيدلي فما فوق) */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireRole("pharmacist");
  if (error) return error;
  const { id } = await params;

  try {
    const policy = await db.patientInsurancePolicy.findUnique({ where: { id } });
    if (!policy) return fail("البوليصة غير موجودة", 404);

    const body = await request.json();
    const data: Record<string, unknown> = {};

    if (body.coverageBps !== undefined) {
      const bps = Math.round(Number(body.coverageBps));
      if (!Number.isFinite(bps) || bps < 0 || bps > FULL_COVERAGE_BPS)
        return fail("نسبة التغطية يجب أن تكون بين 0% و100%");
      data.coverageBps = bps;
    }
    if (body.copayFixed !== undefined) {
      const copay =
        body.copayFixed === null || body.copayFixed === ""
          ? null
          : Math.round(Number(body.copayFixed));
      if (copay !== null && (!Number.isFinite(copay) || copay < 0))
        return fail("المشاركة الثابتة يجب أن تكون رقماً موجباً");
      data.copayFixed = copay;
    }
    if (body.expiryDate !== undefined) {
      if (!body.expiryDate) {
        data.expiryDate = null;
      } else {
        const d = new Date(String(body.expiryDate));
        if (Number.isNaN(d.getTime())) return fail("تاريخ الانتهاء غير صالح");
        data.expiryDate = d;
      }
    }
    if (body.holderName !== undefined)
      data.holderName = String(body.holderName ?? "").trim() || null;
    if (body.notes !== undefined) data.notes = String(body.notes ?? "").trim() || null;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const updated = await db.patientInsurancePolicy.update({
      where: { id },
      data,
      include: {
        patient: { select: { id: true, name: true, nationalId: true } },
        provider: { select: { id: true, name: true, code: true } },
      },
    });
    return ok({ policy: updated, message: "تم تحديث البوليصة" });
  } catch {
    return fail("تعذر تحديث البوليصة", 500);
  }
}
