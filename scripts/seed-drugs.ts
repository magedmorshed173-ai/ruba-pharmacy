/**
 * بذر دليل الدواء الوطني (v4.0) — التشغيل: bun scripts/seed-drugs.ts
 * Idempotent بالكامل: upsert بالاسم التجاري — آمن للتشغيل المتكرر (تطوير/CI/إنتاج).
 * يربط المنتجات الموجودة فعلياً بالمخزون عبر باركود seed.ts لتفعيل «التوفر الحي».
 */
import { PrismaClient } from "@prisma/client";

import { config } from "dotenv";

// v4.2 — فرض قيم .env (Neon) فوق متغيرات البيئة العامة القديمة
// v4.3 — حارس عزل E2E: DOTENV_KEEP_ENV=1 يعطّل التجاوز (القاعدة المفروضة من الحاضنة تبقى)
config({ override: process.env.DOTENV_KEEP_ENV !== "1", quiet: true });
import { DRUGS_A, type DrugSeed } from "./drug-catalog-a";
import { DRUGS_B, NEW_INTERACTIONS } from "./drug-catalog-b";
import { INTERACTIONS as BASE_INTERACTIONS } from "./clinical-interactions";

const db = new PrismaClient();

const DEFAULT_STORAGE =
  "يُحفظ في درجة حرارة أقل من 30° بعيداً عن الرطوبة ومتناول الأطفال.";

// ملاحظة حرجة: مفتاح الزوج يجب أن يطابق اتفاقية seed.ts حرفياً (الترتيب الخام كما في المصدر) —
// أي ترتيب أبجدي بديل يخلق صفاً مكرراً لنفس التداخل في القاعدة.
function pairKey(a: string, b: string): [string, string] {
  return [a.trim().toLowerCase(), b.trim().toLowerCase()];
}

async function main() {
  const all: DrugSeed[] = [...DRUGS_A, ...DRUGS_B];
  let linked = 0;

  for (let i = 0; i < all.length; i++) {
    const d = all[i];
    const data = {
      tradeName: d.t,
      scientificName: d.s.toLowerCase(),
      scientificNameAr: d.sar,
      atcCode: d.atc ?? null,
      atcClass: d.cls ?? null,
      form: d.form,
      strength: d.strength,
      manufacturer: d.mfr,
      country: d.country ?? null,
      priceHalalas: d.price,
      requiresRx: d.rx,
      category: d.cat,
      indications: d.ind,
      dosageGuide: d.dose,
      sideEffects: d.se,
      contraindications: d.ci,
      pregnancyCategory: d.preg ?? null,
      storage: d.storage ?? DEFAULT_STORAGE,
      registrNo: `N-26-4${String(100 + i).padStart(3, "0")}`,
      linkedBarcode: d.barcode ?? null,
      isActive: true,
    };
    await db.drug.upsert({
      where: { tradeName: d.t },
      create: data,
      update: data,
    });
    if (d.barcode) linked++;
  }

  // القاعدة السريرية الكاملة: 24 زوجاً أساسياً (مصدر واحد مشترك مع seed.ts) + 2 زوجان إضافيان للدليل
  for (const [a, b, sev, desc, mech, effect, mgmt, ev, src, onset] of [
    ...BASE_INTERACTIONS,
    ...NEW_INTERACTIONS,
  ] as typeof BASE_INTERACTIONS) {
    const [ga, gb] = pairKey(a, b);
    const data = {
      severity: sev,
      description: desc,
      mechanism: mech,
      clinicalEffect: effect,
      management: mgmt,
      evidenceLevel: ev,
      source: src,
      onset,
      isActive: true,
    };
    await db.drugInteraction.upsert({
      where: { genericA_genericB: { genericA: ga, genericB: gb } },
      create: { genericA: ga, genericB: gb, ...data },
      update: data,
    });
  }

  const interactive = await db.drugInteraction.count({ where: { isActive: true } });
  console.log(
    `✅ دليل الدواء: ${all.length} منتجاً مرخصاً (${linked} مربوط بالمخزون الحي عبر باركود) — قاعدة التداخلات السريرية: ${interactive} سجلاً حياً`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
