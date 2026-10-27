/**
 * scripts/verify-migration.ts — v4.4.1 (P0) ثم رُقّي في v4.5 (P1)
 * التحقق من صحة كل ترحيلات prisma/migrations/* بتنفيذها بالترتيب داخل
 * PostgreSQL يعمل عبر WASM (PGlite) — بلا خادم وبلا لمس أي قاعدة حية.
 *
 * التشغيل (يتطلب تثبيت @electric-sql/pglite مؤقتاً):
 *   bun run db:verify-migration
 * إن لم تكن الحزمة مثبتة يخرج السكربت بنجاح مع تنبيه (حتى لا يكسر CI).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "prisma/migrations");

if (!existsSync(MIGRATIONS_DIR)) {
  console.error("✗ مجلد الترحيلات غير موجود:", MIGRATIONS_DIR);
  process.exit(1);
}

// الترحيلات بالترتيب اللفظي (0_init ثم 1_...) — نفس ترتيب prisma migrate
const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("."))
  .map((d) => d.name)
  .sort();

if (dirs.length === 0) {
  console.error("✗ لا توجد ترحيلات للتحقق منها");
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

const db = new PGlite();
try {
  for (const dir of dirs) {
    const file = join(MIGRATIONS_DIR, dir, "migration.sql");
    if (!existsSync(file)) {
      console.error(`✗ الترحيل ${dir} بلا ملف migration.sql`);
      process.exit(1);
    }
    await db.exec(readFileSync(file, "utf8"));
    console.log(`  ✓ نُفّذ ${dir}`);
  }

  // تحقق عكسي: كل نماذج schema.prisma يجب أن تكون جداول موجودة
  const expected = [
    "User", "Category", "Medicine", "Batch", "DrugInteraction",
    "StockMovement", "RegulatoryAction", "StockReservation", "SaleItemBatch",
    "Supplier", "PurchaseOrder", "PurchaseOrderItem", "Sale", "SaleItem",
    "LoginAudit", "Prescription", "PrescriptionItem", "Patient",
    "Notification", "Session", "Drug", "NationalDrug",
    "InvoiceCounter", "RateLimit",
    // v4.6 (P2) — التأمين المالي + تعدد الفروع
    "Branch", "InsuranceProvider", "PatientInsurancePolicy",
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

  // تحقق عكسي إضافي: أعمدة ZATCA على Sale
  const cols = await db.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'Sale'"
  );
  const saleCols = new Set(cols.rows.map((r) => r.column_name));
  const missingCols = ["vatRate", "vatTotal", "netOfVat", "invoiceNumber", "zatcaQr",
    // v4.6 (P2) — أعمدة التأمين والفرع
    "branchId", "insuranceProviderId", "insurancePolicyId", "insurerAmount", "patientAmount", "claimStatus"]
    .filter((c) => !saleCols.has(c));
  if (missingCols.length > 0) {
    console.error("✗ أعمدة ZATCA مفقودة على Sale:", missingCols.join(", "));
    process.exit(1);
  }

  console.log(
    `✓ كل الترحيلات (${dirs.length}) صالحة — نُفّذت بالترتيب في Postgres (WASM): ` +
      `${created.size} جدولاً + أعمدة ZATCA مكتملة`
  );
} catch (e) {
  console.error("✗ فشل تنفيذ الترحيلات:", e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  await db.close();
}
