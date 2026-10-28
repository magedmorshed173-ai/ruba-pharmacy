/**
 * v5.5 — التحليلات التنفيذية النقية («البصيرة التحليلية»)
 *
 * كل الدوال نقية وحتمية وقابلة للاختبار بلا قاعدة بيانات، والمسار
 * `/api/dashboard` يمرر إليها صفوفاً مجلوبة حديثاً فقط. القاعدة الذهبية
 * نفسها من v5.1.0: **التقويم هو توقيت الرياض (UTC+3) لا UTC** — اليوم
 * الأسبوعي والشهري ورسم الاتجاه والدلاء كلها تُحسب بحدود الرياض، فلا
 * يعود بيع الساعة 10 مساءً يقع في يوم الخطأ في أي رسم.
 *
 * اصطلاحات الأرباح مطابقة لـ profit.ts (v3.3):
 *   الإيراد = netAmount (هللات، بعد الخصم) · الربح = الإيراد − Σ تكلفة البنود
 */

import { astParts, astDate } from "./report-periods";

const DAY_MS = 86_400_000;

/** تقريب لعشري واحد — نسب الهامش والمزيج */
function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/* ── المدخلات (صفوف مجلوبة — تُقرأ دفاعياً كما في بريد اللقطات) ───────── */

export interface AnalyticsSaleItem {
  medicineName: string;
  quantity: number;
  subtotal: number; // هللات
  costHalalas: number; // هللات — لقطة FEFO وقت البيع
}

export interface AnalyticsSale {
  status?: string; // completed افتراضياً — void يُتخطى دفاعياً
  saleDate: Date | string;
  netAmount: number; // هللات
  paymentMethod: string; // cash | card | insurance
  items: AnalyticsSaleItem[];
}

export interface AnalyticsBatch {
  expiryDate: Date | string;
  quantity: number;
  unitCost: number; // هللات
}

/* ── المخرجات ─────────────────────────────────────────────────────────── */

export interface TrendPoint {
  date: string; // YYYY-MM-DD بتوقيت الرياض
  label: string; // d/m للعرض على المحور
  revenue: number; // هللات
  profit: number; // هللات
  count: number;
}

export interface TopMedicineRow {
  name: string;
  quantity: number;
  revenue: number; // هللات
  profit: number; // هللات
  marginPct: number; // 0-100
}

export interface PaymentMixRow {
  method: string;
  label: string;
  count: number;
  revenue: number; // هللات
  pct: number; // 0-100 من إجمالي الإيراد
}

export interface ExpiryBucket {
  key: "expired" | "d30" | "d60" | "d90" | "d180" | "later";
  label: string;
  count: number;
  quantity: number;
  costValue: number; // هللات — القيمة المهددة بالتكلفة
}

export interface AnalyticsSummary {
  revenue: number; // هللات
  profit: number; // هللات
  marginPct: number; // 0-100
  avgBasket: number; // هللات
  count: number;
}

export interface AnalyticsResult {
  trend: TrendPoint[];
  topMedicines: TopMedicineRow[];
  paymentMix: PaymentMixRow[];
  expiry: ExpiryBucket[];
  summary: AnalyticsSummary;
}

export const PAYMENT_METHOD_AR: Record<string, string> = {
  cash: "نقدي",
  card: "شبكة",
  insurance: "تأمين",
};

/* ── مفتاح اليوم بتوقيت الرياض ────────────────────────────────────────── */

/** مفتاح YYYY-MM-DD بالرياض — البيع 21:30Z يوم 28 = "2026-10-29" بالرياض */
export function astDayKey(d: Date | string): string {
  const t = d instanceof Date ? d : new Date(d);
  const p = astParts(t);
  const mm = String(p.m + 1).padStart(2, "0");
  const dd = String(p.d).padStart(2, "0");
  return `${p.y}-${mm}-${dd}`;
}

/* ── اتجاه يومي (إيراد + ربح + عدد فواتير) ────────────────────────────── */

/** آخر `days` يوماً شاملة اليوم الحالي الجزئي — الأيام الفارغة صفر لا غياب */
export function buildTrend(sales: AnalyticsSale[], days: number, now: Date = new Date()): TrendPoint[] {
  const n = Math.max(1, Math.min(365, Math.floor(days)));
  const p = astParts(now);
  const start = astDate(p.y, p.m, p.d - (n - 1)); // Date.UTC يطبّع الأيام السالبة تلقائياً

  const buckets = new Map<string, TrendPoint>();
  for (let i = 0; i < n; i++) {
    const d = new Date(start.getTime() + i * DAY_MS);
    const bp = astParts(d);
    buckets.set(astDayKey(d), {
      date: astDayKey(d),
      label: `${bp.d}/${bp.m + 1}`,
      revenue: 0,
      profit: 0,
      count: 0,
    });
  }

  for (const s of sales) {
    if (s.status === "void") continue; // دفاعي — المسار يفلتر أصلاً
    const b = buckets.get(astDayKey(s.saleDate));
    if (!b) continue; // خارج النافذة
    let cost = 0;
    for (const it of s.items ?? []) cost += Number(it.costHalalas) || 0;
    b.revenue += Number(s.netAmount) || 0;
    b.profit += (Number(s.netAmount) || 0) - cost;
    b.count += 1;
  }
  return Array.from(buckets.values());
}

/* ── أعلى الأصناف بالإيراد ───────────────────────────────────────────── */

