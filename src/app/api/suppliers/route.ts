import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth, requireRole } from "@/lib/api-guard";

/**
 * GET /api/suppliers?active=1 — قائمة الموردين مع عدد أوامر الشراء
 * POST — إضافة مورد (صيدلي فما فوق)
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const active = request.nextUrl.searchParams.get("active");
  try {
    const suppliers = await db.supplier.findMany({
      where: active === "1" ? { isActive: true } : {},
      include: { _count: { select: { purchaseOrders: true } } },
      orderBy: [{ name: "asc" }],
      take: 300,
    });
    return ok({ suppliers });
  } catch {
    return fail("تعذر جلب الموردين", 500);
  }
}

export async function POST(request: NextRequest) {
  const { error } = await requireRole("pharmacist");
  if (error) return error;

  try {
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    if (!name) return fail("اسم المورد مطلوب");
    if (name.length > 120) return fail("اسم المورد طويل جداً");

    const exists = await db.supplier.findUnique({ where: { name } });
    if (exists) return fail("مورد بهذا الاسم موجود مسبقاً", 409);

    const supplier = await db.supplier.create({
      data: {
        name,
        phone: String(body.phone ?? "").trim() || null,
        email: String(body.email ?? "").trim() || null,
        address: String(body.address ?? "").trim() || null,
        notes: String(body.notes ?? "").trim() || null,
      },
    });
    return ok({ supplier, message: `تمت إضافة المورد «${name}»` }, 201);
  } catch {
    return fail("تعذر إضافة المورد", 500);
  }
}
