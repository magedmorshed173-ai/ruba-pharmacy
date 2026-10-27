/**
 * ضمان وجود حساب مدير للدخول الأول — v4.6.3
 * وضع catalog (إنتاج نظيف) يبني الكتالوج والسجل الوطني بلا مستخدمين،
 * وهذا السكربت يغلق فجوة «قاعدة بلا حساب دخول»: كلمة المرور تُقرأ من
 * سر البيئة RUBA_ADMIN_PASSWORD ولا تُطبع أبداً (سجلات الريبو العام)،
 * وإن غاب السر يتخطى برسالة واضحة بلا فشل (ليس كل استدعاء يحتاج مديراً).
 * Idempotent بالكامل: upsert على username=admin فقط — لا يمس أي بيانات أخرى.
 * التشغيل: bun scripts/seed-admin.ts
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const password = process.env.RUBA_ADMIN_PASSWORD ?? "";
if (!password) {
  console.log(
    "⚠️ RUBA_ADMIN_PASSWORD غير مضبوط — تخطي ضمان حساب المدير (الحسابات الحالية كما هي)"
  );
  process.exit(0);
}
if (password.length < 12) {
  console.error(
    "::error::RUBA_ADMIN_PASSWORD قصيرة — 12 حرفاً على الأقل (كلمة مرور مدير إنتاج)"
  );
  process.exit(1);
}

const existing = await db.user.findUnique({ where: { username: "admin" } });
const hash = await bcrypt.hash(password, 10);

if (existing) {
  await db.user.update({
    where: { username: "admin" },
    data: { password: hash, isActive: true, role: "admin" },
  });
  console.log(
    "✅ حُدّث حساب المدير admin بكلمة مرور السر (لا تُطبع في السجلات أبداً)"
  );
} else {
  await db.user.create({
    data: {
      username: "admin",
      fullName: "مدير النظام",
      role: "admin",
      password: hash,
    },
  });
  console.log(
    "✅ أُنشئ حساب المدير admin بكلمة مرور السر (لا تُطبع في السجلات أبداً)"
  );
}

await db.$disconnect();