export function buildTopMedicines(sales: AnalyticsSale[], topN = 8, now: Date = new Date()): TopMedicineRow[] {
  void now; // التوقيع موحّد مع بقية البنّاءات
  const map = new Map<string, { quantity: number; revenue: number; cost: number }>();
  for (const s of sales) {
    if (s.status === "void") continue;
    for (const it of s.items ?? []) {
      const row = map.get(it.medicineName) ?? { quantity: 0, revenue: 0, cost: 0 };
      row.quantity += Number(it.quantity) || 0;
      row.revenue += Number(it.subtotal) || 0;
      row.cost += Number(it.costHalalas) || 0;
      map.set(it.medicineName, row);
    }
  }
  return Array.from(map.entries())
    .map(([name, v]) => ({
      name,
      quantity: v.quantity,
      revenue: v.revenue,
      profit: v.revenue - v.cost,
      marginPct: v.revenue > 0 ? round1(((v.revenue - v.cost) / v.revenue) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)
    .slice(0, Math.max(1, topN));
}

/* ── مزيج طرق الدفع ──────────────────────────────────────────────────── */

export function buildPaymentMix(sales: AnalyticsSale[], now: Date = new Date()): PaymentMixRow[] {
  void now;
  const order = ["cash", "card", "insurance"];
  const map = new Map<string, { count: number; revenue: number }>();
  for (const s of sales) {
    if (s.status === "void") continue;
    const key = s.paymentMethod || "cash";
    const row = map.get(key) ?? { count: 0, revenue: 0 };
    row.count += 1;
    row.revenue += Number(s.netAmount) || 0;
    map.set(key, row);
  }
  const total = Array.from(map.values()).reduce((acc, v) => acc + v.revenue, 0);
  // الترتيب الثابت (نقدي → شبكة → تأمين → أخرى) ثم الإيراد تنازلياً داخل «أخرى»
  return Array.from(map.entries())
    .map(([method, v]) => ({
      method,
      label: PAYMENT_METHOD_AR[method] ?? "أخرى",
      count: v.count,
      revenue: v.revenue,
      pct: total > 0 ? round1((v.revenue / total) * 100) : 0,
    }))
    .sort((a, b) => {
      const ia = order.indexOf(a.method);
      const ib = order.indexOf(b.method);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return b.revenue - a.revenue;
    });
}

/* ── دلاء انتهاء الصلاحية ─────────────────────────────────────────────── */

/**
 * ستة دلاء: منتهية (حتى فجر اليوم بالرياض) → 30 → 60 → 90 → 180 → أبعد.
 * اصطلاح الصلاحية مطابق للوحة القديمة: الدفعة التي ينبتي تاريخها اليوم
 * تُحتسب «منتهية» (تُحجب عن الصرف عملياً بنهاية اليوم).
 */
export function buildExpiryBuckets(batches: AnalyticsBatch[], now: Date = new Date()): ExpiryBucket[] {
  const p = astParts(now);
  const startToday = astDate(p.y, p.m, p.d).getTime();
  const defs: { key: ExpiryBucket["key"]; label: string; limit: number }[] = [
    { key: "expired", label: "منتهية", limit: startToday },
    { key: "d30", label: "خلال 30 يوماً", limit: startToday + 30 * DAY_MS },
    { key: "d60", label: "31–60 يوماً", limit: startToday + 60 * DAY_MS },
    { key: "d90", label: "61–90 يوماً", limit: startToday + 90 * DAY_MS },
    { key: "d180", label: "91–180 يوماً", limit: startToday + 180 * DAY_MS },
    { key: "later", label: "أبعد من 180 يوماً", limit: Number.POSITIVE_INFINITY },
  ];
  const buckets = new Map<ExpiryBucket["key"], ExpiryBucket>(
    defs.map((d) => [d.key, { key: d.key, label: d.label, count: 0, quantity: 0, costValue: 0 }])
  );
  for (const b of batches) {
    if (!(Number(b.quantity) > 0)) continue; // دفعة مستنزفة — لا قيمة مهددة
    const exp = new Date(b.expiryDate).getTime();
    const def = defs.find((d) => exp <= d.limit) ?? defs[defs.length - 1];
    const bucket = buckets.get(def.key)!;
    bucket.count += 1;
    bucket.quantity += Number(b.quantity) || 0;
    bucket.costValue += (Number(b.quantity) || 0) * (Number(b.unitCost) || 0);
  }
  return Array.from(buckets.values());
}

/* ── نقطة الدخول الموحدة ──────────────────────────────────────────────── */

export function buildAnalytics(
  sales: AnalyticsSale[],
  batches: AnalyticsBatch[],
  days = 30,
  now: Date = new Date()
): AnalyticsResult {
  const trend = buildTrend(sales, days, now);
  const summary = trend.reduce<AnalyticsSummary>(
    (acc, t) => {
      acc.revenue += t.revenue;
      acc.profit += t.profit;
      acc.count += t.count;
      return acc;
    },
    { revenue: 0, profit: 0, marginPct: 0, avgBasket: 0, count: 0 }
  );
  summary.marginPct = summary.revenue > 0 ? round1((summary.profit / summary.revenue) * 100) : 0;
  summary.avgBasket = summary.count > 0 ? Math.round(summary.revenue / summary.count) : 0;

  return {
    trend,
    topMedicines: buildTopMedicines(sales, 8, now),
    paymentMix: buildPaymentMix(sales, now),
    expiry: buildExpiryBuckets(batches, now),
    summary,
  };
}
