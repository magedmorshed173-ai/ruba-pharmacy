/**
 * جناح الاختبارات الحية — ربي فارمسي v4.0
 * مبدأ أساسي: لا محاكاة ولا Mock — خادم إنتاجي حقيقي (standalone build)،
 * قاعدة بيانات SQLite حقيقية، طلبات HTTP فعلية، وتحقق مباشر من قاعدة البيانات.
 *
 * التشغيل: bun run test:e2e  (يتطلب بناء إنتاجي مسبقاً: bun run build)
 * في CI: خطوة منفصلة بعد build — انظر .github/workflows/ci.yml
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// ───────────────────────── البيئة ─────────────────────────
const ROOT = path.resolve(__dirname, "../..");
const PORT = process.env.E2E_PORT || "3987";
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = path.join(ROOT, ".tmp-e2e");
const DB_FILE = path.join(TMP, "e2e.db");
const DATABASE_URL = `file:${DB_FILE}`;

process.env.DATABASE_URL = DATABASE_URL;
process.env.AUTH_SECRET = "e2e-live-secret-not-for-production";

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });

// ───────────────────────── أدوات ─────────────────────────
let passed = 0;
const failures: string[] = [];

function assert(cond: unknown, label: string, extra?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label + (extra ? ` — ${extra}` : ""));
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

interface HttpResult {
  status: number;
  headers: Headers;
  body: any;
}

async function req(
  method: "GET" | "POST" | "PUT" | "DELETE",
  apiPath: string,
  opts: { cookie?: string; json?: unknown; ua?: string } = {}
): Promise<HttpResult> {
  const res = await fetch(BASE + apiPath, {
    method,
    headers: {
      ...(opts.json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      ...(opts.ua ? { "User-Agent": opts.ua } : {}),
    },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, body };
}

function cookieFrom(res: HttpResult): string {
  const set = res.headers.getSetCookie?.() ?? [];
  const main = set.find((c) => c.startsWith("ruba_token="));
  if (!main) throw new Error("لم يُصدر الخادم كوكي الجلسة");
  return main.split(";")[0];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// جلسات المستخدمين
const jar: Record<string, string> = {};

async function login(username: string, password: string): Promise<void> {
  const r = await req("POST", "/api/auth/login", { json: { username, password } });
  if (r.status !== 200) throw new Error(`فشل دخول ${username}: ${r.status}`);
  jar[username] = cookieFrom(r);
}

let server: ChildProcess | null = null;

async function startServer(): Promise<void> {
  server = spawn("bun", ["server.js"], {
    cwd: path.join(ROOT, ".next/standalone"),
    env: {
      ...process.env,
      PORT,
      HOSTNAME: "127.0.0.1",
      DATABASE_URL,
      AUTH_SECRET: process.env.AUTH_SECRET!,
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (d) => {
    if (process.env.E2E_VERBOSE) process.stdout.write(`[srv] ${d}`);
  });
  server.stderr?.on("data", (d) => {
    if (process.env.E2E_VERBOSE) process.stdout.write(`[srv!] ${d}`);
  });

  // انتظار أول استجابة (401 متوقع بلا كوكي — المهم أن يرد الخادم)
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/auth/me`);
      if (r.status >= 200) return;
    } catch {
      /* لم يجهز بعد */
    }
    await sleep(500);
  }
  throw new Error("الخادم لم يستجب خلال 30 ثانية");
}

function stopServer() {
  server?.kill("SIGTERM");
}

// ───────────────────────── الإعداد ─────────────────────────
async function setup(): Promise<void> {
  console.log("⚙️  تجهيز قاعدة بيانات E2E حية…");
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  const push = spawnSync("bunx", ["prisma", "db", "push", "--skip-generate"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL },
    encoding: "utf-8",
  });
  if (push.status !== 0) throw new Error(`prisma db push فشل:\n${push.stderr}`);

  const seed = spawnSync("bun", ["scripts/seed.ts"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL },
    encoding: "utf-8",
  });
  if (seed.status !== 0) throw new Error(`seed فشل:\n${seed.stderr}`);

  // v4.0: دليل الدواء المرخص — idempotent، يلي seed الأساسي دائماً
  const seedDrugs = spawnSync("bun", ["scripts/seed-drugs.ts"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL },
    encoding: "utf-8",
  });
  if (seedDrugs.status !== 0) throw new Error(`seed-drugs فشل:\n${seedDrugs.stderr}`);

  console.log("🚀 تشغيل خادم الإنتاج (standalone)…");
  await startServer();
}

