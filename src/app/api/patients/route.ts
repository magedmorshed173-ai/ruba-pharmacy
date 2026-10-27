import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth, requireRole } from "@/lib/api-guard";
import { PREGNANCY_STATUSES, type PregnancyStatus } from "@/lib/patient-gate";

/** يتحقق من حالة الحمل الواردة — القيمة غير المعروفة تُرفض (لا تخمين صامت) */
function parsePregnancyStatusInput(raw: unknown): PregnancyStatus | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return (PREGNANCY_STATUSES as string[]).includes(v)
    ? (v as PregnancyStatus)
    : null;
}

/** يتحقق من تاريخ الميلاد — يجب أن يكون تارخاً صالحاً في الماضي */
function parseDobInput(raw: unknown): Date | null | "invalid" {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime()) || d.getTime() > Date.now()) return "invalid";
  return d;
}

// GET /api/patients?q= — بحث المرضى
export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  try {
    const patients = await db.patient.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q } },
              { nationalId: { contains: q } },
              { phone: { contains: q } },
            ],
          }
        : undefined,
      orderBy: { name: "asc" },
      take: 100,
    });
    return ok({ patients });
  } catch {
    return fail("تعذر جلب المرضى", 500);
  }
}

// POST /api/patients — إضافة مريض
export async function POST(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    const nationalId = String(body.nationalId ?? "").trim();
    if (!name || !nationalId) return fail("الاسم ورقم الهوية مطلوبان");

    const exists = await db.patient.findUnique({ where: { nationalId } });
    if (exists) return fail("رقم الهوية مسجل مسبقاً", 409);

    const dob = parseDobInput(body.dateOfBirth);
    if (dob === "invalid") return fail("تاريخ الميلاد غير صالح");
    const pregStatus =
      body.pregnancyStatus === undefined ? "none" : parsePregnancyStatusInput(body.pregnancyStatus);
    if (pregStatus === null) return fail("حالة الحمل غير صالحة");

    const patient = await db.patient.create({
      data: {
        name,
        nationalId,
        phone: String(body.phone ?? "").trim() || null,
        chronicMedications: String(body.chronicMedications ?? "").trim() || null,
        allergies: String(body.allergies ?? "").trim() || null,
        dateOfBirth: dob,
        pregnancyStatus: pregStatus,
      },
    });
    return ok({ patient }, 201);
  } catch {
    return fail("تعذر إضافة المريض", 500);
  }
}
