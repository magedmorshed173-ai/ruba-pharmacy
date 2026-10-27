/**
 * scripts/seed-e2e.ts — بذر أدنى لبيئة E2E (v4.6 P2):
 * يضمن وجود مدير واحد باسم E2E_ADMIN_USER وكلمة E2E_ADMIN_PASSWORD — لا شيء آخر.
 * تُستخدم في مهمة CI (e2e) بعد migrate deploy وقبل تشغيل الخادم.
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const username = process.env.E2E_ADMIN_USER || "admin";
const password = process.env.E2E_ADMIN_PASSWORD;

if (!password) {
  console.error("✗ E2E_ADMIN_PASSWORD مطلوب للبذر");
  process.exit(1);
}

const db = new PrismaClient();
try {
  const hash = await bcrypt.hash(password, 10);
  await db.user.upsert({
    where: { username },
    update: { password: hash, role: "admin", isActive: true, totpEnabled: false },
    create: {
      username,
      password: hash,
      fullName: "مدير E2E",
      role: "admin",
      isActive: true,
    },
  });
  console.log(`✓ مدير E2E جاهز (@${username})`);
} finally {
  await db.$disconnect();
}
