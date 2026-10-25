import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth, requireRole } from "@/lib/api-guard";

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

    const patient = await db.patient.create({
      data: {
        name,
        nationalId,
        phone: String(body.phone ?? "").trim() || null,
        chronicMedications: String(body.chronicMedications ?? "").trim() || null,
        allergies: String(body.allergies ?? "").trim() || null,
      },
    });
    return ok({ patient }, 201);
  } catch {
    return fail("تعذر إضافة المريض", 500);
  }
}
