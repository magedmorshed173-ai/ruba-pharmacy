import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";
import { PREGNANCY_STATUSES, type PregnancyStatus } from "@/lib/patient-gate";

// PUT /api/patients/:id
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  try {
    const existing = await db.patient.findUnique({ where: { id } });
    if (!existing) return fail("المريض غير موجود", 404);

    const body = await request.json();
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.phone !== undefined) data.phone = String(body.phone).trim() || null;
    if (body.chronicMedications !== undefined)
      data.chronicMedications = String(body.chronicMedications).trim() || null;
    if (body.allergies !== undefined)
      data.allergies = String(body.allergies).trim() || null;
    if (body.dateOfBirth !== undefined) {
      const raw = String(body.dateOfBirth ?? "").trim();
      if (!raw) {
        data.dateOfBirth = null;
      } else {
        const d = new Date(raw);
        if (Number.isNaN(d.getTime()) || d.getTime() > Date.now())
          return fail("تاريخ الميلاد غير صالح");
        data.dateOfBirth = d;
      }
    }
    if (body.pregnancyStatus !== undefined) {
      const st = String(body.pregnancyStatus ?? "").trim().toLowerCase();
      if (!(PREGNANCY_STATUSES as string[]).includes(st))
        return fail("حالة الحمل غير صالحة");
      data.pregnancyStatus = st as PregnancyStatus;
    }

    if (body.nationalId !== undefined) {
      const nid = String(body.nationalId).trim();
      if (!nid) return fail("رقم الهوية مطلوب");
      const clash = await db.patient.findFirst({
        where: { nationalId: nid, id: { not: id } },
      });
      if (clash) return fail("رقم الهوية مسجل مسبقاً", 409);
      data.nationalId = nid;
    }

    const patient = await db.patient.update({ where: { id }, data });
    return ok({ patient });
  } catch {
    return fail("تعذر تعديل بيانات المريض", 500);
  }
}

// DELETE /api/patients/:id
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireAuth();
  if (error) return error;
  if (user.role !== "admin" && user.role !== "pharmacist")
    return fail("صلاحيتك لا تسمح بهذه العملية", 403);

  const { id } = await params;
  try {
    await db.patient.delete({ where: { id } });
    return ok({ message: "تم حذف المريض" });
  } catch {
    return fail("تعذر حذف المريض", 500);
  }
}
