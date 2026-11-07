/**
 * v5.6 — منطق الجرد الفعلي (نقي — بلا قاعدة بيانات)
 *
 * الدلالة الموثقة:
 *  • الجلسة تجمّد أرصدة النظام لكل دفعة نشطة لحظة الفتح — ما بعدها مبيعات
 *    وتوريدات جديدة لا تلغي صحة العدّ: التطبيق يصحّح الرصيد الحي إلى
 *    الكمية المعدودة (العدّ هو الحقيقة)، والفرق يُحسب مقابل الرصيد الحي
 *    لا المجمّد حتى لا تُمحى حركات ما بين الفتح والتطبيق.
 *  • بند بلا countedQty = لم يُعدّ — يُتخطى عند التطبيق بلا مساس.
 *  • الثابت المحفوظ «مجموع المخصص ≤ المركزي»: تخفيض المركزي بعجز جرد
 *    قد يخالفه — مسموح فقط إن بقي المركزي الجديد يغطي المخصص، وإلا
 *    رُفض تطبيق البند برسالة عربية (أعد الكميات من الفروع أولاً).
 *  • قيمة الفرق بالتكلفة الفعلية للدفعة (unitCost المجمّد) — هللات صحيحة.
 */

export const STOCK_COUNT_STATUSES = ["open", "closed", "cancelled"] as const;
export type StockCountStatus = (typeof STOCK_COUNT_STATUSES)[number];

export const STOCK_COUNT_STATUS_AR: Record<StockCountStatus, string> = {
  open: "جارٍ",
  closed: "مطبَّق",
  cancelled: "ملغى",
};

/** ألوان شرائح الحالة في الواجهة (نمط transfers-dialog) */
export const STOCK_COUNT_STATUS_CLASS: Record<StockCountStatus, string> = {
  open: "border-amber-300 bg-amber-50 text-amber-700",
  closed: "border-teal-300 bg-teal-50 text-teal-700",
  cancelled: "border-slate-300 bg-slate-100 text-slate-500",
};

/** حد الدفعات لجلسة واحدة — يمنع تجميد ملايين الصفوف بضغطة خاطئة */
export const STOCK_COUNT_MAX_BATCHES = 5000;
/** حد بنود الإدخال في نداء submit واحد */
export const STOCK_COUNT_MAX_SUBMIT = 2000;
/** حد صفوف ورقة Excel */
export const STOCK_COUNT_MAX_EXPORT_ROWS = 5000;

/** رقم جلسة فريد قصير: SC-YYYYMMDD-6محارف عشوائية — قيد unique حصن أخير */
export function newStockCountNumber(now: Date = new Date()): string {
  const d = new Date(now.getTime() + 3 * 3600_000); // توقيت الرياض
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
  let rand = "";
  for (let i = 0; i < 6; i++) rand += "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)];
  return `SC-${ymd}-${rand}`;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** تحقق ملاحظة فتح الجلسة قبل لمس القاعدة */
export function validateStartInput(input: { note?: string | null }): ValidationResult {
  if (input.note && input.note.length > 300)
    return { ok: false, error: "الملاحظة أطول من 300 حرف" };
  return { ok: true };
}

/**
 * تطبيع كمية معدودة واحدة:
 *  • null/undefined/"" ⇒ null (لم يُعدّ — تخطٍّ مقصود)
 *  • عدد صحيح ضمن [0, 1,000,000] ⇒ القيمة
 *  • غير ذلك ⇒ false (إدخال مرفوض)
 */
export function parseCountedQty(raw: unknown): number | null | false {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) return false;
  if (n < 0 || n > 1_000_000) return false;
  return n;
}

/* ── حساب الفروقات (نقي — للواجهة والتقرير والتطبيق) ───────────────── */

export type VarianceKind = "match" | "increase" | "decrease" | "skipped";

export interface VarianceInputRow {
  systemQty: number;
  countedQty: number | null;
  unitCost: number;
}

export interface VarianceRow {
  kind: VarianceKind;
  /** العدّ − النظام الحي (0 للمطابق والمتخطى) */
  delta: number;
  /** delta × تكلفة الوحدة — هللات (موجب = مكسب دفتري، سالب = عجز) */
  costDelta: number;
}

export interface VarianceTotals {
  counted: number;
  matched: number;
  increased: number;
  decreased: number;
  skipped: number;
  netQtyDelta: number;
  netCostDelta: number;
}

export interface VarianceResult {
  rows: VarianceRow[];
  totals: VarianceTotals;
}

/** تصنيف بند واحد — العدّ مقابل النظام (يُستدعى بالرصيد الحي وقت التطبيق) */
export function classifyRow(row: VarianceInputRow): VarianceRow {
  if (row.countedQty === null || row.countedQty === undefined)
    return { kind: "skipped", delta: 0, costDelta: 0 };
  const delta = row.countedQty - row.systemQty;
  const costDelta = delta * row.unitCost;
  if (delta === 0) return { kind: "match", delta: 0, costDelta: 0 };
  if (delta > 0) return { kind: "increase", delta, costDelta };
  return { kind: "decrease", delta, costDelta };
}

/** مفتاح الملخص لكل تصنيف — مفاتيح الملخص جمع والتصنيفات مفردة */
const TOTALS_KEY: Record<VarianceKind, "matched" | "increased" | "decreased" | "skipped"> = {
  match: "matched",
  increase: "increased",
  decrease: "decreased",
  skipped: "skipped",
};

/** حساب كل الفروقات + الملخص — حتمي، يغذي الواجهة والتقرير والتدقيق */
export function computeVariance(items: VarianceInputRow[]): VarianceResult {
  const rows = items.map(classifyRow);
  const totals: VarianceTotals = {
    counted: 0,
    matched: 0,
    increased: 0,
    decreased: 0,
    skipped: 0,
    netQtyDelta: 0,
    netCostDelta: 0,
  };
  for (const r of rows) {
    totals[TOTALS_KEY[r.kind]] += 1;
    totals.netQtyDelta += r.delta;
    totals.netCostDelta += r.costDelta;
  }
  totals.counted = totals.matched + totals.increased + totals.decreased;
  return { rows, totals };
}

/* ── ثبات التوزيع: المخصص ≤ المركزي ────────────────────────────────── */

export interface InvariantCheck {
  ok: boolean;
  /** المركزي بعد التعديل مطروحاً منه المخصص — سالب = مخالفة */
  headroom: number;
}

/**
 * هل يبقى الثابت صائباً بعد تعديل المركزي بقيمة delta؟
 * المركزي الجديد يجب أن يغطي مجموع المخصص للفروع.
 */
export function checkCentralInvariant(args: {
  centralQuantity: number;
  delta: number;
  totalAssigned: number;
}): InvariantCheck {
  const newCentral = args.centralQuantity + args.delta;
  return { ok: newCentral >= args.totalAssigned, headroom: newCentral - args.totalAssigned };
}

/* ── تسميات عربية للفروقات — الواجهة والتصدير ─────────────────────── */

export const VARIANCE_KIND_AR: Record<VarianceKind, string> = {
  match: "مطابق",
  increase: "زيادة",
  decrease: "عجز",
  skipped: "لم يُعدّ",
};