// ───────────────────────── السيناريوهات ─────────────────────────
async function scenarios(): Promise<void> {
  let medicineRows: any[] = [];
  let patients: any[] = [];

  // S1 — حماية المصادقة
  console.log("\n▶ S1: حماية الوصول بلا جلسة");
  {
    const r = await req("GET", "/api/medicines");
    assert(r.status === 401, "الوصول بلا جلسة → 401", `وصل ${r.status}`);
  }

  // S2 — دخول فاشل مسجّل في التدقيق
  console.log("\n▶ S2: دخول فاشل + سجل تدقيق");
  {
    const r = await req("POST", "/api/auth/login", {
      json: { username: "admin", password: "Wrong@Pass1" },
    });
    assert(r.status === 401, "كلمة مرور خاطئة → 401", `وصل ${r.status}`);
    const audit = await prisma.loginAudit.findFirst({
      where: { username: "admin", success: false },
      orderBy: { createdAt: "desc" },
    });
    assert(!!audit, "المحاولة الفاشلة مسجلة في LoginAudit");
  }

  // S3/S4 — دخول ناجح + جلسة
  console.log("\n▶ S3: دخول المدير والصيدلي والفني");
  await login("admin", "Admin@2026!");
  await login("pharmacist", "Pharm@2026!");
  await login("tech1", "Tech@2026!");
  assert(!!jar.admin, "مدير: كوكي جلسة صادر");
  {
    const setCookie = await req("POST", "/api/auth/login", {
      json: { username: "admin", password: "Admin@2026!" },
    });
    const raw = setCookie.headers.getSetCookie().find((c) => c.startsWith("ruba_token=")) ?? "";
    assert(raw.includes("HttpOnly"), "الكوكي HttpOnly");
  }
  {
    const me = await req("GET", "/api/auth/me", { cookie: jar.admin });
    assert(
      me.status === 200 && me.body?.user?.role === "admin",
      "الجلسة تعيد بيانات المستخدم من قاعدة البيانات"
    );
  }

  // S5 — رؤوس الأمان
  console.log("\n▶ S5: رؤوس الأمان على الاستجابات الحية");
  {
    const r = await req("GET", "/api/auth/me");
    assert(
      r.headers.get("x-content-type-options") === "nosniff",
      "X-Content-Type-Options: nosniff"
    );
    assert(!!r.headers.get("content-security-policy"), "CSP موجود");
    assert(r.headers.get("x-frame-options") === "SAMEORIGIN", "X-Frame-Options: SAMEORIGIN");
    assert(
      r.headers.get("referrer-policy") === "strict-origin-when-cross-origin",
      "Referrer-Policy"
    );
  }

  // S6 — البيانات مزروعة
  console.log("\n▶ S6: البيانات التجريبية حية");
  {
    const r = await req("GET", "/api/medicines?pageSize=60", { cookie: jar.admin });
    assert(r.status === 200, "قائمة الأدوية 200");
    medicineRows = r.body?.results ?? [];
    assert(medicineRows.length >= 30, `الأدوية المزروعة ≥ 30 (${medicineRows.length})`);
    assert(
      medicineRows.every((m: any) => m.atcClass),
      "كل الأدوية تحمل تصنيف ATC"
    );
    const pats = await req("GET", "/api/patients", { cookie: jar.admin });
    patients = pats.body?.patients ?? pats.body?.results ?? [];
    assert(patients.length >= 5, `المرضى المزروعون ≥ 5 (${patients.length})`);
  }

  const barcodeOf = (generic: string) =>
    medicineRows.find((m: any) => m.genericName === generic)?.barcode;

  // S7 — تداخل سلة: وارفارين + أسبرين (سجل سريري كامل)
  console.log("\n▶ S7: فحص تداخل وارفارين+أسبرين");
  {
    const r = await req("POST", "/api/interactions/check", {
      cookie: jar.admin,
      json: { barcodes: [barcodeOf("warfarin"), barcodeOf("aspirin")] },
    });
    const hit = (r.body?.interactions ?? []).find(
      (h: any) => h.genericA === "warfarin" && h.genericB === "aspirin"
    );
    assert(!!hit, "رصد التداخل");
    assert(hit?.severity === "major", "الشدة major");
    assert(!!hit?.mechanism && hit.mechanism.length > 20, "الآلية الدوائية موجودة");
    assert(!!hit?.management && hit.management.length > 20, "خطة الإدارة موجودة");
    assert(!!hit?.source, `المصدر العلمي (${hit?.source})`);
    assert(hit?.context === "cart", "سياق التداخل: داخل السلة");
  }

  // S8 — تداخل مع الأدوية المزمنة للمريض
  console.log("\n▶ S8: تداخل سلة ↔ المريض المزمن");
  const abdullah = patients.find((p: any) => p.nationalId === "1098447213");
  {
    const r = await req("POST", "/api/interactions/check", {
      cookie: jar.pharmacist,
      json: { barcodes: [barcodeOf("aspirin")], patientId: abdullah?.id },
    });
    const hit = (r.body?.interactions ?? []).find((h: any) => h.context === "patient");
    assert(!!hit, "رصد تداخل مع warfarin المزمن للمريض");
    assert(hit?.severity === "major", "شدة تداخل المريض major");
  }

  // S9 — حساسية المريض (بنسلين) مع أموكسيسيلين
  console.log("\n▶ S9: تعارض حساسية البنسلين");
  {
    const r = await req("POST", "/api/interactions/check", {
      cookie: jar.pharmacist,
      json: { barcodes: [barcodeOf("amoxicillin")], patientId: abdullah?.id },
    });
    const alerts = r.body?.allergyAlerts ?? [];
    assert(alerts.length >= 1, "رصد تعارض الحساسية");
    assert(
      (alerts[0]?.familyAr ?? "").includes("البنسلين"),
      `العائلة صحيحة (${alerts[0]?.familyAr})`
    );
    assert(r.body?.blocking === true, "تعارض الحساسية يحجب البيع");
  }

  // S10 — العلاج المكرر (إيبوبروفين + ديكلوفيناك من نفس الفئة)
  console.log("\n▶ S10: كشف العلاج المكرر");
  {
    const r = await req("POST", "/api/interactions/check", {
      cookie: jar.admin,
      json: { barcodes: [barcodeOf("ibuprofen"), barcodeOf("diclofenac")] },
    });
    const groups = r.body?.duplicateTherapies ?? [];
    assert(
      groups.length === 1,
      "مجموعة مكررة واحدة",
      `debug=${JSON.stringify(r.body?.duplicateTherapies)}`
    );
    assert((groups[0]?.names ?? []).length === 2, "الدواءان داخل المجموعة نفسها");
  }

  // S11 — بوابة الحجب: ممنوع سريرياً (سيلدينافيل + نترات) بلا تجاوز
  console.log("\n▶ S11: حجب بيع ممنوع سريرياً (صيدلي بلا تجاوز)");
  {
    const r = await req("POST", "/api/sales", {
      cookie: jar.pharmacist,
      json: {
        items: [
          { barcode: barcodeOf("sildenafil"), quantity: 1 },
          { barcode: barcodeOf("isosorbide dinitrate"), quantity: 1 },
        ],
        transactionId: "E2E-CONTRA-1",
      },
    });
    assert(r.status === 409, "409 للصيدلي بلا تأكيد تجاوز", `وصل ${r.status}`);
    assert(r.body?.clinicalBlock === true, "علم clinicalBlock مرفوع");
    assert(
      (r.body?.clinicalReview?.interactions ?? []).some(
        (i: any) => i.severity === "contraindicated"
      ),
      "المراجعة تُظهر ممنوع سريرياً"
    );
  }

  // S12 — الفني محجوب حتى مع محاولة التجاوز
  console.log("\n▶ S12: الفني محجوب دائماً من ممنوع سريرياً");
  {
    const r = await req("POST", "/api/sales", {
      cookie: jar.tech1,
      json: {
        items: [
          { barcode: barcodeOf("sildenafil"), quantity: 1 },
          { barcode: barcodeOf("isosorbide dinitrate"), quantity: 1 },
        ],
        transactionId: "E2E-CONTRA-2",
        clinicalOverride: true,
      },
    });
    assert(r.status === 403, "403 للفني حتى مع clinicalOverride", `وصل ${r.status}`);
  }

  // S13 — الصيدلي يتجاوز بمسؤولية مسجلة
  console.log("\n▶ S13: تجاوز سريري مسؤول (صيدلي) يُسجل في الفاتورة");
  {
    const r = await req("POST", "/api/sales", {
      cookie: jar.pharmacist,
      json: {
        items: [
          { barcode: barcodeOf("sildenafil"), quantity: 1 },
          { barcode: barcodeOf("isosorbide dinitrate"), quantity: 1 },
        ],
        transactionId: "E2E-CONTRA-3",
        clinicalOverride: true,
      },
    });
    assert(
      r.status === 201,
      "البيع تم بعد التجاوز المسؤول",
      `وصل ${r.status} ${JSON.stringify(r.body?.error ?? "")}`
    );
    const sale = await prisma.sale.findUnique({
      where: { reference: "E2E-CONTRA-3" },
    });
    assert(sale?.clinicalOverride === true, "علامة clinicalOverride محفوظة للتدقيق");
    assert(
      (r.body?.clinicalReview?.interactions ?? []).length >= 1,
      "المراجعة السريرية مرفقة بالاستجابة"
    );
  }

  // S14 — Idempotency
  console.log("\n▶ S14: منع البيع المكرر (Idempotency)");
  {
    const r = await req("POST", "/api/sales", {
      cookie: jar.pharmacist,
      json: {
        items: [
          { barcode: barcodeOf("sildenafil"), quantity: 1 },
          { barcode: barcodeOf("isosorbide dinitrate"), quantity: 1 },
        ],
        transactionId: "E2E-CONTRA-3",
        clinicalOverride: true,
      },
    });
    assert(r.status === 200 && r.body?.duplicated === true, "المرجع نفسه → duplicated");
    const count = await prisma.sale.count({ where: { reference: "E2E-CONTRA-3" } });
    assert(count === 1, "فاتورة واحدة فقط في قاعدة البيانات");
  }

  // S15 — بيع عادي: خصم مخزون + حركة تدقيق
  console.log("\n▶ S15: بيع عادي (فني) — خصم FEFO وحركة مخزون");
  {
    const paracetamolBefore = await prisma.medicine
      .findUnique({ where: { barcode: barcodeOf("paracetamol") } })
      .then((m) => m!.quantity);
    const r = await req("POST", "/api/sales", {
      cookie: jar.tech1,
      json: {
        items: [{ barcode: barcodeOf("paracetamol"), quantity: 2 }],
        transactionId: "E2E-SALE-1",
      },
    });
    assert(r.status === 201, "البيع العادي 201", `وصل ${r.status}`);
    const after = await prisma.medicine
      .findUnique({ where: { barcode: barcodeOf("paracetamol") } })
      .then((m) => m!.quantity);
    assert(
      after === paracetamolBefore - 2,
      `المخزون نقص 2 (${paracetamolBefore}→${after})`
    );
    const mv = await prisma.stockMovement.findFirst({
      where: { reference: "E2E-SALE-1", type: "sale" },
    });
    assert(!!mv && mv.delta === -2, "حركة مخزون sale بـ delta=-2");
    assert(mv?.balanceAfter === after, "balanceAfter مطابق للرصيد الفعلي");
  }

  // S16 — FEFO: الأقرب انتهاءً يُصرف أولاً
  console.log("\n▶ S16: صرف FEFO عبر دفعات حقيقية");
  {
    const med = await prisma.medicine.findUnique({
      where: { barcode: barcodeOf("paracetamol") },
    });
    const a = await req("POST", "/api/medicines/restock", {
      cookie: jar.pharmacist,
      json: {
        medicineId: med!.id,
        quantity: 5,
        lotNumber: "E2E-LOT-A",
        expiryDate: new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10),
        unitCost: 200,
      },
    });
    assert(a.status === 201, "إضافة الدفعة A (+40 يوم)", JSON.stringify(a.body?.error ?? ""));
    const b = await req("POST", "/api/medicines/restock", {
      cookie: jar.pharmacist,
      json: {
        medicineId: med!.id,
        quantity: 10,
        lotNumber: "E2E-LOT-B",
        expiryDate: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
        unitCost: 100,
      },
    });
    assert(b.status === 201, "إضافة الدفعة B (+90 يوم)");

    const r = await req("POST", "/api/sales", {
      cookie: jar.tech1,
      json: {
        items: [{ barcode: barcodeOf("paracetamol"), quantity: 7 }],
        transactionId: "E2E-FEFO-1",
      },
    });
    assert(r.status === 201, "بيع 7 وحدات عبر الدفعات");
    const [lotA, lotB] = await Promise.all([
      prisma.batch.findFirst({ where: { medicineId: med!.id, lotNumber: "E2E-LOT-A" } }),
      prisma.batch.findFirst({ where: { medicineId: med!.id, lotNumber: "E2E-LOT-B" } }),
    ]);
    assert(lotA?.quantity === 0, `الدفعة A (الأقرب) نُفدت (${lotA?.quantity})`);
    assert(lotB?.quantity === 8, `الدفعة B نقص منها 2 فقط (${lotB?.quantity})`);
  }

  // S17 — الدفعة المنتهية محجوبة عن الصرف
  console.log("\n▶ S17: حجب الصرف من دفعة منتهية");
  {
    const cat = await prisma.category.findFirst();
    const med = await prisma.medicine.create({
      data: {
        name: "E2E دواء منتهي",
        genericName: "expired-only-e2e",
        categoryId: cat!.id,
        barcode: "6281001999991",
        purchasePrice: 500,
        sellingPrice: 900,
        quantity: 20,
        minQuantity: 5,
        expiryDate: new Date(Date.now() - 86400000),
        atcClass: "X99 — اختباري",
      },
    });
    await prisma.batch.create({
      data: {
        medicineId: med.id,
        lotNumber: "E2E-EXPIRED",
        expiryDate: new Date(Date.now() - 86400000),
        quantity: 20,
        unitCost: 500,
      },
    });
    const r = await req("POST", "/api/sales", {
      cookie: jar.tech1,
      json: {
        items: [{ barcode: "6281001999991", quantity: 1 }],
        transactionId: "E2E-EXPIRED-1",
      },
    });
    assert(r.status === 400, "رفض البيع من دفعة منتهية", `وصل ${r.status}`);
    assert(
      String(r.body?.error ?? "").includes("صالح"),
      `الرسالة توضح غياب الصالح (${r.body?.error})`
    );
    await prisma.medicine.delete({ where: { id: med.id } });
  }

  // S18 — مخزون غير كافٍ
  console.log("\n▶ S18: رفض بيع أكبر من المتوفر");
  {
    const med = await prisma.medicine.findUnique({
      where: { barcode: barcodeOf("warfarin") },
    });
    const r = await req("POST", "/api/sales", {
      cookie: jar.tech1,
      json: {
        items: [{ barcode: barcodeOf("warfarin"), quantity: med!.quantity + 500 }],
        transactionId: "E2E-OVER-1",
      },
    });
    assert(r.status === 400, "رفض البيع 400");
    assert(String(r.body?.error ?? "").includes("مخزون"), "الرسالة تذكر المخزون");
  }

  // S19 — الإلغاء والاسترجاع
  console.log("\n▶ S19: إلغاء فاتورة واسترجاع الكميات");
  {
    const sale = await prisma.sale.findUnique({
      where: { reference: "E2E-SALE-1" },
      include: { items: true },
    });
    const medId = sale!.items[0].medicineId;
    const before = await prisma.medicine
      .findUnique({ where: { id: medId } })
      .then((m) => m!.quantity);
    const r = await req("POST", `/api/sales/${sale!.id}/void`, { cookie: jar.pharmacist });
    assert(r.status === 200, "الإلغاء نجح");
    const after = await prisma.medicine
      .findUnique({ where: { id: medId } })
      .then((m) => m!.quantity);
    assert(
      after === before + sale!.items[0].quantity,
      "المخزون استُرجع"
    );
    const retMv = await prisma.stockMovement.findFirst({
      where: { reference: `VOID-E2E-SALE-1`, type: "return" },
    });
    assert(!!retMv, "حركة استرجاع مسجلة في الدفتر");
    const again = await req("POST", `/api/sales/${sale!.id}/void`, {
      cookie: jar.pharmacist,
    });
    assert(again.status === 400, "الإلغاء المزدوج مرفوض");
  }

  // S20 — حراسة الأدوار
  console.log("\n▶ S20: حراسة الأدوار على العمليات الحساسة");
  {
    const r1 = await req("POST", "/api/medicines/restock", {
      cookie: jar.tech1,
      json: { medicineId: medicineRows[0]?.id, quantity: 5 },
    });
    assert(r1.status === 403, "الفني: التعبئة ممنوعة (403)");
    const r2 = await req("POST", "/api/users", {
      cookie: jar.tech1,
      json: { username: "x", password: "x", fullName: "x", role: "admin" },
    });
    assert(r2.status === 403, "الفني: إنشاء مستخدم ممنوع (403)");
    const r3 = await req("GET", "/api/auth/login-audits", { cookie: jar.tech1 });
    assert(r3.status === 403, "الفني: سجل تدقيق الدخول ممنوع (403)");
  }

  // S21 — تقرير الربح بالتكلفة الفعلية
  console.log("\n▶ S21: تقرير الأرباح بتكلفة FEFO الفعلية");
  {
    const r = await req("GET", "/api/reports/profit?days=1", { cookie: jar.admin });
    assert(r.status === 200, "التقرير 200");
    const summary = r.body?.summary ?? {};
    assert(
      typeof summary.revenue === "number" && summary.revenue > 0,
      `الإيراد اليومي > 0 (${summary.revenue})`
    );
    assert(
      typeof summary.profit === "number" && summary.profit > 0,
      `الربح الفعلي > 0 (${summary.profit})`
    );
    assert(
      Array.isArray(r.body?.byMedicine) && r.body.byMedicine.length > 0,
      "تفصيل حسب الدواء موجود"
    );
  }

  // S23 — طابور التحقق الصيدلي: إدخال → تحقق باركود → صرف ذري → رفض
  console.log("\n▶ S23: طابور التحقق الصيدلي (Fill → Verify → Dispense)");
  {
    // المرضى مرتّبون بالاسم — نحدد صاحب الورفارين المزمن بهويته
    const abdullah = patients.find((p: any) => p.nationalId === "1098447213");
    const fatima = patients.find((p: any) => p.nationalId === "1077234518");
    const khaled = patients.find((p: any) => p.nationalId === "1044558821");

    // إدخال وصفة بلا مريض → 400
    const noPatient = await req("POST", "/api/prescriptions", {
      cookie: jar.tech1,
      json: { items: [{ medicineId: medicineRows[0]?.id, quantity: 1 }] },
    });
    assert(noPatient.status === 400, "وصفة بلا مريض → 400");

    // الفني يُدخل وصفة لمريض لديه وارفارين مزمن + بند أسبرين (تداخل patient-context)
    const rxCreate = await req("POST", "/api/prescriptions", {
      cookie: jar.tech1,
      json: {
        patientId: abdullah?.id,
        doctorName: "د. اختبار E2E",
        items: [
          {
            medicineId: medicineRows.find((m: any) => m.genericName === "aspirin")?.id,
            quantity: 1,
            instructions: "بعد الفطور",
          },
          {
            medicineId: medicineRows.find((m: any) => m.genericName === "paracetamol")?.id,
            quantity: 2,
          },
        ],
      },
    });
    assert(rxCreate.status === 201, "إدخال الوصفة للطابور → 201", `وصل ${rxCreate.status}`);
    const rx = rxCreate.body?.prescription;
    assert(!!rx?.number, `رقم وصفة متسلسل (RX-${rx?.number})`);
    assert(
      (rxCreate.body?.clinicalReview?.interactions ?? []).some(
        (h: any) => h.genericA === "warfarin" && h.context === "patient"
      ),
      "المراجعة السريرية الفورية تكشف وارفارين المزمن"
    );

    // الفني لا يتحقق (403 — حارس الدور)
    const techVerify = await req("POST", `/api/prescriptions/${rx.id}/verify`, {
      cookie: jar.tech1,
      json: { scans: [{ medicineId: rx.items[0].medicineId, barcode: rx.items[0].medicine.barcode }] },
    });
    assert(techVerify.status === 403, "الفني: التحقق ممنوع (403)");

    // باركود خاطئ → 400 مع تحديد البند
    const wrongScan = await req("POST", `/api/prescriptions/${rx.id}/verify`, {
      cookie: jar.pharmacist,
      json: {
        scans: [{ medicineId: rx.items[0].medicineId, barcode: "WRONG-BARCODE-000" }],
      },
    });
    assert(wrongScan.status === 400, "باركود غير مطابق → 400");
    assert(
      String(wrongScan.body?.error ?? "").includes(rx.items[0].medicineName),
      "رسالة الخطأ تحدد البند المخالف"
    );

    // باركود صحيح للبندين معاً → اكتمال التحقق
    const okScan = await req("POST", `/api/prescriptions/${rx.id}/verify`, {
      cookie: jar.pharmacist,
      json: {
        scans: rx.items.map((i: any) => ({ medicineId: i.medicineId, barcode: i.medicine.barcode })),
      },
    });
    assert(okScan.status === 200, "تحقق بمطابقة باركود البندين → 200");
    assert(okScan.body?.prescription?.status === "verified", "الحالة → verified");
    assert(okScan.body?.remaining === 0, "لا بنود متبقية");
    assert(!!okScan.body?.prescription?.verifiedAt, "ختم زمن للتحقق");

    // الصرف قبل التحقق (وصفة ثانية) → 409
    const rx2Create = await req("POST", "/api/prescriptions", {
      cookie: jar.pharmacist,
      json: {
        patientId: fatima?.id,
        items: [{ medicineId: medicineRows.find((m: any) => m.genericName === "ibuprofen")?.id, quantity: 1 }],
      },
    });
    const rx2 = rx2Create.body?.prescription;
    const earlyDispense = await req("POST", `/api/prescriptions/${rx2.id}/dispense`, {
      cookie: jar.pharmacist,
      json: {},
    });
    assert(earlyDispense.status === 409, "صرف وصفة لم تُتحقق → 409");

    // رفض الوصفة الثانية بسبب موثق
    const rxReject = await req("POST", `/api/prescriptions/${rx2.id}/reject`, {
      cookie: jar.pharmacist,
      json: { reason: "جرعة غير منطقية — عاد للطبيب" },
    });
    assert(rxReject.status === 200, "رفض بسبب موثق → 200");
    assert(rxReject.body?.prescription?.status === "rejected", "الحالة → rejected");

    // رفض بلا سبب → 400
    const rx3 = await req("POST", "/api/prescriptions", {
      cookie: jar.admin,
      json: {
        patientId: khaled?.id,
        items: [{ medicineId: medicineRows.find((m: any) => m.genericName === "amoxicillin")?.id, quantity: 1 }],
      },
    });
    const noReason = await req("POST", `/api/prescriptions/${rx3.body?.prescription?.id}/reject`, {
      cookie: jar.admin,
      json: { reason: "" },
    });
    assert(noReason.status === 400, "رفض بلا سبب → 400");

    // صرف الوصفة المحققة — ذرياً عبر محرك البيع (FEFO + دفتر)
    const qtyBefore = rx.items[0].medicine.quantity; // متوفر aspirin عند الإدخال
    const dispense = await req("POST", `/api/prescriptions/${rx.id}/dispense`, {
      cookie: jar.pharmacist,
      json: { paymentMethod: "cash" },
    });
    assert(dispense.status === 201, "صرف الوصفة المحققة → 201", `وصل ${dispense.status}`);
    assert(
      dispense.body?.reference === `RX-${rx.number}`,
      "مرجع الفاتورة RX-<رقم الوصفة>"
    );
    assert(!!dispense.body?.saleId, "فاتورة مرتبطة بالوصفة");

    // مخزون aspirin نقص فعلياً بحجم الوصفة
    const medAfter = await req(
      "GET",
      `/api/medicines?pageSize=100`,
      { cookie: jar.admin }
    );
    const aspirinAfter = (medAfter.body?.results ?? []).find(
      (m: any) => m.genericName === "aspirin"
    );
    assert(
      aspirinAfter?.quantity === qtyBefore - 1,
      `مخزون aspirin نقص بمقدار الوصفة (${qtyBefore} → ${aspirinAfter?.quantity})`
    );

    // حركة دفتر مرتبطة بمرجع الوصفة
    const movement = await prisma.stockMovement.findFirst({
      where: { reference: `RX-${rx.number}` },
    });
    assert(!!movement && movement.delta < 0, "حركة StockMovement مسجلة بمرجع RX");

    // صرف مزدوج → 409 (بحالة الوصفة + قيد مرجع فاتورة فريد)
    const doubleDispense = await req("POST", `/api/prescriptions/${rx.id}/dispense`, {
      cookie: jar.pharmacist,
      json: {},
    });
    assert(doubleDispense.status === 409, "الصرف المزدوج مرفوض (409)");

    // تحقق وصفة مصروفة → 409
    const verifyDispensed = await req("POST", `/api/prescriptions/${rx.id}/verify`, {
      cookie: jar.pharmacist,
      json: { scans: [{ medicineId: rx.items[0].medicineId, barcode: rx.items[0].medicine.barcode }] },
    });
    assert(verifyDispensed.status === 409, "تحقق وصفة مصروفة مرفوض (409)");
  }


  // S24 — السجل الوطني للدواء: تعليق تنظيمي يحجب الصرف بلا تجاوز
  console.log("\n▶ S24: السجل الوطني (تعليق رانيتيدين/NDMA + غير مسجل + سقف سعر)");
  {
    const abdullah = patients.find((p: any) => p.nationalId === "1098447213");
    // قراءة السجل: الحالات مزروعة
    const reg = await req("GET", "/api/registry", { cookie: jar.admin });
    assert(reg.status === 200, "GET السجل الوطني → 200");
    const regMeds: any[] = reg.body?.medicines ?? [];
    const rani = regMeds.find((m) => m.genericName === "ranitidine");
    const omega = regMeds.find((m) => m.genericName === "omega-3");
    assert(rani?.registryStatus === "suspended", "رانيتيدين: معلق تنظيمياً في السجل");
    assert(omega?.registryStatus === "unregistered", "أوميغا-3: غير مسجل في السجل");
    assert(
      regMeds.filter((m) => m.registrationNo).length >= 28,
      `أرقام تسجيل وطنية على ≥ 28 دواء (${regMeds.filter((m) => m.registrationNo).length})`
    );
    assert((reg.body?.actions ?? []).length >= 1, "إجراء تنظيمي نشط معروض في السجل");

    // بيع رانيتيدين: محجوب تنظيمياً — للصيدلي حتى مع clinicalOverride
    const raniBarcode = barcodeOf("ranitidine");
    const blockSale = await req("POST", "/api/sales", {
      cookie: jar.pharmacist,
      json: { items: [{ barcode: raniBarcode, quantity: 1 }], transactionId: "E2E-REG-1" },
    });
    assert(blockSale.status === 409, "بيع معلق تنظيمياً → 409", `وصل ${blockSale.status}`);
    assert(blockSale.body?.registryBlock === true, "علم registryBlock مرفوع");

    const overrideSale = await req("POST", "/api/sales", {
      cookie: jar.pharmacist,
      json: {
        items: [{ barcode: raniBarcode, quantity: 1 }],
        transactionId: "E2E-REG-2",
        clinicalOverride: true,
      },
    });
    assert(
      overrideSale.status === 409,
      "التجاوز السريري لا يُنقض الحجب التنظيمي → 409",
      `وصل ${overrideSale.status}`
    );

    // السجل الوطني غير متاح بلا جلسة
    const regAnon = await req("GET", "/api/registry");
    assert(regAnon.status === 401, "GET السجل بلا جلسة → 401");

    // غير مسجل: تحذير لا حجب — البيع يتم مع تنبيه
    const omegaSale = await req("POST", "/api/sales", {
      cookie: jar.pharmacist,
      json: { items: [{ barcode: barcodeOf("omega-3"), quantity: 1 }], transactionId: "E2E-REG-3" },
    });
    assert(omegaSale.status === 201, "بيع دواء غير مسجل → 201 (تحذير لا حجب)", `وصل ${omegaSale.status}`);
    assert(
      (omegaSale.body?.clinicalReview?.registryAlerts ?? []).some(
        (a: any) => a.kind === "unregistered" && a.blocking === false
      ),
      "تنبيه unregistered غير حاجب في استجابة البيع"
    );

    // سقف السعر: إنذار تسعيري غير حاجب (باراسيتامول 6.50 فوق سقف 6.00)
    const paraSale = await req("POST", "/api/sales", {
      cookie: jar.admin,
      json: { items: [{ barcode: barcodeOf("paracetamol"), quantity: 1 }], transactionId: "E2E-REG-4" },
    });
    assert(paraSale.status === 201, "بيع فوق السقف الوطني → 201 (إنذار لا حجب)", `وصل ${paraSale.status}`);
    assert(
      (paraSale.body?.clinicalReview?.registryAlerts ?? []).some((a: any) => a.kind === "price_cap"),
      "إنذار تجاوز سقف السعر في استجابة البيع"
    );

    // دورة قرار تنظيمية كاملة: تعليق → حجب → رفع القرار → صرف طبيعي
    const ceti = medicineRows.find((m: any) => m.genericName === "cetirizine");
    const techDecision = await req("POST", "/api/registry", {
      cookie: jar.tech1,
      json: { medicineId: ceti.id, actionType: "suspension", reason: "x" },
    });
    assert(techDecision.status === 403, "الفني لا يصدر قرارات تنظيمية (403)");

    const noReason = await req("POST", "/api/registry", {
      cookie: jar.admin,
      json: { medicineId: ceti.id, actionType: "suspension", reason: "" },
    });
    assert(noReason.status === 400, "قرار تنظيمي بلا سبب → 400");

    const suspend = await req("POST", "/api/registry", {
      cookie: jar.admin,
      json: {
        medicineId: ceti.id,
        actionType: "suspension",
        reason: "اختبار E2E: تعليق وقائي لدفعة معيبة مزعومة",
        source: "SFDA",
      },
    });
    assert(suspend.status === 201, "إصدار تعليق تنظيمي → 201", `وصل ${suspend.status}`);

    const cetiBlocked = await req("POST", "/api/sales", {
      cookie: jar.admin,
      json: { items: [{ barcode: ceti.barcode, quantity: 1 }], transactionId: "E2E-REG-5" },
    });
    assert(cetiBlocked.status === 409, "بيع الدواء المعلق حديثاً → 409 فوراً");

    const reinstate = await req("POST", "/api/registry", {
      cookie: jar.admin,
      json: {
        medicineId: ceti.id,
        actionType: "reinstatement",
        reason: "اختبار E2E: فشل التحقق المخبري في إثبات العيب — رفع التعليق",
        source: "SFDA",
      },
    });
    assert(reinstate.status === 201, "رفع القرار (إعادة تسجيل) → 201");

    const cetiOk = await req("POST", "/api/sales", {
      cookie: jar.admin,
      json: { items: [{ barcode: ceti.barcode, quantity: 1 }], transactionId: "E2E-REG-6" },
    });
    assert(cetiOk.status === 201, "بعد رفع القرار البيع يتم طبيعياً → 201", `وصل ${cetiOk.status}`);

    // طابور التحقق: وصفة ب دواء معلق — التحقق لا يكتمل، والمخرج الصحيح رفض موثق
    const rxSuspended = await req("POST", "/api/prescriptions", {
      cookie: jar.tech1,
      json: {
        patientId: abdullah?.id,
        items: [{ medicineId: rani?.id ?? medicineRows.find((m: any) => m.genericName === "ranitidine")?.id, quantity: 1 }],
      },
    });
    assert(rxSuspended.status === 201, "إدخال وصفة بدواء معلق مسموح (تنبيه لا حجب عند الإدخال)");
    const rxSusp = rxSuspended.body?.prescription;
    const verifySuspended = await req("POST", `/api/prescriptions/${rxSusp.id}/verify`, {
      cookie: jar.pharmacist,
      json: {
        scans: [
          {
            medicineId: rxSusp.items[0].medicineId,
            barcode: rxSusp.items[0].medicine.barcode,
          },
        ],
      },
    });
    assert(verifySuspended.status === 409, "تحقق وصفة بدواء معلق → 409", `وصل ${verifySuspended.status}`);
    assert(verifySuspended.body?.registryBlock === true, "علم registryBlock في التحقق");
    const rejectSuspended = await req("POST", `/api/prescriptions/${rxSusp.id}/reject`, {
      cookie: jar.pharmacist,
      json: { reason: "الدواء معلق تنظيمياً (NDMA) — عاد للطبيب لبحث البديل" },
    });
    assert(rejectSuspended.status === 200, "رفض موثق للوصفة المعلقة تنظيمياً → 200");
    assert(
      (rejectSuspended.body?.releasedReservations ?? 0) >= 1,
      "الرفض أفرج عن حجز المخزون"
    );
  }

  // S25 — المحجوزات: وصفة قيد الطابور تحمي وحداتها من نقطة البيع
  console.log("\n▶ S25: المحجوزات الوقائية (حجز → حماية → استهلاك/إفراج)");
  {
    const abdullah = patients.find((p: any) => p.nationalId === "1098447213");
    const fatima = patients.find((p: any) => p.nationalId === "1077234518");
    const medList = await req("GET", "/api/medicines?pageSize=100", { cookie: jar.admin });
    const rows: any[] = medList.body?.results ?? [];
    const diclo = rows.find((m) => m.genericName === "diclofenac");
    const para = rows.find((m) => m.genericName === "paracetamol");
    assert(
      typeof diclo?.availableQuantity === "number" && diclo.availableQuantity === diclo.quantity,
      "الحقل availableQuantity ظاهر ويساوي الرصيد بلا حجوزات"
    );

    // وصفة تستهلك كل مخزون الديكلوفيناك — تُحجز فوراً
    const rxAll = await req("POST", "/api/prescriptions", {
      cookie: jar.tech1,
      json: {
        patientId: fatima?.id,
        items: [{ medicineId: diclo.id, quantity: diclo.quantity }],
      },
    });
    assert(rxAll.status === 201, "إدخال وصفة لمخزون كامل → 201", `وصل ${rxAll.status}`);
    const rxAllId = rxAll.body?.prescription?.id;

    const activeRes = await prisma.stockReservation.findMany({
      where: { prescriptionId: rxAllId, status: "active" },
    });
    assert(
      activeRes.length === 1 && activeRes[0].quantity === diclo.quantity,
      `حجز وقائي نشط بكامل الكمية (${activeRes[0]?.quantity})`
    );

    const afterReserve = await req("GET", "/api/medicines?pageSize=100", { cookie: jar.admin });
    const dicloAfter = (afterReserve.body?.results ?? []).find(
      (m: any) => m.genericName === "diclofenac"
    );
    assert(dicloAfter?.availableQuantity === 0, "المتاح للبيع صفر أثناء الحجز");
    assert(dicloAfter?.reservedQty === diclo.quantity, "المحجوز معروض في قائمة الأدوية");
    assert(dicloAfter?.quantity === diclo.quantity, "الرصيد الفعلي لم يتغير بالحجز");

    // نقطة البيع محجوبة: الوحدات موعودة للوصفة
    const posBlocked = await req("POST", "/api/sales", {
      cookie: jar.pharmacist,
      json: { items: [{ barcode: diclo.barcode, quantity: 1 }], transactionId: "E2E-RESV-1" },
    });
    assert(posBlocked.status === 400, "بيع وحدات محجوزة → 400", `وصل ${posBlocked.status}`);
    assert(
      String(posBlocked.body?.error ?? "").includes("محجوز"),
      "رسالة الرفض توضح أن المخزون محجوز لوصفات"
    );

    // التحقق ثم الصرف: حجز الوصفة لا يُحسب ضدها
    const verifyAll = await req("POST", `/api/prescriptions/${rxAllId}/verify`, {
      cookie: jar.pharmacist,
      json: {
        scans: [{ medicineId: diclo.id, barcode: rxAll.body?.prescription?.items?.[0]?.medicine?.barcode }],
      },
    });
    assert(verifyAll.status === 200, "تحقق الوصفة المحجوزة → 200");
    const dispenseAll = await req("POST", `/api/prescriptions/${rxAllId}/dispense`, {
      cookie: jar.pharmacist,
      json: { paymentMethod: "cash" },
    });
    assert(dispenseAll.status === 201, "صرف الوصفة المحجوزة → 201 (حجزها لا يمنعها)", `وصل ${dispenseAll.status}`);

    const consumedRes = await prisma.stockReservation.findFirst({
      where: { prescriptionId: rxAllId },
    });
    assert(consumedRes?.status === "consumed", "الحجز تحول إلى consumed بعد الصرف");
    const dicloFinal = (await req("GET", "/api/medicines?pageSize=100", { cookie: jar.admin }))
      .body?.results?.find((m: any) => m.genericName === "diclofenac");
    assert(dicloFinal?.quantity === 0, "مخزون الديكلوفيناك نُفد فعلياً بالصرف");

    // حجز جزئي: وصفة 100 باراسيتامول تحمي 100 وحدة ثم الإفراج بالرفض
    // (أرقام ديناميكية — السيناريوهات السابقة تعدّل رصيد الباراسيتامول)
    const rxPara = await req("POST", "/api/prescriptions", {
      cookie: jar.tech1,
      json: {
        patientId: abdullah?.id,
        items: [{ medicineId: para.id, quantity: 100 }],
      },
    });
    assert(rxPara.status === 201, "وصفة باراسيتامول 100 → 201");
    const paraAfterReserve = (
      await req("GET", "/api/medicines?pageSize=100", { cookie: jar.admin })
    ).body?.results?.find((m: any) => m.genericName === "paracetamol");
    assert(
      paraAfterReserve?.availableQuantity === paraAfterReserve?.quantity - 100,
      `المتاح نقص بمقدار الحجز (${paraAfterReserve?.quantity} − 100 = ${paraAfterReserve?.availableQuantity})`
    );
    assert(paraAfterReserve?.reservedQty === 100, "المحجوز المعروض = 100 بالضبط");

    // بيع يفوق المتاح (ولو كان أقل من الرصيد الخام) → محجوب بالحجز
    const overQty = paraAfterReserve.availableQuantity + 10;
    const posOver = await req("POST", "/api/sales", {
      cookie: jar.admin,
      json: { items: [{ barcode: para.barcode, quantity: overQty }], transactionId: "E2E-RESV-2" },
    });
    assert(posOver.status === 400, `بيع ${overQty} فوق المتاح المحجوز → 400`, `وصل ${posOver.status}`);
    assert(
      String(posOver.body?.error ?? "").includes("محجوز"),
      "رسالة الحجب الجزئي توضح المحجوز والمتاح"
    );

    const rejectPara = await req("POST", `/api/prescriptions/${rxPara.body?.prescription?.id}/reject`, {
      cookie: jar.pharmacist,
      json: { reason: "الجرعة غير منطقية — عاد للطبيب" },
    });
    assert(rejectPara.status === 200, "رفض وصفة الحجز الجزئي → 200");
    assert((rejectPara.body?.releasedReservations ?? 0) >= 1, "الإفراج موثق في الاستجابة");

    const posAfterRelease = await req("POST", "/api/sales", {
      cookie: jar.admin,
      json: { items: [{ barcode: para.barcode, quantity: overQty }], transactionId: "E2E-RESV-3" },
    });
    assert(posAfterRelease.status === 201, "بعد الإفراج نفس البيع ينجح → 201", `وصل ${posAfterRelease.status}`);
  }

  // S26 — سحب دفعة LOT: خروج فوري من التداول + تتبع أمامي للمرضى
  console.log("\n▶ S26: سحب دفعة LOT (حجب فوري + تتبع المرضى المتأثرين)");
  {
    const aspId = medicineRows.find((m: any) => m.genericName === "aspirin")?.id;
    const aspBarcode = barcodeOf("aspirin");
    const batches = await req("GET", `/api/batches?medicineId=${aspId}`, { cookie: jar.admin });
    const batch = (batches.body?.batches ?? []).find((b: any) => !b.isRecalled && b.quantity > 0);
    assert(!!batch, `دفعة aspirin موجودة (${batch?.lotNumber} — ${batch?.quantity} وحدة)`);

    // بيع موثق من الدفعة قبل سحبها — أساس التتبع الأمامي
    const preSale = await req("POST", "/api/sales", {
      cookie: jar.pharmacist,
      json: {
        items: [{ barcode: aspBarcode, quantity: 3 }],
        transactionId: "E2E-RECALL-SALE",
        customerName: "عميل تتبع السحب",
      },
    });
    assert(preSale.status === 201, "بيع 3 وحدات من الدفعة قبل سحبها → 201", `وصل ${preSale.status}`);

    const traceRows = await prisma.saleItemBatch.findMany({
      where: { saleItem: { sale: { reference: "E2E-RECALL-SALE" } } },
    });
    assert(
      traceRows.length === 1 && traceRows[0].lotNumber === batch.lotNumber && traceRows[0].quantity === 3,
      `تتبع الدفعة مسجل تلقائياً (LOT ${traceRows[0]?.lotNumber} × ${traceRows[0]?.quantity})`
    );

    // الصلاحيات: الفني لا يسحب؛ السبب إلزامي
    const techRecall = await req("POST", "/api/registry", {
      cookie: jar.tech1,
      json: {
        medicineId: aspId,
        actionType: "recall",
        scope: "lot",
        lotNumber: batch.lotNumber,
        reason: "x",
      },
    });
    assert(techRecall.status === 403, "الفني لا يسحب دفعات (403)");

    const noReasonRecall = await req("POST", "/api/registry", {
      cookie: jar.admin,
      json: {
        medicineId: aspId,
        actionType: "recall",
        scope: "lot",
        lotNumber: batch.lotNumber,
        reason: "",
      },
    });
    assert(noReasonRecall.status === 400, "سحب بلا سبب → 400");

    // قرار السحب
    const recall = await req("POST", "/api/registry", {
      cookie: jar.admin,
      json: {
        medicineId: aspId,
        actionType: "recall",
        scope: "lot",
        lotNumber: batch.lotNumber,
        reason: "اختبار E2E: انحراف مواصفات في التشغيلة — سحب وقائي",
        source: "SFDA",
      },
    });
    assert(recall.status === 201, "قرار سحب الدفعة → 201", `وصل ${recall.status}`);
    const recalledBatch = await prisma.batch.findUnique({ where: { id: batch.id } });
    assert(recalledBatch?.isRecalled === true, "الدفعة موسومة isRecalled في قاعدة البيانات");

    const recallAgain = await req("POST", "/api/registry", {
      cookie: jar.admin,
      json: {
        medicineId: aspId,
        actionType: "recall",
        scope: "lot",
        lotNumber: batch.lotNumber,
        reason: "مكرر",
      },
    });
    assert(recallAgain.status === 409, "سحب دفعة مسحوبة مسبقاً → 409");

    // الصرف محجوب فوراً: كل مخزون aspirin كان في هذه الدفعة
    const saleBlocked = await req("POST", "/api/sales", {
      cookie: jar.admin,
      json: { items: [{ barcode: aspBarcode, quantity: 1 }], transactionId: "E2E-RECALL-2" },
    });
    assert(saleBlocked.status === 400, "بيع من دفعة مسحوبة → 400 (نضوب صالح)", `وصل ${saleBlocked.status}`);
    assert(
      String(saleBlocked.body?.error ?? "").includes("مسحوبة"),
      "رسالة النضوب تميز السحب التنظيمي عن انتهاء الصلاحية"
    );

    // التتبع الأمامي: من أخذ ماذا؟
    const affected = await req("GET", `/api/batches/${batch.id}/recall-affected`, {
      cookie: jar.pharmacist,
    });
    assert(affected.status === 200, "GET التتبع الأمامي → 200");
    assert(
      (affected.body?.affected ?? []).some(
        (a: any) => a.saleReference === "E2E-RECALL-SALE" && a.quantity === 3
      ),
      "الفاتورة السابقة ظاهرة في المتأثرين (3 وحدات)"
    );
    assert(
      String(affected.body?.affected?.[0]?.customerName ?? "").length > 0,
      "بيانات العميل متاحة للإبلاغ"
    );
    assert(
      affected.body?.totalUnitsSold >= 3,
      `مجموع الوحدات المصروفة من الدفعة (${affected.body?.totalUnitsSold})`
    );

    // التتبع بلا صلاحية → 403
    const affectedTech = await req("GET", `/api/batches/${batch.id}/recall-affected`, {
      cookie: jar.tech1,
    });
    assert(affectedTech.status === 403, "التتبع الأمامي للصيدلي فما فوق (403 للفني)");
  }


  // ───────────────── اختبارات التزامن الحقيقي (سباق فعلي) ─────────────────
  // كل السيناريوهات السابقة متتالية — وهي تختبر المسار السعيد من حيث التوقيت.
  // الضمانات الذرية (معاملة Serializable + WAL + busy_timeout + الحجوزات +
  // قفل الصرف المزدوج) لا تثبت إلا بإطلاق طلبين متزامنين حقيقيين عبر
  // Promise.all على نفس الدفعة/الوصفة والتأكد من حوافز قاعدة البيانات.

  // S27 — سباق بيعين متزامنين على نفس الدفعة (حارس البيع الزائد)
  console.log("\n▶ S27: سباق بيعين متزامنين على نفس الدفعة (حارس البيع الزائد)");
  {
    const cat = await prisma.category.findFirst();
    const med = await prisma.medicine.create({
      data: {
        name: "E2E دواء سباق البيع",
        genericName: "race-sale-e2e",
        categoryId: cat!.id,
        barcode: "6281001999992",
        purchasePrice: 100,
        sellingPrice: 200,
        quantity: 10,
        minQuantity: 2,
        expiryDate: new Date(Date.now() + 200 * 86400000),
        atcClass: "X99 — اختباري",
      },
    });
    await prisma.batch.create({
      data: {
        medicineId: med.id,
        lotNumber: "E2E-RACE-1",
        expiryDate: new Date(Date.now() + 200 * 86400000),
        quantity: 10,
        unitCost: 100,
      },
    });

    // طلبان متزامنان فعلياً: 7 + 7 = 14 من مخزون 10 — استحالة رياضية نجاحهما معاً
    const [r1, r2] = await Promise.all([
      req("POST", "/api/sales", {
        cookie: jar.tech1,
        json: {
          items: [{ barcode: "6281001999992", quantity: 7 }],
          transactionId: "E2E-RACE-A",
        },
      }),
      req("POST", "/api/sales", {
        cookie: jar.tech1,
        json: {
          items: [{ barcode: "6281001999992", quantity: 7 }],
          transactionId: "E2E-RACE-B",
        },
      }),
    ]);
    const wins = [r1.status, r2.status].filter((s) => s === 201).length;
    assert(wins >= 1, "واحد على الأقل من البيعين نجح تحت السباق", `الحالتان: ${r1.status}/${r2.status}`);
    assert(wins === 1, "نجاح كلاهما مستحيل (7+7 > 10) — حارس البيع الزائد", `نجح ${wins}`);

    // حوافز قاعدة البيانات بعد السباق — هنا يُحكم على الذرية فعلياً
    const finalMed = await prisma.medicine.findUnique({ where: { id: med.id } });
    const finalBatch = await prisma.batch.findFirst({ where: { medicineId: med.id } });
    const soldRows = await prisma.saleItem.findMany({
      where: { sale: { reference: { in: ["E2E-RACE-A", "E2E-RACE-B"] } } },
    });
    const soldTotal = soldRows.reduce((a, x) => a + x.quantity, 0);
    assert(soldTotal <= 10, `المُباع الكلي لا يتجاوز المخزون (${soldTotal}/10)`);
    assert(
      finalMed!.quantity === 10 - soldTotal,
      `رصيد الدواء = 10 − المُباع (${finalMed!.quantity})`
    );
    assert(
      finalBatch!.quantity === 10 - soldTotal && finalBatch!.quantity >= 0,
      `رصيد الدفعة متسق وغير سالب (${finalBatch!.quantity})`
    );
    const mv = await prisma.stockMovement.aggregate({
      where: { medicineId: med.id, reference: { in: ["E2E-RACE-A", "E2E-RACE-B"] } },
      _sum: { delta: true },
    });
    assert(mv._sum.delta === -soldTotal, "دفتر الحركات مطابق تماماً للمُباع الفعلي");
  }

  // S28 — سباق صرف مزدوج متزامن لنفس الوصفة (قفل الحالة الذري)
  console.log("\n▶ S28: سباق صرفين متزامنين لنفس الوصفة (نقر مزدوج حقيقي)");
  {
    const cat = await prisma.category.findFirst();
    const med = await prisma.medicine.create({
      data: {
        name: "E2E دواء سباق الصرف",
        genericName: "race-dispense-e2e",
        categoryId: cat!.id,
        barcode: "6281001999993",
        purchasePrice: 100,
        sellingPrice: 300,
        quantity: 8,
        minQuantity: 2,
        expiryDate: new Date(Date.now() + 200 * 86400000),
        atcClass: "X99 — اختباري",
      },
    });
    await prisma.batch.create({
      data: {
        medicineId: med.id,
        lotNumber: "E2E-RACE-2",
        expiryDate: new Date(Date.now() + 200 * 86400000),
        quantity: 8,
        unitCost: 100,
      },
    });

    const fatima = patients.find((p: any) => p.nationalId === "1077234518");
    const rxCreate = await req("POST", "/api/prescriptions", {
      cookie: jar.tech1,
      json: { patientId: fatima?.id, items: [{ medicineId: med.id, quantity: 2 }] },
    });
    assert(rxCreate.status === 201, "وصفة السباق في الطابور → 201 (حجز وقائي فوري)", `وصل ${rxCreate.status}`);
    const rx = rxCreate.body?.prescription;
    const verify = await req("POST", `/api/prescriptions/${rx.id}/verify`, {
      cookie: jar.pharmacist,
      json: { scans: [{ medicineId: med.id, barcode: med.barcode }] },
    });
    assert(verify.status === 200, "تحقق الوصفة → 200", `وصل ${verify.status}`);

    // صرفان متزامنان فعليان — المحاكاة الحقيقية لنقرتين مزدوجتين من صيدليين
    const [d1, d2] = await Promise.all([
      req("POST", `/api/prescriptions/${rx.id}/dispense`, { cookie: jar.pharmacist, json: {} }),
      req("POST", `/api/prescriptions/${rx.id}/dispense`, { cookie: jar.pharmacist, json: {} }),
    ]);
    const wins = [d1.status, d2.status].filter((s) => s === 201).length;
    assert(wins === 1, "صرف واحد فقط نجح رغم التزامن", `${d1.status}/${d2.status}`);

    // حوافز: فاتورة واحدة، خصم واحد، تتبع واحد، حجز مستهلك
    const rxAfter = await prisma.prescription.findUnique({ where: { id: rx.id } });
    assert(rxAfter?.status === "dispensed", "حالة الوصفة النهائية dispensed");
    const salesCount = await prisma.sale.count({ where: { reference: `RX-${rx.number}` } });
    assert(salesCount === 1, "فاتورة RX واحدة فقط رغم الصرفين المتزامنين");
    const finalMed = await prisma.medicine.findUnique({ where: { id: med.id } });
    assert(finalMed!.quantity === 6, `المخزون خصم مرة واحدة فقط (8 → ${finalMed!.quantity})`);
    const trace = await prisma.saleItemBatch.findMany({
      where: { saleItem: { sale: { reference: `RX-${rx.number}` } } },
    });
    assert(
      trace.reduce((a, x) => a + x.quantity, 0) === 2,
      "تتبع LOT مسجل مرة واحدة (2 وحدة)"
    );
    const resv = await prisma.stockReservation.findFirst({ where: { prescriptionId: rx.id } });
    assert(resv?.status === "consumed", "الحجز الوقائي → consumed مرة واحدة");
    const mv = await prisma.stockMovement.aggregate({
      where: { reference: `RX-${rx.number}` },
      _sum: { delta: true },
    });
    assert(mv._sum.delta === -2, "دفتر الحركات: خصم واحد فقط (−2)");
  }

  // S29 — سباق بيعين نقديين على وحدات يحميها حجز وقائي
  console.log("\n▶ S29: سباق بيعين نقديين على مخزون محجوز لوصفة (حماية الوحدات الموعودة)");
  {
    const cat = await prisma.category.findFirst();
    const med = await prisma.medicine.create({
      data: {
        name: "E2E دواء سباق الحجز",
        genericName: "race-reserve-e2e",
        categoryId: cat!.id,
        barcode: "6281001999994",
        purchasePrice: 100,
        sellingPrice: 150,
        quantity: 10,
        minQuantity: 2,
        expiryDate: new Date(Date.now() + 200 * 86400000),
        atcClass: "X99 — اختباري",
      },
    });
    await prisma.batch.create({
      data: {
        medicineId: med.id,
        lotNumber: "E2E-RACE-3",
        expiryDate: new Date(Date.now() + 200 * 86400000),
        quantity: 10,
        unitCost: 100,
      },
    });

    const khaled = patients.find((p: any) => p.nationalId === "1044558821");
    const rxCreate = await req("POST", "/api/prescriptions", {
      cookie: jar.tech1,
      json: { patientId: khaled?.id, items: [{ medicineId: med.id, quantity: 6 }] },
    });
    assert(rxCreate.status === 201, "وصفة 6 وحدات حجزت فوراً (المتاح النقدي = 4)", `وصل ${rxCreate.status}`);
    const rx = rxCreate.body?.prescription;

    // بيعان متزامنان كل منهما 4 — مجموعهما 8 من متاحٍ لا يتجاوز 4
    const [s1, s2] = await Promise.all([
      req("POST", "/api/sales", {
        cookie: jar.tech1,
        json: { items: [{ barcode: med.barcode, quantity: 4 }], transactionId: "E2E-RACE-R1" },
      }),
      req("POST", "/api/sales", {
        cookie: jar.tech1,
        json: { items: [{ barcode: med.barcode, quantity: 4 }], transactionId: "E2E-RACE-R2" },
      }),
    ]);
    const wins = [s1.status, s2.status].filter((s) => s === 201).length;
    assert(wins >= 1, "واحد على الأقل من البيعين النقديين نجح", `${s1.status}/${s2.status}`);
    assert(wins <= 1, "نجاح كلاهما يعني اختراق الحجز (4+4 > المتاح 4)", `نجح ${wins}`);

    // حوافز: ما يُباع نقدياً + المحجوز ≤ المخزون دائماً
    const soldRows = await prisma.saleItem.findMany({
      where: { sale: { reference: { in: ["E2E-RACE-R1", "E2E-RACE-R2"] } } },
    });
    const soldTotal = soldRows.reduce((a, x) => a + x.quantity, 0);
    assert(soldTotal <= 4, `المُباع النقدي ≤ المتاح غير المحجوز (${soldTotal}/4)`);
    const finalMed = await prisma.medicine.findUnique({ where: { id: med.id } });
    const resv = await prisma.stockReservation.findFirst({
      where: { prescriptionId: rx.id, status: "active" },
    });
    assert(resv?.quantity === 6, "حجز الوصفة ما زال نشطاً بست وحدات رغم سباق النقدي");
    assert(
      finalMed!.quantity === 10 - soldTotal,
      `الرصيد النهائي = 10 − المُباع (${finalMed!.quantity})`
    );
    assert(
      finalMed!.quantity >= 6,
      "الرصيد يغطي المحجوز دائماً — لا اختراق للوحدات الموعودة"
    );
  }

  console.log("\n▶ S22: الخروج يمحو كوكي الجلسة فوراً");
  {
    const out = await req("POST", "/api/auth/logout", { cookie: jar.tech1 });
    assert(out.status === 200, "الخروج 200");
    const cleared = out.headers
      .getSetCookie()
      .some((c) => c.startsWith("ruba_token=") && c.includes("Max-Age=0"));
    assert(cleared, "أمر المحو (Max-Age=0) صادر في Set-Cookie");
    // بعد المحو لا يوجد كوكي فعلي لدى العميل → الوصول بدون كوكي = 401
    const me = await req("GET", "/api/auth/me");
    assert(me.status === 401, "الوصول بلا كوكي → 401");
  }

  // S30 — الجلسات القابلة للسحب + ربط الجهاز (v3.9)
  // قبل v3.9: JWT عديم الحالة — من يسرق نصه يستخدمه من أي جهاز حتى 7 أيام،
  // والخروج كان يمحو الكوكي من المتصفح فقط دون إبطال على الخادم.
  console.log("\n▶ S30: الجلسات القابلة للسحب وربط الجهاز");
  {
    const UA_A = "E2E-Agent-A (session-owner)";
    const UA_B = "E2E-Agent-B (second-device)";
    const UA_X = "E2E-Attacker-Browser/1.0 (stolen-token)";

    // دخول جهاز A — جلسة مسجلة ببصمة جهاز في القاعدة
    const loginA = await req("POST", "/api/auth/login", {
      json: { username: "tech1", password: "Tech@2026!" },
      ua: UA_A,
    });
    assert(loginA.status === 200, "دخول الجهاز A → 200", `وصل ${loginA.status}`);
    const tokenA = cookieFrom(loginA);
    const rowA = await prisma.session.findFirst({
      where: { userAgent: UA_A, revokedAt: null },
    });
    assert(
      !!rowA?.deviceHash && !!rowA.tokenHash,
      "الجلسة مسجلة في القاعدة ببصمة جهاز وبصمة توكن (بلا توكن خام)"
    );

    // السرقة: نفس الكوكي من جهاز آخر → 401 فوراً
    const stolen = await req("GET", "/api/auth/me", { cookie: tokenA, ua: UA_X });
    assert(stolen.status === 401, "التوكن المسروق من جهاز آخر → 401", `وصل ${stolen.status}`);
    // الجهاز الشرعي نفسه → 200
    const legit = await req("GET", "/api/auth/me", { cookie: tokenA, ua: UA_A });
    assert(legit.status === 200, "نفس الجهاز الشرعي → 200");

    // جهاز ثانٍ ثم إنهاء كل الأجهزة الأخرى
    const loginB = await req("POST", "/api/auth/login", {
      json: { username: "tech1", password: "Tech@2026!" },
      ua: UA_B,
    });
    assert(loginB.status === 200, "دخول الجهاز B → 200", `وصل ${loginB.status}`);
    const tokenB = cookieFrom(loginB);
    const revokeOthers = await req("POST", "/api/auth/sessions", { cookie: tokenB, ua: UA_B });
    assert(revokeOthers.status === 200, "إنهاء كل الأجهزة الأخرى → 200", `وصل ${revokeOthers.status}`);
    assert(
      (revokeOthers.body?.revoked ?? 0) >= 1,
      `سُحبت جلسات الأجهزة الأخرى (${revokeOthers.body?.revoked})`
    );
    // A ميت فوراً رغم أن كوكيه لم يُمس
    const deadA = await req("GET", "/api/auth/me", { cookie: tokenA, ua: UA_A });
    assert(deadA.status === 401, "جلسة الجهاز A مسحوبة فوراً رغم أن كوكيه باقٍ");
    const aliveB = await req("GET", "/api/auth/me", { cookie: tokenB, ua: UA_B });
    assert(aliveB.status === 200, "جهاز الطلب الحالي باقٍ بعد الإنهاء الجماعي");

    // الخروج الحقيقي: إبطال على الخادم لا مجرد محو متصفح
    const logoutB = await req("POST", "/api/auth/logout", { cookie: tokenB, ua: UA_B });
    assert(logoutB.status === 200, "الخروج → 200");
    const reuseB = await req("GET", "/api/auth/me", { cookie: tokenB, ua: UA_B });
    assert(
      reuseB.status === 401,
      "إعادة استخدام الكوكي بعد الخروج → 401 (إبطال على الخادم)"
    );
    const aliveBRows = await prisma.session.count({
      where: { userAgent: UA_B, revokedAt: null },
    });
    assert(aliveBRows === 0, "لا صف جلسة حي متبقٍ للجهاز B في القاعدة");

    // تغيير كلمة المرور ينهي كل جلسات الهدف فوراً
    // (مستخدم مخصص — عزل عدّاد محاولات الدخول عن tech1)
    const sUser = await prisma.user.create({
      data: {
        username: "e2e-session-user",
        password: await bcrypt.hash("E2eUser@2026!", 10),
        fullName: "E2E مستخدم الجلسات",
        role: "technician",
      },
    });
    const uLogin = await req("POST", "/api/auth/login", {
      json: { username: "e2e-session-user", password: "E2eUser@2026!" },
      ua: UA_A,
    });
    assert(uLogin.status === 200, "دخول المستخدم المخصص → 200", `وصل ${uLogin.status}`);
    const uToken = cookieFrom(uLogin);
    const chPass = await req("PUT", `/api/users/${sUser.id}`, {
      cookie: jar.admin,
      json: { password: "E2eUser@2027!" },
    });
    assert(chPass.status === 200, "المدير يغيّر كلمة المرور → 200", `وصل ${chPass.status}`);
    const afterPass = await prisma.session.count({
      where: { userId: sUser.id, revokedAt: null },
    });
    assert(afterPass === 0, `كل جلسات المستخدم انتهت بعد تغيير المرور (الحية: ${afterPass})`);
    const reuseU = await req("GET", "/api/auth/me", { cookie: uToken, ua: UA_A });
    assert(reuseU.status === 401, "كوكي ما قبل تغيير المرور ميت فوراً");
    const oldLogin = await req("POST", "/api/auth/login", {
      json: { username: "e2e-session-user", password: "E2eUser@2026!" },
      ua: UA_A,
    });
    assert(oldLogin.status === 401, "الكلمة القديمة مرفوضة → 401");
    const newLogin = await req("POST", "/api/auth/login", {
      json: { username: "e2e-session-user", password: "E2eUser@2027!" },
      ua: UA_A,
    });
    assert(newLogin.status === 200, "الكلمة الجديدة تعمل → 200", `وصل ${newLogin.status}`);
    // تنظيف: حذف المستخدم المخصص (جلساته تُمحى بالتتالي)
    await prisma.user.delete({ where: { id: sUser.id } });
  }

  // S31 — دليل الدواء الوطني: خدمة عامة للعميل (v4.0)
  console.log("\n▶ S31: دليل الدواء — بحث عام بلا جلسة");
  {
    const pub = await req("GET", "/api/drugs?pageSize=60");
    assert(pub.status === 200, "الدليل عام — الوصول بلا جلسة → 200", `وصل ${pub.status}`);
    assert((pub.body?.total ?? 0) >= 40, `الكتالوج المرخص ≥ 40 (${pub.body?.total})`);
    assert((pub.body?.categories ?? []).length >= 8, `واجهات الفئات ≥ 8 (${pub.body?.categories?.length})`);
    const linked = (pub.body?.results ?? []).filter((d: any) => d.availability?.linked);
    assert(linked.length >= 25, `المنتجات المربوطة بالمخزون الحي ≥ 25 (${linked.length})`);
    // التطبيع العربي: بلا همزات تجد البطاقة
    const arabic = await req("GET", "/api/drugs?q=" + encodeURIComponent("اموكسيسيلين"));
    assert(
      (arabic.body?.results ?? []).some((d: any) => d.tradeName === "أموكسيل 500"),
      "التطبيع العربي: «اموكسيسيلين» تجد أموكسيل"
    );
    // البحث اللاتيني
    const latin = await req("GET", "/api/drugs?q=warfarin");
    assert(
      (latin.body?.results ?? []).some((d: any) => d.tradeName === "كومادين 5"),
      "البحث اللاتيني: warfarin تجد كومادين"
    );
    // الترتيب السعري على الكتالوج كاملاً
    const sorted = await req("GET", "/api/drugs?sort=price-asc&pageSize=60");
    const prices = (sorted.body?.results ?? []).map((d: any) => d.priceHalalas);
    const isSorted = prices.every((p: number, i: number) => i === 0 || prices[i - 1] <= p);
    assert(isSorted && prices.length >= 40, `الترتيب السعري تصاعدي على ${prices.length} بطاقة`);
    // مرشحات OTC والفئة
    const otc = await req("GET", "/api/drugs?otc=1&pageSize=60");
    assert(
      (otc.body?.results ?? []).every((d: any) => !d.requiresRx),
      `مرشح OTC: كل النتائج بلا وصفة (${otc.body?.total})`
    );
    const cat = await req("GET", "/api/drugs?category=" + encodeURIComponent("سكري"));
    const catRows = cat.body?.results ?? [];
    assert(
      catRows.length >= 3 && catRows.every((d: any) => d.category === "سكري"),
      `مرشح الفئة: سكري (${catRows.length})`
    );
  }

  // S32 — النشرة المرخصة + التوفر الحي + البدائل الموفرة
  console.log("\n▶ S32: نشرة الدواء + التوفر الحي + البدائل الموفرة");
  {
    const list = await req("GET", "/api/drugs?q=" + encodeURIComponent("أدول 500"));
    const adol = (list.body?.results ?? [])[0];
    assert(!!adol, "أدول 500 موجود في الدليل");
    const det = await req("GET", `/api/drugs/${adol.id}`);
    assert(
      det.status === 200 && det.body?.drug?.tradeName === "أدول 500",
      "النشرة تعيد البطاقة الكاملة"
    );
    const dg = det.body?.drug ?? {};
    assert(
      !!dg.indications && dg.indications.length > 30,
      "دواعي الاستعمال محتوى مرخص حقيقي"
    );
    assert(
      !!dg.dosageGuide && !!dg.sideEffects && !!dg.contraindications,
      "النشرة: جرعة + آثار جانبية + موانع"
    );
    assert(dg.pregnancyCategory === "B", `فئة الحمل موثقة (${dg.pregnancyCategory})`);
    assert(
      det.body?.availability?.linked === true,
      "التوفر الحي مربوط بالمخزون عبر الباركود"
    );
    // البدائل: الباراسيتامول له منتجان (أدول 650 / بانادول أدفانس 975)
    const alts = det.body?.alternatives ?? [];
    const panFromAdol = alts.find((a: any) => a.tradeName === "بانادول أدفانس 500");
    assert(
      alts.length >= 1 && !!panFromAdol,
      "بدائل الباراسيتامول: بانادول أدفانس موجود"
    );
    assert(
      panFromAdol.savingsHalalas === -325 && panFromAdol.cheaperByPct === -50,
      `حساب الوفر دقيق (${panFromAdol?.savingsHalalas} هللة، ${panFromAdol?.cheaperByPct}%)`
    );
    // من منظور بانادول: أدول أرخص بـ 325 هللة (33%) ويظهر أولاً
    const listP = await req("GET", "/api/drugs?q=" + encodeURIComponent("بانادول"));
    const panadol = (listP.body?.results ?? [])[0];
    const detP = await req("GET", `/api/drugs/${panadol.id}`);
    const altsP = detP.body?.alternatives ?? [];
    const adolFromP = altsP.find((a: any) => a.tradeName === "أدول 500");
    assert(
      adolFromP?.savingsHalalas === 325 && adolFromP?.cheaperByPct === 33,
      `البديل الأرخص يوفر 325 هللة (33%)`
    );
    assert(altsP[0]?.tradeName === "أدول 500", "الأرخص يُرتَّب أولاً");
    // التداخلات الموثقة في النشرة: الباراسيتامول × الوارفارين
    const inter = det.body?.interactions ?? [];
    const wf = inter.find((i: any) => i.otherGeneric === "warfarin");
    assert(
      !!wf && wf.severity === "moderate" && !!wf.management,
      "تداخل موثق في النشرة: warfarin مع خطة إدارة"
    );
    const missing = await req("GET", "/api/drugs/does-not-exist");
    assert(missing.status === 404, "بطاقة غير موجودة → 404");
  }

  // S33 — فاحص التفاعلات للعميل: نفس محرك البوابة السريرية
  console.log("\n▶ S33: فاحص التفاعلات — محرك clinical كامل بلا جلسة");
  {
    const findId = async (name: string) => {
      const r = await req("GET", "/api/drugs?q=" + encodeURIComponent(name));
      return (r.body?.results ?? [])[0]?.id;
    };
    const warf = await findId("كومادين");
    const asp = await findId("أسبرين بروتكت");
    const ibu = await findId("بروفين 400");
    const sil = await findId("فياجرا");
    const iso = await findId("إيزوكيت");
    const zyr = await findId("زيرتك");
    const vitc = await findId("فيتامين س");
    assert(!!warf && !!asp && !!ibu && !!sil && !!iso && !!zyr && !!vitc, "كل بطاقات الفحص موجودة");
    // زوج خطير موثق
    const pair = await req("POST", "/api/drugs/interactions", { json: { drugIds: [warf, asp] } });
    assert(
      pair.status === 200 && pair.body?.summary?.pairs === 1,
      `زوج واحد موثق (${pair.body?.summary?.pairs})`
    );
    assert(pair.body?.results?.[0]?.severity === "major", "الشدة major");
    assert(
      !!pair.body?.results?.[0]?.mechanism &&
        !!pair.body?.results?.[0]?.management &&
        !!pair.body?.results?.[0]?.source,
      "آلية + إدارة + مصدر علمي"
    );
    // استقلال الترتيب
    const rev = await req("POST", "/api/drugs/interactions", { json: { drugIds: [asp, warf] } });
    assert(
      rev.body?.summary?.pairs === 1 && rev.body?.results?.[0]?.severity === "major",
      "استقلال الترتيب: نفس النتيجة بمعكوس الأزواج"
    );
    // ثلاثي: وارفارين+أسبرين، وارفارين+إيبوبروفين (major)، أسبرين+إيبوبروفين (moderate)
    const trio = await req("POST", "/api/drugs/interactions", { json: { drugIds: [warf, asp, ibu] } });
    assert(trio.body?.summary?.pairs === 3, `ثلاثي = 3 أزواج (${trio.body?.summary?.pairs})`);
    assert(trio.body?.summary?.highest === "major", "الأخطر: major");
    assert(trio.body?.summary?.bySeverity?.moderate === 1, "توزيع الشدة: 1 متوسط");
    // ممنوع سريرياً حاجب
    const contra = await req("POST", "/api/drugs/interactions", { json: { drugIds: [sil, iso] } });
    assert(
      contra.body?.summary?.blocking === true && contra.body?.summary?.highest === "contraindicated",
      "نترات × PDE5 → ممنوع سريرياً (حاجب)"
    );
    // زوج آمن
    const safe = await req("POST", "/api/drugs/interactions", { json: { drugIds: [zyr, vitc] } });
    assert(safe.body?.summary?.pairs === 0, "زوج آمن: صفر تداخلات");
    // العلاج المكرر: أدول + بانادول (نفس الفئة العلاجية)
    const adol2 = await findId("أدول 500");
    const pan2 = await findId("بانادول");
    const dup = await req("POST", "/api/drugs/interactions", { json: { drugIds: [adol2, pan2] } });
    assert((dup.body?.duplicates ?? []).length >= 1, "علاج مكرر مرصود: باراسيتامول بنفس الفئة");
    // تحقق المدخلات
    const one = await req("POST", "/api/drugs/interactions", { json: { drugIds: [warf] } });
    assert(one.status === 400, "دواء واحد → 400");
    const nine = await req("POST", "/api/drugs/interactions", {
      json: { drugIds: [warf, asp, ibu, sil, iso, zyr, vitc, adol2, pan2] },
    });
    assert(nine.status === 400, "9 أدوية → 400 (حد 8)");
    const bad = await req("POST", "/api/drugs/interactions", { json: { drugIds: [warf, "nope-404"] } });
    assert(bad.status === 404, "معرف غير موجود → 404");
  }

  // S34 — حاكمية محتوى الدليل: قراءة عامة، كتابة محمية بالأدوار
  console.log("\n▶ S34: حاكمية المحتوى — قراءة عامة وكتابة محمية");
  {
    // S30 سحبت كل جلسات tech1 عمداً (اختبار الإنهاء الجماعي) — نعيد الدخول لهذه المرحلة
    await login("tech1", "Tech@2026!");
    const draft = {
      tradeName: `دواء E2E ${Date.now()}`,
      scientificName: "e2e-substance",
      scientificNameAr: "مادة اختبار",
      form: "أقراص",
      strength: "1 ملغ",
      manufacturer: "مختبر E2E",
      priceHalalas: 1000,
      category: "مضادات حيوية",
      indications: "بطاقة اختبار آلي حية لدليل الدواء v4.0 — تُحذف تلقائياً.",
      dosageGuide: "قرص واحد يومياً أثناء الاختبار فقط.",
      sideEffects: "لا آثار — بطاقة افتراضية للتحقق من الحاكمية.",
      contraindications: "لا موانع — بطاقة افتراضية.",
    };
    const anon = await req("POST", "/api/drugs", { json: draft });
    assert(anon.status === 401, "إضافة بلا جلسة → 401", `وصل ${anon.status}`);
    const tech = await req("POST", "/api/drugs", { cookie: jar.tech1, json: draft });
    assert(tech.status === 403, "فني → 403", `وصل ${tech.status}`);
    const ph = await req("POST", "/api/drugs", { cookie: jar.pharmacist, json: draft });
    assert(ph.status === 201, "صيدلي ينشئ بطاقة → 201", `وصل ${ph.status}`);
    const newId = ph.body?.drug?.id;
    const badBc = await req("POST", "/api/drugs", {
      cookie: jar.pharmacist,
      json: { ...draft, tradeName: draft.tradeName + "-BC", linkedBarcode: "0000000000000" },
    });
    assert(badBc.status === 400, "باركود غير مخزون → 400");
    const dup = await req("POST", "/api/drugs", { cookie: jar.pharmacist, json: draft });
    assert(dup.status === 409, "اسم تجاري مكرر → 409");
    const upd = await req("PUT", `/api/drugs/${newId}`, {
      cookie: jar.pharmacist,
      json: { priceHalalas: 1234, indications: "تحديث E2E للنشرة" },
    });
    assert(
      upd.status === 200 && upd.body?.drug?.priceHalalas === 1234,
      "صيدلي يحدّث النشرة → 200",
      `وصل ${upd.status} — ${JSON.stringify(upd.body)?.slice(0, 120)}`
    );
    const techUpd = await req("PUT", `/api/drugs/${newId}`, {
      cookie: jar.tech1,
      json: { priceHalalas: 1 },
    });
    assert(techUpd.status === 403, "تحديث بفني → 403", `وصل ${techUpd.status}`);
    const still = await prisma.drug.findUnique({ where: { id: newId } });
    assert(still?.priceHalalas === 1234, "القاعدة تعكس التحديث الموثوق");
    // تنظيف البطاقة المؤقتة
    await prisma.drug.delete({ where: { id: newId } });
  }
}

// ───────────────────────── التشغيل ─────────────────────────
async function main() {
  const t0 = Date.now();
  try {
    await setup();
    await scenarios();
  } catch (e) {
    failures.push(`فشل عام: ${e instanceof Error ? e.message : String(e)}`);
    console.error(e);
  } finally {
    stopServer();
    await prisma.$disconnect();
  }

  console.log("\n════════════════════════════════════");
  console.log(
    `✅ نجح: ${passed}   ❌ فشل: ${failures.length}   ⏱ ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
  if (failures.length) {
    console.log("\nالإخفاقات:");
    failures.forEach((f) => console.log(`  • ${f}`));
    process.exit(1);
  }
}

main();
