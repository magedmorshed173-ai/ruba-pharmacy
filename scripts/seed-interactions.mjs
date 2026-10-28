/**
 * v5.0 — بذر التداخلات السريرية من clinical-data.json (يُشغَّل من خطوة البناء على Vercel)
 * upsert كامل: يضيف الجديد ويحدّث الموجود — آمن للتشغيل المتكرر مع كل نشر.
 * البيئة: يتطلب DATABASE_URL من نوع postgres (بيئة الإنتاج) — وإلا يخرج بصمت.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL || "";
if (!url.startsWith("postgres")) {
  console.log("seed-interactions: لا يوجد DATABASE_URL من نوع postgres — تخطٍّ (بيئة تطوير محلية)");
  process.exit(0);
}

const rows = JSON.parse(readFileSync(path.join(here, "clinical-data.json"), "utf-8"));
if (!Array.isArray(rows) || rows.length === 0 || rows.some((r) => r.length !== 10)) {
  throw new Error("clinical-data.json تالف — أعد التوليد عبر scripts/gen-clinical-json.py");
}

const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();

try {
  let created = 0;
  let updated = 0;
  for (const [a, b, sev, desc, mech, effect, mgmt, evidence, source, onset] of rows) {
    const existing = await db.drugInteraction.findUnique({
      where: { genericA_genericB: { genericA: a, genericB: b } },
      select: { id: true },
    });
    const data = {
      severity: sev,
      description: desc,
      mechanism: mech,
      clinicalEffect: effect,
      management: mgmt,
      evidenceLevel: evidence,
      source,
      onset,
      isActive: true,
    };
    if (existing) {
      await db.drugInteraction.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await db.drugInteraction.create({ data: { genericA: a, genericB: b, ...data } });
      created++;
    }
  }
  const total = await db.drugInteraction.count({ where: { isActive: true } });
  console.log(`seed-interactions: ✓ ${created} جديد، ${updated} محدَّث — الإجمالي الفعال ${total}`);
} finally {
  await db.$disconnect();
}
