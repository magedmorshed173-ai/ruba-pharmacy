/**
 * سكربت البيانات التجريبية — ربي فارمسي v3.0
 * التشغيل: bun scripts/seed.ts
 */
import { PrismaClient } from "@prisma/client";

import { config } from "dotenv";

// v4.2 — فرض قيم .env (Neon) فوق متغيرات البيئة العامة القديمة
config({ override: true, quiet: true });
import { INTERACTIONS } from "./clinical-interactions";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

const DAY = 86400000;

function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * DAY);
}

function daysAgo(n: number, hour = 10, minute = 0): Date {
  const d = new Date(Date.now() - n * DAY);
  d.setHours(hour, minute, Math.floor(Math.random() * 50), 0);
  return d;
}

// [الاسم التجاري, العلمي, التصنيف, باركود, شراء(ر.س), بيع(ر.س), كمية, حد أدنى, صلاحية(يوم), جرعة, وصفة?, شركة]
const MEDICINES: [string, string, string, string, number, number, number, number, number, string, boolean, string][] = [
  ["باراسيتامول أدفيل", "paracetamol", "مسكنات وخوافض حرارة", "6281001000011", 3.5, 6.5, 220, 40, 420, "500mg", false, "SPIMACO"],
  ["إيبوبروفين", "ibuprofen", "مسكنات وخوافض حرارة", "6281001000012", 5.0, 9.5, 150, 30, 380, "400mg", false, "Julphar"],
  ["ديكلوفيناك جيل", "diclofenac", "مسكنات وخوافض حرارة", "6281001000013", 7.0, 13.0, 85, 20, 300, "1% 30g", false, "Novartis"],
  ["أسبرين بروتكت", "aspirin", "قلب وأوعية", "6281001000014", 4.0, 8.0, 160, 30, 540, "81mg", false, "Bayer"],
  ["أموكسيسيلين كبسولات", "amoxicillin", "مضادات حيوية", "6281001000021", 9.0, 16.0, 120, 25, 200, "500mg", true, "GSK"],
  ["أوجمنتين", "amoxicillin/clavulanic", "مضادات حيوية", "6281001000022", 18.0, 32.0, 70, 15, 250, "1g", true, "GSK"],
  ["أزيثرومايسين", "azithromycin", "مضادات حيوية", "6281001000023", 14.0, 25.0, 55, 12, 310, "250mg", true, "Pfizer"],
  ["سيبروفلوكساسين", "ciprofloxacin", "مضادات حيوية", "6281001000024", 11.0, 19.0, 40, 10, 95, "500mg", true, "Julphar"],
  ["أوميبرازول", "omeprazole", "جهاز هضمي", "6281001000031", 8.0, 15.0, 180, 35, 330, "20mg", false, "Teva"],
  ["رانيتيدين", "ranitidine", "جهاز هضمي", "6281001000032", 6.0, 11.0, 5, 10, 150, "150mg", false, "Tabuk"],
  ["جافيسكون شراب", "sodium alginate", "جهاز هضمي", "6281001000033", 12.0, 21.0, 65, 12, 400, "200ml", false, "Reckitt"],
  ["ميتفورمين", "metformin", "سكري", "6281001000041", 7.5, 13.5, 200, 40, 460, "850mg", true, "Merck"],
  ["جليكلازيد", "gliclazide", "سكري", "6281001000042", 10.0, 18.0, 90, 20, 380, "60mg", true, "Servier"],
  ["إنسولين لانتوس", "insulin glargine", "سكري", "6281001000043", 95.0, 160.0, 25, 8, 180, "100IU/ml", true, "Sanofi"],
  ["أملوديبين", "amlodipine", "قلب وأوعية", "6281001000051", 6.0, 11.5, 170, 30, 420, "5mg", true, "Pfizer"],
  ["لوسارتان", "losartan", "قلب وأوعية", "6281001000052", 9.0, 16.5, 130, 25, 400, "50mg", true, "MSD"],
  ["أتورفاستاتين", "atorvastatin", "قلب وأوعية", "6281001000053", 11.0, 20.0, 110, 25, 500, "20mg", true, "Pfizer"],
  ["وارفارين", "warfarin", "قلب وأوعية", "6281001000054", 13.0, 24.0, 35, 10, 210, "5mg", true, "Bristol"],
  ["فيتامين د3", "cholecalciferol", "فيتامينات ومكملات", "6281001000061", 15.0, 28.0, 140, 25, 600, "50000IU", false, "SPIMACO"],
  ["فيتامين سي فوار", "vitamin C", "فيتامينات ومكملات", "6281001000062", 8.0, 14.0, 190, 30, 540, "1000mg", false, "Bayer"],
  ["حديد فيروجلوبين", "ferrous sulfate", "فيتامينات ومكملات", "6281001000063", 12.0, 22.0, 75, 15, 450, "درعية", false, "Vitabiotics"],
  ["أوميغا 3", "omega-3", "فيتامينات ومكملات", "6281001000064", 25.0, 45.0, 60, 12, 700, "1000mg", false, "Now Foods"],
  ["فنتولين بخاخ", "salbutamol", "جهاز تنفسي", "6281001000071", 10.0, 18.0, 80, 18, 260, "100mcg", true, "GSK"],
  ["سيمبيكورت تيربوهالر", "budesonide/formoterol", "جهاز تنفسي", "6281001000072", 85.0, 145.0, 20, 6, 240, "160/4.5", true, "AstraZeneca"],
  ["مونتيلاكاست", "montelukast", "جهاز تنفسي", "6281001000073", 16.0, 29.0, 50, 10, 350, "10mg", true, "MSD"],
  ["زيرتك أقراص", "cetirizine", "مضادات حساسية", "6281001000081", 7.0, 13.0, 160, 30, 480, "10mg", false, "UCB"],
  ["كلاريتين شراب", "loratadine", "مضادات حساسية", "6281001000082", 11.0, 19.5, 90, 18, 430, "100ml", false, "Bayer"],
  ["أفيل كريم", "ibuprofen topical", "مسكنات وخوافض حرارة", "6281001000083", 14.0, 24.0, 3, 8, 90, "50g", false, "Abbott"],
  ["سيلدينافيل", "sildenafil", "قلب وأوعية", "6281001000091", 28.0, 49.0, 40, 10, 300, "50mg", true, "Pfizer"],
  ["إيزوسوربيد دينيترات", "isosorbide dinitrate", "قلب وأوعية", "6281001000092", 9.0, 17.0, 45, 12, 280, "10mg", true, "Ferring"],
];

