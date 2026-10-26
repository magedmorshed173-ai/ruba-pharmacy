/**
 * بذر السجل الوطني المرخص (v4.1 — فجوة #1) — التشغيل: bun scripts/seed-national.ts
 *
 * يبني سجل التراخيص الرسمي (نمط SFDA) من كتالوج الدواء الفعلي:
 *  - رقم ترخيص رسمي لكل منتج (H5-XXXX مشتق من الباركود — حتمي وآمن للتكرار)
 *  - السعر الرسمي المعتمد (officialPrice) — مرجع التسعير الوطني
 *  - رانيتيدين مسحوب من السوق (نمط 2020 الحقيقي: شوائب NDMA — سحب عالمي فوري)
 *  - أوميغا-3 قيد التقييم (مكمل غذائي — ليس دواءً مرخصاً)
 *  - انحرافات تسعير مقصودة (أدول 600 / أسبرين 750) لتفعيل إنذار السعر الرسمي
 *
 * ثم يطبّق خطة المزامنة فوراً (نمط «التصعيد بلا رجوع»):
 *  ربط + مواءمة أرقام الترخيص + التسعير الرسمي + الحجب التلقائي للمسحوب
 *  (إجراء تنظيمي موثق + إشعار dedupeKey — بلا رجوع للحجب المحلي الأشد).
 * Idempotent بالكامل — آمن للتشغيل المتكرر (تطوير/CI/إنتاج).
 */
import { PrismaClient } from "@prisma/client";
import { DRUGS_A, type DrugSeed } from "./drug-catalog-a";
import { DRUGS_B } from "./drug-catalog-b";
import {
  computeSyncPlan,
  type NationalEntryInput,
} from "../src/lib/national-license";

const db = new PrismaClient();

// ── تجاوزات الترخيص والتسعير (حالات حقيقية موثقة) ──
const LICENSE_OVERRIDES: Record<
  string, // المادة الفعالة (s)
  Partial<{
    licenseStatus: "licensed" | "suspended" | "withdrawn" | "pending";
    officialPrice: number; // هللات — السعر الرسمي المعتمد
    withdrawnAt: Date;
    withdrawalReason: string;
  }>
> = {
  // نمط رانيتيدين الحقيقي: تعليق ثم سحب عالمي (2020) بسبب شوائب NDMA
  ranitidine: {
    licenseStatus: "withdrawn",
    withdrawnAt: new Date("2020-04-15"),
    withdrawalReason:
      "شوائب نيتروسامين (NDMA) فوق الحد المسموح — سحب وقائي عالمي من السوق",
  },
  // مكمل غذائي قيد التقييم — لا يُصنف دواءً مرخصاً بعد
  "omega-3": { licenseStatus: "pending" },
  // انحرافات تسعير مقصودة: السعر الرسمي أدنى من سعر البيع الحالي
  paracetamol: { officialPrice: 600 },
  aspirin: { officialPrice: 750 },
};

interface NationalSeed {
  registrationNo: string;
  tradeName: string;
  genericName: string;
  dosage: string | null;
  form: string | null;
  manufacturer: string | null;
  country: string | null;
  atcCode: string | null;
  barcode: string | null;
  licenseStatus: "licensed" | "suspended" | "withdrawn" | "pending";
  officialPrice: number | null;
  withdrawnAt: Date | null;
  withdrawalReason: string | null;
}

/** رقم ترخيص حتمي من الباركود: 6281001000032 → H5-0032 */
function regNoFromBarcode(barcode: string): string {
  return `H5-${barcode.slice(-4)}`;
}

function buildSeeds(): NationalSeed[] {
  const all: DrugSeed[] = [...DRUGS_A, ...DRUGS_B];
  const seeds: NationalSeed[] = [];
  for (const d of all) {
    if (!d.barcode) continue;
    const ov = LICENSE_OVERRIDES[d.s] ?? {};
    const licenseStatus = ov.licenseStatus ?? "licensed";
    seeds.push({
      registrationNo: regNoFromBarcode(d.barcode),
      tradeName: d.t,
      genericName: d.sar,
      dosage: d.strength,
      form: d.form,
      manufacturer: d.mfr,
      country: d.country ?? null,
      atcCode: d.atc ?? null,
      barcode: d.barcode,
      licenseStatus,
      officialPrice: ov.officialPrice ?? d.price,
      withdrawnAt: licenseStatus === "withdrawn" ? (ov.withdrawnAt ?? new Date()) : null,
      withdrawalReason:
        licenseStatus === "withdrawn" ? (ov.withdrawalReason ?? "سحب تنظيمي") : null,
    });
  }
  return seeds;
}

