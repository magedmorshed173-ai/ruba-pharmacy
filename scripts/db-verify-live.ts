/**
 * تحقق حي من القاعدة المتصلة — v4.6.1
 * يُستخدم في workflow «Neon DB Setup» بعد الترحيلات والبذر، ويمكن تشغيله
 * محلياً أيضاً: bun scripts/db-verify-live.ts (يقرأ DATABASE_URL من البيئة)
 * يطبع: عدد الجداول العامة + عدّادات جوهرية — ويفشل برمز غير صفري إن لم تصل.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

try {
  const tabs = await db.$queryRawUnsafe<{ n: number }[]>(
    `select count(*)::int as n from information_schema.tables where table_schema = 'public'`
  );

  let migrations: string[] = [];
  try {
    const rows = await db.$queryRawUnsafe<{ migration_name: string }[]>(
      `select migration_name from _prisma_migrations order by migration_name`
    );
    migrations = rows.map((r) => r.migration_name);
  } catch {
    console.log("⚠️ لا جدول _prisma_migrations — قاعدة بنمط db push؟ استخدم وضع baseline في الـ workflow");
  }

  const [users, medicines, drugs, national, sales] = await Promise.all([
    db.user.count(),
    db.medicine.count(),
    db.drug.count(),
    db.nationalDrug.count(),
    db.sale.count(),
  ]);

  console.log("── تحقق حي من القاعدة ──");
  console.log("الجداول العامة:", tabs[0]?.n ?? 0);
  console.log("الترحيلات المطبقة:", migrations.length > 0 ? migrations.join(", ") : "—");
  console.log(
    "مستخدمون:", users,
    "| مخزون:", medicines,
    "| كتالوج دواء:", drugs,
    "| سجل وطني:", national,
    "| فواتير:", sales
  );
  console.log((tabs[0]?.n ?? 0) >= 24 ? "✅ المخطط كامل" : "⚠️ عدد الجداول أقل من المتوقع (24+) — راجع migrate status");
  await db.$disconnect();
  process.exit(0);
} catch (e) {
  console.error("❌ فشل الاتصال أو الاستعلام:", e instanceof Error ? e.message : e);
  await db.$disconnect().catch(() => {});
  process.exit(1);
}
