/**
 * جناح الاختبارات الحية — ربي فارمسي v3.5
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
  method: "GET" | "POST",
  apiPath: string,
  opts: { cookie?: string; json?: unknown } = {}
): Promise<HttpResult> {
  const res = await fetch(BASE + apiPath, {
    method,
    headers: {
      ...(opts.json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
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

  // S22 — الخروج يبطل الجلسة (كوكي عديم الحالة يُمحى من العميل)
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
