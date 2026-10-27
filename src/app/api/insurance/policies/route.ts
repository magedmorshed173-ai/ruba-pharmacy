import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, ok, requireAuth, requireRole } from "@/lib/api-guard";
import { FULL_COVERAGE_BPS } from "@/lib/insurance";

/**
 * GET /api/insurance/policies?patientId=&active=1&q= — بوليصات المرضى
 * POST — إضافة بوليصة لمريض (صيدلي فما فوق — قرار تشغيلي يومي)
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const patientId = sp.get("patientId")?.trim() ?? "";
  const q = sp.get("q")?.trim() ?? "";
  const active = sp.get("active");

  const where: Record<string, unknown> = {};
  if (patientId) where.patientId = patientId;
  if (active === "1") where.isActive = true;
  if (q) where.policyNumber = { contains: q };

  try {
    const policies = await db.patientInsurancePolicy.findMany({
      where,
      include: {
        patient: { select: { id: true, name: true, nationalId: true, phone: true } },
        provider: { select: { id: true, name: true, code: true, isActive: true } },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 200,
    });
    return ok({ policies });
  } catch {
    return fail("تعذر جلب بوليصات التأمين", 500);
  }
}

export async function POST(request: NextRequest) {
  const { error } = await requireRole("pharmacist");
  if (error) return error;

  try {
    const body = await request.json();
    const patientId = String(body.patientId ?? "").trim();
    const providerId = String(body.providerId ?? "").trim();
    const policyNumber = String(body.policyNumber ?? "").trim();
    if (!patientId || !providerId || !policyNumber)
      return fail("المريض وشركة التأمين ورقم البوليصة حقول إلزامية");
    if (policyNumber.length > 60) return fail("رقم البوليصة طويل جداً");

    const patient = await db.patient.findUnique({ where: { id: patientId } });
    if (!patient) return fail("المريض غير موجود", 404);
    const provider = await db.insuranceProvider.findUnique({ where: { id: providerId } });
    if (!provider) return fail("شركة التأمين غير موجودة", 404);
    if (!provider.isActive) return fail("شركة التأمين موقوفة عن التعامل", 409);

    const dup = await db.patientInsurancePolicy.findUnique({
      where: { providerId_policyNumber: { providerId, policyNumber } },
    });
    if (dup) return fail("رقم البوليصة مسجّل مسبقاً لهذه الشركة", 409);

    // نسبة التغطية: عدد صحيح بأساس النقطة 0..10000 — الخروج عن المدى رفض وليس تصحيحاً
    const coverageBps = body.coverageBps === undefined ? 7000 : Math.round(Number(body.coverageBps));
    if (!Number.isFinite(coverageBps) || coverageBps < 0 || coverageBps > FULL_COVERAGE_BPS)
      return fail("نسبة التغطية يجب أن تكون بين 0% و100%");

    const copayFixed =
      body.copayFixed === undefined || body.copayFixed === null || body.copayFixed === ""
        ? null
        : Math.round(Number(body.copayFixed));
    if (copayFixed !== null && (!Number.isFinite(copayFixed) || copayFixed < 0))
      return fail("المشاركة الثابتة يجب أن تكون رقماً موجباً");

    let expiryDate: Date | null = null;
    if (body.expiryDate) {
      expiryDate = new Date(String(body.expiryDate));
      if (Number.isNaN(expiryDate.getTime())) return fail("تاريخ الانتهاء غير صالح");
    }

    const policy = await db.patientInsurancePolicy.create({
      data: {
        patientId,
        providerId,
        policyNumber,
        holderName: String(body.holderName ?? "").trim() || null,
        coverageBps,
        copayFixed,
        expiryDate,
        notes: String(body.notes ?? "").trim() || null,
      },
      include: {
        patient: { select: { id: true, name: true, nationalId: true } },
        provider: { select: { id: true, name: true, code: true } },
      },
    });
    return ok(
      { policy, message: `تمت إضافة البوليصة «${policyNumber}» للمريض ${patient.name}` },
      201
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return fail("رقم البوليصة مسجّل مسبقاً لهذه الشركة", 409);
    return fail("تعذر إضافة البوليصة", 500);
  }
}