async function main() {
  const seeds = buildSeeds();
  const now = new Date();

  // ── 1) استيراد السجل المرخص (upsert برقم الترخيص) ──
  for (const s of seeds) {
    const data = {
      tradeName: s.tradeName,
      genericName: s.genericName,
      dosage: s.dosage,
      form: s.form,
      manufacturer: s.manufacturer,
      country: s.country,
      atcCode: s.atcCode,
      barcode: s.barcode,
      licenseStatus: s.licenseStatus,
      officialPrice: s.officialPrice,
      priceEffectiveAt: s.officialPrice ? now : null,
      withdrawnAt: s.withdrawnAt,
      withdrawalReason: s.withdrawalReason,
      source: "SFDA",
      syncedAt: now,
    };
    await db.nationalDrug.upsert({
      where: { registrationNo: s.registrationNo },
      create: { registrationNo: s.registrationNo, ...data },
      update: data,
    });
  }
  console.log(`📜 السجل المرخص: ${seeds.length} ترخيصاً مستورداً (نمط SFDA)`);

  // ── 2) حساب خطة المزامنة على المخزون المحلي وتنفيذها ──
  const [entries, meds] = await Promise.all([
    db.nationalDrug.findMany({ take: 500 }),
    db.medicine.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        dosage: true,
        barcode: true,
        registrationNo: true,
        registryStatus: true,
        nationalDrugId: true,
        sellingPrice: true,
        maxRetailPrice: true,
      },
    }),
  ]);

  const plan = computeSyncPlan(
    meds,
    entries as unknown as NationalEntryInput[]
  );

  let linked = 0,
    regAligned = 0,
    priced = 0,
    autoBlocked = 0,
    manual = 0;

  for (const item of plan) {
    if (!item.matched) {
      console.log(`   ⚠️  غير مدرج في السجل المرخص: ${item.name}`);
      continue;
    }
    const data: Record<string, unknown> = {};
    if (item.actions.linkNationalDrug) {
      data.nationalDrugId = item.actions.linkNationalDrug;
      linked++;
    }
    if (item.actions.setRegistrationNo) {
      data.registrationNo = item.actions.setRegistrationNo;
      regAligned++;
    }
    if (item.actions.setMaxRetailPrice !== undefined) {
      data.maxRetailPrice = item.actions.setMaxRetailPrice;
      priced++;
    }

    if (item.actions.escalateToSuspended) {
      data.registryStatus = "suspended";
      autoBlocked++;
      await db.regulatoryAction.create({
        data: {
          medicineId: item.medicineId,
          actionType: "suspension",
          scope: "product",
          reason: `حجب تلقائي من مزامنة السجل المرخص: ترخيص ${item.registrationNo} (${item.licenseStatus === "withdrawn" ? "مسحوب من السوق" : "الترخيص معلق"}) — ${item.alerts.find((a) => a.blocking)?.message ?? ""}`,
          source: "SFDA-Sync",
          isActive: true,
        },
      });
      await db.notification.upsert({
        where: { dedupeKey: `natsync:${item.registrationNo}:${item.licenseStatus}` },
        update: { isRead: false },
        create: {
          kind: "warning",
          title: `حجب تلقائي: ${item.name}`,
          body: `ترخيص ${item.registrationNo} ${item.licenseStatus === "withdrawn" ? "مسحوب من السوق" : "معلق"} — الصرف محجوب بلا تجاوز حتى رفع القرار`,
          dedupeKey: `natsync:${item.registrationNo}:${item.licenseStatus}`,
        },
      });
    }

    if (item.actions.needsManualReview) {
      manual++;
      console.log(`   ✋ مراجعة يدوية (مرخص وطنياً لكن محجوب محلياً): ${item.name}`);
    }

    if (Object.keys(data).length > 0) {
      await db.medicine.update({ where: { id: item.medicineId }, data });
    }
  }

  const byStatus = await db.nationalDrug.groupBy({
    by: ["licenseStatus"],
    _count: { _all: true },
  });
  const statusLine = byStatus
    .map((g) => `${g.licenseStatus}=${g._count._all}`)
    .join(" · ");

  console.log(
    `✅ مزامنة الطبقة المرخصة: ربط=${linked} · مواءمة ترخيص=${regAligned} · تسعير رسمي=${priced} · حجب تلقائي=${autoBlocked} · مراجعة يدوية=${manual}`
  );
  console.log(`📋 حالة التراخيص: ${statusLine}`);

  // إنذارات السعر الرسمي القائمة بعد المزامنة
  const priceAlerts = plan.flatMap((p) => p.alerts).filter((a) => a.kind === "price_cap");
  for (const a of priceAlerts) console.log(`   💰 ${a.message}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
