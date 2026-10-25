/**
 * سكربت البيانات التجريبية — ربي فارمسي v3.0
 * التشغيل: bun scripts/seed.ts
 */
import { PrismaClient } from "@prisma/client";
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
];

// تداخلات دوائية حقيقية موثقة
const INTERACTIONS: [string, string, string, string, string][] = [
  ["warfarin", "aspirin", "major", "زيادة خطر النزف الحاد عند الجمع بين مضاد تجلط ومضاد صفيحات.", "تجنب الجمع إن أمكن؛ وإلا مراقبة INR عن قرب ومراقبة علامات النزف."],
  ["warfarin", "ibuprofen", "major", "مضادات الالتهاب غير الستيرويدية تزيد تأثير الوارفارين وخطر نزف الجهاز الهضمي.", "استبدل بالباراسيتامول كمسكن آمن مع مراقبة INR."],
  ["warfarin", "paracetamol", "moderate", "الاستخدام المطول للباراسيتامول بجرعات عالية قد يرفع INR.", "حدد الجرعة لأقل فترة ممكنة وراقب INR بعد 3-5 أيام."],
  ["ciprofloxacin", "calcium", "moderate", "الكالسيوم يقلل امتصاص السيبروفلوكساسين بشكل كبير.", "أعط المضاد الحيوي قبل ساعتين أو بعد 6 ساعات من مكملات الكالسيوم."],
  ["amoxicillin", "methotrexate", "moderate", "الأموكسيسيلين يقلل إفراز الميثوتركسات ويزيد سميته.", "راقب تعداد الدم ووظائف الكلى عند الضرورة القصوى للجمع."],
  ["metformin", "prednisolone", "moderate", "الكورتيزون يرفع سكر الدم ويضعف فعالية الميتفورمين.", "راقب سكر الدم بانتظام وقد يلزم تعديل جرعة الميتفورمين مؤقتاً."],
];

const PATIENTS: [string, string, string, string, string][] = [
  ["عبدالله محمد القحطاني", "1098447213", "0551234567", "warfarin, amlodipine, atorvastatin", "بنسلين"],
  ["فاطمة سعد الدوسري", "1077234518", "0567891234", "metformin, gliclazide", ""],
  ["خالد ناصر العتيبي", "1044558821", "0509876543", "salbutamol, montelukast", "أسبرين"],
  ["نورة فهد الشهري", "1022887734", "0533221144", "levothyroxine", ""],
  ["محمد عمر الزهراني", "1088665512", "0544556677", "losartan, atorvastatin, aspirin", "لاكتوز"],
];

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
  for (const [name, generic, cat, bc, buy, sell, qty, min, exp, dose, rx, maker] of MEDICINES) {
    const med = await db.medicine.upsert({
      where: { barcode: bc },
      update: {},
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
      },
    });
    meds.push({ id: med.id, barcode: bc, name, genericName: med.genericName, quantity: med.quantity });
  }
  console.log(`✓ ${meds.length} أدوية`);

  // 4) التداخلات
  for (const [a, b, sev, desc, mgmt] of INTERACTIONS) {
    const exists = await db.drugInteraction.findUnique({
      where: { genericA_genericB: { genericA: a, genericB: b } },
    });
    if (!exists) {
      await db.drugInteraction.create({
        data: { genericA: a, genericB: b, severity: sev, description: desc, management: mgmt },
      });
    }
  }
  console.log(`✓ ${INTERACTIONS.length} تداخلات دوائية`);

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
