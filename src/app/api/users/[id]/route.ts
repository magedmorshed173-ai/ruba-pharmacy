import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { getSessionUser } from "@/lib/api-guard";

const PUBLIC_FIELDS = {
  id: true,
  username: true,
  fullName: true,
  role: true,
  phone: true,
  isActive: true,
  createdAt: true,
};

// PUT /api/users/:id — تعديل مستخدم (مدير فقط)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireRole("admin");
  if (error) return error;

  const { id } = await params;
  try {
    const existing = await db.user.findUnique({ where: { id } });
    if (!existing) return fail("المستخدم غير موجود", 404);

    const body = await request.json();
    const data: Record<string, unknown> = {};

    if (body.fullName !== undefined) data.fullName = String(body.fullName).trim();
    if (body.phone !== undefined) data.phone = String(body.phone).trim() || null;
    if (body.role !== undefined && ["admin", "pharmacist", "technician"].includes(body.role))
      data.role = body.role;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (body.password) {
      const pw = String(body.password);
      if (pw.length < 8) return fail("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
      data.password = await bcrypt.hash(pw, 10);
    }

    // منع المدير من إيقاف نفسه أو تنزيل دوره (يضمن بقاء مدير فعال واحد على الأقل)
    const me = await getSessionUser();
    if (me && me.id === id) {
      if (data.isActive === false) return fail("لا يمكنك إيقاف حسابك الحالي");
      if (data.role && data.role !== "admin")
        return fail("لا يمكنك تنزيل دور حسابك الحالي");
    }
    if (existing.role === "admin" && (data.role && data.role !== "admin" || data.isActive === false)) {
      const activeAdmins = await db.user.count({
        where: { role: "admin", isActive: true, id: { not: id } },
      });
      if (activeAdmins === 0) return fail("يجب أن يبقى مدير نظام فعال واحد على الأقل");
    }

    const user = await db.user.update({ where: { id }, data, select: PUBLIC_FIELDS });
    return ok({ user });
  } catch {
    return fail("تعذر تعديل المستخدم", 500);
  }
}

// DELETE /api/users/:id — إيقاف بدل الحذف (مدير فقط)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireRole("admin");
  if (error) return error;

  const { id } = await params;
  const me = await getSessionUser();
  if (me?.id === id) return fail("لا يمكنك إيقاف حسابك الحالي");

  try {
    const used = await db.sale.findFirst({ where: { userId: id } });
    const activeAdmins = await db.user.count({
      where: { role: "admin", isActive: true, id: { not: id } },
    });
    const target = await db.user.findUnique({ where: { id } });
    if (target?.role === "admin" && activeAdmins === 0)
      return fail("يجب أن يبقى مدير نظام فعال واحد على الأقل");

    if (used) {
      await db.user.update({ where: { id }, data: { isActive: false } });
      return ok({ message: "المستخدم مرتبط بمبيعات — تم إيقاف حسابه بدل حذفه", deactivated: true });
    }
    await db.user.delete({ where: { id } });
    return ok({ message: "تم حذف المستخدم", deleted: true });
  } catch {
    return fail("تعذر حذف المستخدم", 500);
  }
}