// التصنيف التشريحي العلاجي الكيميائي (ATC) — أساس كشف العلاج المكرر
const ATC_INFO: Record<string, { atcCode: string; atcClass: string; maxDailyDose?: number }> = {
  paracetamol: { atcCode: "N02BE01", atcClass: "N02B — مسكنات وخوافض حرارة", maxDailyDose: 8 },
  ibuprofen: { atcCode: "M01AE01", atcClass: "M01A — مضادات التهاب غير ستيرويدية", maxDailyDose: 6 },
  "ibuprofen topical": { atcCode: "M02AA15", atcClass: "M01A — مضادات التهاب غير ستيرويدية" },
  diclofenac: { atcCode: "M01AB05", atcClass: "M01A — مضادات التهاب غير ستيرويدية" },
  aspirin: { atcCode: "B01AC06", atcClass: "B01AC — مضاد صفيحات", maxDailyDose: 8 },
  amoxicillin: { atcCode: "J01CA04", atcClass: "J01C — مضاد حيوي بيتا-لاكتام" },
  "amoxicillin/clavulanic": { atcCode: "J01CR02", atcClass: "J01C — مضاد حيوي بيتا-لاكتام" },
  azithromycin: { atcCode: "J01FA10", atcClass: "J01FA — ماكروليد" },
  ciprofloxacin: { atcCode: "J01MA02", atcClass: "J01MA — فلوروكينولون" },
  omeprazole: { atcCode: "A02BC01", atcClass: "A02BC — مثبط مضخة البروتون" },
  ranitidine: { atcCode: "A02BA02", atcClass: "A02BA — مضاد مستقبلات H2" },
  "sodium alginate": { atcCode: "A02BX", atcClass: "A02BX — مضاد حموضة موضعي" },
  metformin: { atcCode: "A10BA02", atcClass: "A10BA — بيجوانيد" },
  gliclazide: { atcCode: "A10BB09", atcClass: "A10BB — سلفونيل يوريا" },
  "insulin glargine": { atcCode: "A10AE04", atcClass: "A10AE — أنسولين طويل المفعول" },
  amlodipine: { atcCode: "C08CA01", atcClass: "C08CA — حاصر قنوات كالسيوم" },
  losartan: { atcCode: "C09CA01", atcClass: "C09CA — مضاد مستقبلات أنجيوتنسين" },
  atorvastatin: { atcCode: "C10AA05", atcClass: "C10AA — ستاتين" },
  warfarin: { atcCode: "B01AA03", atcClass: "B01AA — مضاد تجلط كومارين" },
  cholecalciferol: { atcCode: "A11CC05", atcClass: "A11CC — فيتامين د" },
  "vitamin C": { atcCode: "A11GA01", atcClass: "A11G — فيتامين ج" },
  "ferrous sulfate": { atcCode: "B03AA07", atcClass: "B03A — مكمل حديد" },
  "omega-3": { atcCode: "C10AX06", atcClass: "C10AX — أوميغا 3" },
  salbutamol: { atcCode: "R03AC02", atcClass: "R03AC — ناهض بيتا2 قصير" },
  "budesonide/formoterol": { atcCode: "R03AK07", atcClass: "R03AK — كورتيزون مستنشق مركب" },
  montelukast: { atcCode: "R03DC03", atcClass: "R03DC — مضاد لوكوترين" },
  cetirizine: { atcCode: "R06AE07", atcClass: "R06A — مضاد هيستامين جيل ثانٍ" },
  loratadine: { atcCode: "R06AX13", atcClass: "R06A — مضاد هيستامين جيل ثانٍ" },
  sildenafil: { atcCode: "G04BE03", atcClass: "G04BE — مثبط PDE5" },
  "isosorbide dinitrate": { atcCode: "C01DA08", atcClass: "C01DA — نترات عضوية" },
};

