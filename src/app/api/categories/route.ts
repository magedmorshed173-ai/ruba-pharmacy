import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth, requireRole } from "@/lib/api-guard";

// GET /api/categories — قائمة التصنيات مع عدد الأدوية
export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const categories = await db.category.findMany({
      include: { _count: { select: { medicines: true } } },
      orderBy: { name: "asc" },
    });
    return ok({ categories });
  } catch {
    return fail("تعذر جلب التصنيفات", 500);
  }
}

// POST /api/categories — إضافة تصنيف (صيدلي فما فوق)
export async function POST(request: NextRequest) {
  const { error } = await requireRole("pharmacist");
  if (error) return error;

  try {
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    if (!name) return fail("اسم التصنيف مطلوب");
    const exists = await db.category.findUnique({ where: { name } });
    if (exists) return fail("التصنيف موجود مسبقاً", 409);

    const category = await db.category.create({
      data: { name, description: String(body.description ?? "").trim() || null },
    });
    return ok({ category }, 201);
  } catch {
    return fail("تعذر إضافة التصنيف", 500);
  }
}
