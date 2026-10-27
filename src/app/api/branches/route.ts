import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, ok, requireAuth, requireRole } from "@/lib/api-guard";

/**
 * GET /api/branches?active=1 — الفروع مع عدد الموظفين والمبيعات
 * POST — إضافة فرع (مدير فقط)
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const active = request.nextUrl.searchParams.get("active");
  try {
    const branches = await db.branch.findMany({
      where: active === "1" ? { isActive: true } : {},
      include: { _count: { select: { users: true, sales: true } } },
      orderBy: [{ name: "asc" }],
      take: 100,
    });
    return ok({ branches });
  } catch {
    return fail("تعذر جلب الفروع", 500);
  }
}

export async function POST(request: NextRequest) {
  const { error } = await requireRole("admin");
  if (error) return error;

  try {
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    if (!name) return fail("اسم الفرع مطلوب");
    if (name.length > 80) return fail("اسم الفرع طويل جداً");

    const exists = await db.branch.findUnique({ where: { name } });
    if (exists) return fail("فرع بهذا الاسم موجود مسبقاً", 409);

    const code = String(body.code ?? "").trim() || null;
    if (code) {
      const codeExists = await db.branch.findUnique({ where: { code } });
      if (codeExists) return fail("رمز الفرع مستخدم لفرع آخر", 409);
    }

    const branch = await db.branch.create({
      data: {
        name,
        code,
        phone: String(body.phone ?? "").trim() || null,
        address: String(body.address ?? "").trim() || null,
      },
    });
    return ok({ branch, message: `تمت إضافة الفرع «${name}»` }, 201);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return fail("اسم أو رمز مكرر — فرع بهذه البيانات موجود", 409);
    return fail("تعذر إضافة الفرع", 500);
  }
}