// قاعدة التداخلات السريرية — كل سجل: [المادة أ، المادة ب، الشدة، الوصف، الآلية، الأثر السريري، الإدارة، الأدلة، المصدر، البدء]
// مصادر التصنيف: Stockley's Drug Interactions، Lexicomp، تحذيرات FDA الرسمية
const PATIENTS: [string, string, string, string, string][] = [
  ["عبدالله محمد القحطاني", "1098447213", "0551234567", "warfarin, amlodipine, atorvastatin", "بنسلين"],
  ["فاطمة سعد الدوسري", "1077234518", "0567891234", "metformin, gliclazide", ""],
  ["خالد ناصر العتيبي", "1044558821", "0509876543", "salbutamol, montelukast", "أسبرين"],
  ["نورة فهد الشهري", "1022887734", "0533221144", "levothyroxine", ""],
  ["محمد عمر الزهراني", "1088665512", "0544556677", "losartan, atorvastatin, aspirin", "لاكتوز"],
];


// ─────── السجل الوطني للدواء (v3.7) ───────
// حالة تنظيمية افتراضية: مسجل وطنياً برقم تسجيل متسلسل وسقف سعر = سعر البيع
// الحالات الخاصة فوق نمط SFDA:
//  - رانيتيدين: معلق تنظيمياً — نمط حالة NDMA الحقيقية (تعليق عالمي 2020)
//  - أوميغا-3: غير مسجل (مكمل مستورد خارج نطاق التسجيل) — تنبيه غير حاجب
//  - باراسيتامول: سقف وطني 6.00 ريال أقل من سعر البيع 6.50 — إنذار تسعيري
const REGISTRY_SPECIAL: Record<
  string,
  { registryStatus?: string; unregistered?: true; maxRetailPrice?: number }
