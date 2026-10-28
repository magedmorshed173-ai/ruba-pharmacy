import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { getSessionUser } from "@/lib/api-guard";
import { cookies } from "next/headers";
import { COOKIE_NAME, hashToken, revokeAllUserSessions, clientIp } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

const PUBLIC_FIELDS = {
  id: true,
  username: true,
  fullName: true,
  role: true,
  phone: true,
  isActive: true,
  createdAt: true,
  // v4.6 — فرع العمل
  branchId: true,
  branch: { select: { id: true, name: true } },
};

// PUT /api/users/:id — تعديل مستخدم (مدير فقط)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireRole("admin");
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
    if (body.branchId !== undefined) {
      // v4.6 — تعيين فرع العمل (null = بلا فرع / يشاهد الكل في التقارير)
      const bid = String(body.branchId ?? "").trim() || null;
      if (bid) {
        const branch = await db.branch.findUnique({
          where: { id: bid },
          select: { isActive: true },
        });
        if (!branch) return fail("الفرع غير موجود", 404);
      }
      data.branchId = bid;
    }
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

    // v5.4 — كشف الفروق للسجل (كلمة المرور لا تُخزّن أبداً — فقط حقيقة تغييرها)
    const changes: Record<string, { from?: unknown; to?: unknown; changed?: boolean }> = {};
    if (data.fullName !== undefined && data.fullName !== existing.fullName)
      changes.fullName = { from: existing.fullName, to: data.fullName };
    if (data.phone !== undefined) changes.phone = { from: existing.phone, to: data.phone };
    if (data.role !== undefined && data.role !== existing.role)
      changes.role = { from: existing.role, to: data.role };
    if (data.isActive !== undefined && data.isActive !== existing.isActive)
      changes.isActive = { from: existing.isActive, to: data.isActive };
    if (data.branchId !== undefined) changes.branchId = { from: existing.branchId, to: data.branchId };
    const passwordChanged = Boolean(body.password);
    if (passwordChanged) changes.password = { changed: true };

    const bits: string[] = [];
    if (changes.role) bits.push(`الدور: ${String(changes.role.from)} → ${String(changes.role.to)}`);
    if (changes.isActive) bits.push(changes.isActive.to === false ? "إيقاف الحساب" : "تفعيل الحساب");
    if (passwordChanged) bits.push("تغيير كلمة المرور");

    const ip = clientIp(request.headers);
    // v5.4 — التعديل والتوثيق في معاملة واحدة
    const updated = await db.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id }, data, select: PUBLIC_FIELDS });
      await recordAudit(tx, {
        action: "user.update",
        entityType: "user",
        entityId: id,
        summary: `تعديل المستخدم ${existing.username}${bits.length ? " — " + bits.join("، ") : ""}`,
        meta: { username: existing.username, changes },
        actor: user,
        ip,
      });
      return u;
    });

    // v3.9: تغيير كلمة المرور أو إيقاف الحساب = إنهاء جلسات الهدف فوراً
    // (الجلسة الحالية للمُغيّر نفسه تبقى حية — بقية الأجهزة تنتهي)
    const deactivated = data.isActive === false;
    if (passwordChanged || deactivated) {
      const currentToken = (await cookies()).get(COOKIE_NAME)?.value;
      const keepCurrent =
        !deactivated && currentToken && me?.id === id
          ? hashToken(currentToken)
          : undefined;
      await revokeAllUserSessions(id, keepCurrent);
    }

    return ok({ user: updated });
  } catch {
    return fail("تعذر تعديل المستخدم", 500);
  }
}

// DELETE /api/users/:id — إيقاف بدل الحذف (مدير فقط)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireRole("admin");
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
      // v5.4 — الإيقاف وتوثيقه في معاملة واحدة (السجل يبقى بعد الحذف: نسخ جامدة)
      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { isActive: false } });
        await recordAudit(tx, {
          action: "user.deactivate",
          entityType: "user",
          entityId: id,
          summary: `إيقاف المستخدم ${target?.username ?? id} (مرتبط بمبيعات — بديل الحذف)`,
          meta: {
            username: target?.username,
            fullName: target?.fullName,
            role: target?.role,
            linkedToSales: true,
          },
          actor: user,
          ip: clientIp(_request.headers),
        });
      });
      // v3.9: إيقاف الحساب ينهي كل جلساته فوراً (بلا استثناء — الحساب موقوف)
      await revokeAllUserSessions(id);
      return ok({ message: "المستخدم مرتبط بمبيعات — تم إيقاف حسابه بدل حذفه", deactivated: true });
    }
    // v5.4 — الحذف وتوثيقه في معاملة واحدة (المفتاح الخارجي SetNull يُبقي السجل باسمه الجامد)
    await db.$transaction(async (tx) => {
      await tx.user.delete({ where: { id } });
      await recordAudit(tx, {
        action: "user.delete",
        entityType: "user",
        entityId: id,
        summary: `حذف المستخدم ${target?.username ?? id}`,
        meta: { username: target?.username, fullName: target?.fullName, role: target?.role },
        actor: user,
        ip: clientIp(_request.headers),
      });
    });
    return ok({ message: "تم حذف المستخدم", deleted: true });
  } catch {
    return fail("تعذر حذف المستخدم", 500);
  }
}
