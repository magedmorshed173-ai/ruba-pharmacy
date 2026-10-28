/**
 * v5.0 — خطوة ما قبل البناء على Vercel:
 *  1) prisma migrate deploy — تطبيق الهجرات المعلقة (بيئة Vercel تملك
 *     DATABASE_URL/DIRECT_URL المحقونين من تكامل Neon).
 *  2) بذر/تحديث التداخلات السريرية من clinical-data.json.
 * سياسة best-effort: أي فشل يُطبع بوضوح ولا يُسقط البناء — التطبيق يُنشر
 * دائماً (الوضع السائد)، والميزات الجديدة تعمل بعد نجاح الهجرة.
 * محلياً (DATABASE_URL ليس postgres) تُتخطى الخطوة كلياً.
 */
import { execSync, spawnSync } from "node:child_process";

const url = process.env.DATABASE_URL || "";
if (!url.startsWith("postgres")) {
  console.log("prebuild: لا DATABASE_URL من نوع postgres — تخطي الهجرة والبذر");
  process.exit(0);
}

function run(cmd) {
  console.log(`\nprebuild ▶ ${cmd}`);
  const r = spawnSync(cmd, { shell: true, stdio: "inherit", env: process.env });
  return r.status;
}

const m = run("npx prisma migrate deploy");
if (m === 0) {
  console.log("prebuild: ✓ الهجرات مطبقة");
} else {
  console.warn("prebuild: ⚠ فشل migrate deploy — يُتابع البناء (best-effort)");
}

const s = run("node scripts/seed-interactions.mjs");
if (s === 0) {
  console.log("prebuild: ✓ التداخلات السريرية محدثة");
} else {
  console.warn("prebuild: ⚠ فشل بذر التداخلات — يُتابع البناء (best-effort)");
}
process.exit(0);
