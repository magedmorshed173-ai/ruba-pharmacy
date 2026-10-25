import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";

/** PATCH /api/suppliers/[id] — تعديل بيانات مورد أو تعطيله (صيدلي فما فوق) */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireRole("pharmacist");
  if (error) return error;
  const { id } = await params;

  try {
    const body = await request.json();
    const supplier = await db.supplier.findUnique({ where: { id } });
    if (!supplier) return fail("المورد غير موجود", 404);

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = String(body.name ?? "").trim();
      if (!name) return fail("اسم المورد مطلوب");
      const dupe = await db.supplier.findFirst({ where: { name, id: { not: id } } });
      if (dupe) return fail("مورد آخر بهذا الاسم موجود", 409);
      data.name = name;
    }
    if (body.phone !== undefined)
      data.phone = String(body.phone ?? "").trim() || null;
    if (body.email !== undefined)
      data.email = String(body.email ?? "").trim() || null;
    if (body.address !== undefined)
      data.address = String(body.address ?? "").trim() || null;
    if (body.notes !== undefined)
      data.notes = String(body.notes ?? "").trim() || null;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const updated = await db.supplier.update({ where: { id }, data });
    return ok({ supplier: updated, message: "تم تحديث بيانات المورد" });
  } catch {
    return fail("تعذر تحديث المورد", 500);
  }
}
