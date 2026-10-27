/**
 * scripts/verify-migration.ts — P0-4 (v4.4.1)
 * التحقق من صحة الترحيل الأولي prisma/migrations/0_init/migration.sql
 * بتنفيذه فعلياً داخل PostgreSQL يعمل عبر WASM (PGlite) — بلا خادم وبلا لمس أي قاعدة حية.
 *
 * التشغيل (يتطلب تثبيت @electric-sql/pglite مؤقتاً):
 *   bun add -d @electric-sql/pglite && bun scripts/verify-migration.ts
 * إن لم تكن الحزمة مثبتة يخرج السكربت بنجاح مع تنبيه (حتى لا يكسر CI).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION = join(process.cwd(), "prisma/migrations/0_init/migration.sql");

if (!existsSync(MIGRATION)) {
  console.error("✗ ملف الترحيل غير موجود:", MIGRATION);
  process.exit(1);
}

interface PGliteInstance {
  exec: (sql: string) => Promise<unknown>;
  query: <T>(sql: string) => Promise<{ rows: T[] }>;
  close: () => Promise<void>;
}
type PGliteCtor = new () => PGliteInstance;
let PGlite: PGliteCtor | null = null;
try {
  // مُعرِّف غير حرفي + صب عبر unknown — يمنع TS2307 حين تكون الحزمة غير مثبتة
  const pkg = "@electric-sql/pglite";
  ({ PGlite } = (await import(pkg)) as unknown as { PGlite: PGliteCtor });
} catch {
  console.log("⚠ @electric-sql/pglite غير مثبتة — تخطَّ التحقق (ثبّتها مؤقتاً لتشغيله)");
  process.exit(0);
}

const sql = readFileSync(MIGRATION, "utf8");

const db = new PGlite();
try {
  await db.exec(sql);
  // تحقق عكسي: كل نماذج schema.prisma الـ22 يجب أن تكون جداول موجودة
  const expected = [
    "User", "Category", "Medicine", "Batch", "DrugInteraction",
    "StockMovement", "RegulatoryAction", "StockReservation", "SaleItemBatch",
    "Supplier", "PurchaseOrder", "PurchaseOrderItem", "Sale", "SaleItem",
    "LoginAudit", "Prescription", "PrescriptionItem", "Patient",
    "Notification", "Session", "Drug", "NationalDrug",
  ];
  const res = await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
  );
  const created = new Set(res.rows.map((r) => r.tablename));
  const missing = expected.filter((t) => !created.has(t));

  if (missing.length > 0) {
    console.error("✗ جداول مفقودة بعد التنفيذ:", missing.join(", "));
    process.exit(1);
  }
  console.log(
    `✓ الترحيل 0_init صالح — نُفّذ كاملاً في Postgres (WASM) وأنشأ ${created.size} جدولاً، بما فيها كل الجداول الـ${expected.length} الحاكمة`
  );
} catch (e) {
  console.error("✗ فشل تنفيذ الترحيل:", e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  await db.close();
}
