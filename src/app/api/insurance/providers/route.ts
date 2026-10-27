import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, ok, requireAuth, requireRole } from "@/lib/api-guard";

/**
 * GET /api/insurance/providers?active=1 — شركات التأمين مع عدد البوليصات والمطالبات
 * POST — إضافة شركة (مدير فقط — قرار تعامل استراتيجي)
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const active = request.nextUrl.searchParams.get("active");
  try {
    const providers = await db.insuranceProvider.findMany({
      where: active === "1" ? { isActive: true } : {},
      include: {
        _count: { select: { policies: true, sales: true } },
      },
      orderBy: [{ name: "asc" }],
      take: 200,
    });
    return ok({ providers });
  } catch {
    return fail("تعذر جلب شركات التأمين", 500);
  }
}

export async function POST(request: NextRequest) {
  const { error } = await requireRole("admin");
  if (error) return error;

  try {
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    if (!name) return fail("اسم شركة التأمين مطلوب");
    if (name.length > 120) return fail("اسم شركة التأمين طويل جداً");

    const exists = await db.insuranceProvider.findUnique({ where: { name } });
    if (exists) return fail("شركة تأمين بهذا الاسم موجودة مسبقاً", 409);

    const code = String(body.code ?? "").trim() || null;
    if (code) {
      const codeExists = await db.insuranceProvider.findUnique({ where: { code } });
      if (codeExists) return fail("رمز التعامل مستخدم لشركة أخرى", 409);
    }

    const provider = await db.insuranceProvider.create({
      data: {
        name,
        code,
        phone: String(body.phone ?? "").trim() || null,
        email: String(body.email ?? "").trim() || null,
        notes: String(body.notes ?? "").trim() || null,
      },
    });
    return ok({ provider, message: `تمت إضافة شركة التأمين «${name}»` }, 201);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return fail("اسم أو رمز مكرر — شركة تأمين بهذه البيانات موجودة", 409);
    return fail("تعذر إضافة شركة التأمين", 500);
  }
}