> = {
  ranitidine: { registryStatus: "suspended" },
  "omega-3": { registryStatus: "unregistered", unregistered: true },
  paracetamol: { maxRetailPrice: 600 },
};

function registryFor(generic: string, index: number, sellingPriceHalalas: number) {
  const special = REGISTRY_SPECIAL[generic] ?? {};
  return {
    registrationNo: special.unregistered ? null : `N-26-${String(1000 + index).slice(-4)}`,
    registryStatus: special.registryStatus ?? "registered",
    maxRetailPrice:
      special.maxRetailPrice !== undefined
        ? special.maxRetailPrice
        : special.unregistered
          ? null
          : sellingPriceHalalas,
  };
}

async function main() {
  console.log("🌱 بدء تعبئة البيانات التجريبية…");

  // 1) المستخدمون
  const usersData = [
    { username: "admin", fullName: "رنا العتيبي", role: "admin", phone: "0500000001", password: "Admin@2026!" },
    { username: "pharmacist", fullName: "سارة الحربي", role: "pharmacist", phone: "0500000002", password: "Pharm@2026!" },
    { username: "tech1", fullName: "محمد الغامدي", role: "technician", phone: "0500000003", password: "Tech@2026!" },
  ];
  const users: Record<string, { id: string }> = {};
  for (const u of usersData) {
    const user = await db.user.upsert({
      where: { username: u.username },
      update: {},
      create: { ...u, password: await bcrypt.hash(u.password, 10) },
    });
    users[u.username] = user;
  }
  console.log("✓ 3 مستخدمين");

  // 2) التصنيفات
  const catNames = Array.from(new Set(MEDICINES.map((m) => m[2])));
  const cats: Record<string, { id: string }> = {};
  for (const name of catNames) {
    cats[name] = await db.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`✓ ${catNames.length} تصنيفات`);

  // 3) الأدوية
  const meds: { id: string; barcode: string; name: string; genericName: string; quantity: number }[] = [];
  let medIndex = 0;
  for (const [name, generic, cat, bc, buy, sell, qty, min, exp, dose, rx, maker] of MEDICINES) {
    const atc = ATC_INFO[generic];
    const registry = registryFor(generic, medIndex++, Math.round(sell * 100));
    const med = await db.medicine.upsert({
      where: { barcode: bc },
      update: {
        // مزامنة الحقول السريرية والتنظيمية للأدوية الموجودة مسبقاً
        atcCode: atc?.atcCode ?? undefined,
        atcClass: atc?.atcClass ?? undefined,
        maxDailyDose: atc?.maxDailyDose ?? undefined,
        registrationNo: registry.registrationNo ?? undefined,
        registryStatus: registry.registryStatus,
        maxRetailPrice: registry.maxRetailPrice,
      },
      create: {
        name,
        genericName: generic,
        categoryId: cats[cat].id,
        barcode: bc,
        purchasePrice: Math.round(buy * 100),
        sellingPrice: Math.round(sell * 100),
        quantity: qty,
        minQuantity: min,
        expiryDate: daysFromNow(exp),
        productionDate: daysFromNow(-180),
        dosage: dose,
        requiresPrescription: rx,
        manufacturer: maker,
        atcCode: atc?.atcCode,
        atcClass: atc?.atcClass,
        maxDailyDose: atc?.maxDailyDose,
        registrationNo: registry.registrationNo,
        registryStatus: registry.registryStatus,
        maxRetailPrice: registry.maxRetailPrice,
      },
    });
    meds.push({ id: med.id, barcode: bc, name, genericName: med.genericName, quantity: med.quantity });
  }
  console.log(`✓ ${meds.length} أدوية (بتصنيف ATC)`);

  // 3-b) دفعات (LOT) ابتدائية — تضمن عمل صرف FEFO على أي قاعدة بيانات جديدة
  const needBatches = await db.medicine.findMany({
    where: { quantity: { gt: 0 }, batches: { none: {} } },
    select: { id: true, quantity: true, expiryDate: true, purchasePrice: true },
  });
  for (const m of needBatches) {
    await db.batch.create({
      data: {
        medicineId: m.id,
        lotNumber: "INIT",
        expiryDate: m.expiryDate,
        quantity: m.quantity,
        unitCost: m.purchasePrice,
        supplier: "رصيد افتتاحي",
      },
    });
  }
  if (needBatches.length) console.log(`✓ ${needBatches.length} دفعة ابتدائية (LOT)`);

  // 4) التداخلات السريرية — upsert كامل حتى تُحدّث السجلات القديمة بالحقول العلمية
  for (const [a, b, sev, desc, mech, effect, mgmt, evidence, source, onset] of INTERACTIONS) {
    await db.drugInteraction.upsert({
      where: { genericA_genericB: { genericA: a, genericB: b } },
      update: {
        severity: sev,
        description: desc,
        mechanism: mech,
        clinicalEffect: effect,
        management: mgmt,
        evidenceLevel: evidence,
        source,
        onset,
      },
      create: {
        genericA: a,
        genericB: b,
        severity: sev,
        description: desc,
        mechanism: mech,
        clinicalEffect: effect,
        management: mgmt,
        evidenceLevel: evidence,
        source,
        onset,
      },
    });
  }
  console.log(`✓ ${INTERACTIONS.length} تداخل دوائي موثق سريرياً`);

  // 4-b) السجل الوطني: الإجراء التنظيمي المعلّق (نمط حالة رانيتيدين/NDMA 2020)
  const ranitidine = meds.find((m) => m.genericName === "ranitidine");
  if (ranitidine) {
    const existingAction = await db.regulatoryAction.findFirst({
      where: { medicineId: ranitidine.id, actionType: "suspension", isActive: true },
    });
    if (!existingAction) {
      await db.regulatoryAction.create({
        data: {
          medicineId: ranitidine.id,
          actionType: "suspension",
          scope: "product",
          reason:
            "شوائب NDMA فوق الحد اليومي المسموح — تعليق وقائي للتداول حتى إشعار آخر (نمط حالة رانيتيدين التنظيمية 2020: FDA/EMA/الجهات الوطنية)",
          source: "SFDA",
          isActive: true,
        },
      });
      console.log("✓ إجراء تنظيمي: تعليق رانيتيدين (نمط NDMA)");
    }
  }

  // 5) المرضى
  for (const [name, nid, phone, chronic, allergy] of PATIENTS) {
    await db.patient.upsert({
      where: { nationalId: nid },
      update: {},
      create: {
        name,
        nationalId: nid,
        phone,
        chronicMedications: chronic,
        allergies: allergy || null,
      },
    });
  }
  console.log(`✓ ${PATIENTS.length} مرضى`);

  // 6) المبيعات التاريخية (آخر 30 يوم)
  const existingSales = await db.sale.count();
  if (existingSales === 0) {
    const sellers = ["admin", "pharmacist", "tech1"];
    let saleCount = 0;

    for (let day = 29; day >= 0; day--) {
      const salesToday = 1 + Math.floor(Math.random() * 4); // 1-4 فواتير/يوم
      for (let s = 0; s < salesToday; s++) {
        const seller = users[sellers[Math.floor(Math.random() * sellers.length)]];
        const itemsCount = 1 + Math.floor(Math.random() * 3);
        const picked = new Set<number>();
        const lines: { med: (typeof meds)[number]; qty: number; subtotal: number }[] = [];

        for (let i = 0; i < itemsCount; i++) {
          let idx = Math.floor(Math.random() * meds.length);
          let guard = 0;
          while (picked.has(idx) && guard++ < 10) idx = Math.floor(Math.random() * meds.length);
          picked.add(idx);
          const med = meds[idx];
          const qty = 1 + Math.floor(Math.random() * 3);
          // أسعار مبسطة: أعد حساب البيع من التعريف
          const def = MEDICINES.find((m) => m[3] === med.barcode)!;
          const subtotal = Math.round(def[5] * 100) * qty;
          lines.push({ med, qty, subtotal });
        }

        const total = lines.reduce((a, l) => a + l.subtotal, 0);
        const discount = Math.random() < 0.15 ? Math.round(total * 0.05) : 0;
        const payment = ["cash", "cash", "cash", "card", "insurance"][Math.floor(Math.random() * 5)];

        await db.sale.create({
          data: {
            customerName: ["عميل نقدي", "عميل نقدي", "عبدالله القحطاني", "فاطمة الدوسري", "خالد العتيبي"][
              Math.floor(Math.random() * 5)
            ],
            itemsCount: lines.length,
            totalAmount: total,
            discount,
            netAmount: total - discount,
            paymentMethod: payment,
            reference: `SEED-${day}-${s}`,
            userId: seller.id,
            saleDate: daysAgo(day, 9 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 59)),
            items: {
              create: lines.map((l) => ({
                medicineId: l.med.id,
                medicineName: l.med.name,
                quantity: l.qty,
                unitPrice: Math.round(l.subtotal / l.qty),
                subtotal: l.subtotal,
              })),
            },
          },
        });
        saleCount++;
      }
    }
    console.log(`✓ ${saleCount} فاتورة تاريخية (30 يوماً)`);
  } else {
    console.log(`• المبيعات موجودة مسبقاً (${existingSales}) — تخطي`);
  }

  // 7) الإشعارات الافتتاحية
  const today = new Date();
  const in90 = new Date(Date.now() + 90 * DAY);
  const dayKey = today.toISOString().slice(0, 10);
  const lowMeds = meds.filter((m) => m.quantity <= 10);
  for (const m of lowMeds) {
    await db.notification.upsert({
      where: { dedupeKey: `low:${m.id}:${dayKey}` },
      update: {},
      create: {
        kind: "low_stock",
        title: `نقص مخزون: ${m.name}`,
        body: `الكمية ${m.quantity} وحدة فقط`,
        dedupeKey: `low:${m.id}:${dayKey}`,
      },
    });
  }
  const expiring = await db.medicine.findMany({
    where: { expiryDate: { gt: today, lte: in90 } },
    select: { id: true, name: true, expiryDate: true },
  });
  for (const m of expiring) {
    await db.notification.upsert({
      where: { dedupeKey: `expiry:${m.id}:${dayKey}` },
      update: {},
      create: {
        kind: "expiry",
        title: `قرب انتهاء الصلاحية: ${m.name}`,
        body: `ينتهي بتاريخ ${m.expiryDate.toISOString().slice(0, 10)}`,
        dedupeKey: `expiry:${m.id}:${dayKey}`,
      },
    });
  }
  console.log(`✓ إشعارات: ${lowMeds.length} نقص + ${expiring.length} صلاحية`);

  console.log("\n🎉 البيانات التجريبية جاهزة!");
  console.log("   حسابات الدخول:");
  console.log("   admin / Admin@2026!  (مدير)");
  console.log("   pharmacist / Pharm@2026!  (صيدلي)");
  console.log("   tech1 / Tech@2026!  (فني)");
}

main()
  .catch((e) => {
    console.error("❌ فشل السكربت:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
