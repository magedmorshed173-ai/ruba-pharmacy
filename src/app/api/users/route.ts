import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/auth";

const PUBLIC_FIELDS = {
  id: true,
  username: true,
  fullName: true,
  role: true,
  phone: true,
  isActive: true,
  createdAt: true,
};

// GET /api/users — إدارة المستخدمين (مدير فقط)
export async function GET() {
  const { error } = await requireRole("admin");
  if (error) return error;

  try {
    const users = await db.user.findMany({
      select: { ...PUBLIC_FIELDS, _count: { select: { sales: true } } },
      orderBy: { createdAt: "asc" },
    });
    return ok({ users });
  } catch {
    return fail("تعذر جلب المستخدمين", 500);
  }
}

// POST /api/users — إضافة مستخدم (مدير فقط)
export async function POST(request: NextRequest) {
  const { user, error } = await requireRole("admin");
  if (error) return error;

  try {
    const body = await request.json();
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    const fullName = String(body.fullName ?? "").trim();
    const role = ["admin", "pharmacist", "technician"].includes(body.role)
      ? body.role
      : "technician";

    if (!username || !fullName) return fail("اسم المستخدم والاسم الكامل مطلوبان");
    if (password.length < 8) return fail("كلمة المرور يجب أن تكون 8 أحرف على الأقل");

    const exists = await db.user.findUnique({ where: { username } });
    if (exists) return fail("اسم المستخدم موجود مسبقاً", 409);

    const hashed = await bcrypt.hash(password, 10);
    const ip = clientIp(request.headers);

    // v5.4 — الإنشاء والتوثيق في معاملة واحدة: لا مستخدم بلا سجل تدقيق
    const created = await db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          username,
          fullName,
          role,
          phone: String(body.phone ?? "").trim() || null,
          password: hashed,
        },
        select: PUBLIC_FIELDS,
      });
      await recordAudit(tx, {
        action: "user.create",
        entityType: "user",
        entityId: u.id,
        summary: `إضافة المستخدم ${u.fullName} (${u.username}) بدور ${u.role}`,
        meta: { username, role, phone: u.phone },
        actor: user,
        ip,
      });
      return u;
    });
    return ok({ user: created }, 201);
  } catch {
    return fail("تعذر إضافة المستخدم", 500);
  }
}
