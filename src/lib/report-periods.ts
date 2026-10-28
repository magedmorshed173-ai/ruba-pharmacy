/**
 * v5.1 — نافذتا الفترات للتقارير المجدولة
 *
 * v5.0 كانت تحسب اللقطة اليومية بمنتصف ليل UTC — فرق 3 ساعات عن يوم العمل
 * السعودي الفعلي: مبيعات 9م–12م كانت تُسجَّل في اليوم التالي. هنا تُوحَّد
 * كل الفترات على توقيت السعودية (UTC+3 ثابت بلا توقيت صيفي رسمياً).
 *
 * التحويل: نزيح اللحظة +3 ساعات ثم نقرأ مكونات UTC — فيصير "توقيت الرياض"
 * هو محور الحساب، ونُرجع النتيجة بطرح الإزاحة نفسها.
 */

export type SnapshotKind = "daily" | "weekly" | "monthly";

export const SNAPSHOT_KINDS: readonly SnapshotKind[] = ["daily", "weekly", "monthly"];

export function isSnapshotKind(v: string): v is SnapshotKind {
  return (SNAPSHOT_KINDS as readonly string[]).includes(v);
}

/** تسمية عربية لنوع اللقطة (للواجهة والتصدير والبريد) */
export const KIND_LABEL_AR: Record<SnapshotKind, string> = {
  daily: "يومي",
  weekly: "أسبوعي",
  monthly: "شهري",
};

/** إزاحة توقيت السعودية عن UTC — ثابتة: السعودية لا تطبّق التوقيت الصيفي */
export const AST_OFFSET_MS = 3 * 60 * 60 * 1000;

/** مكوّنات اللحظة بتوقيت الرياض: نزيح +3 ثم نقرأ مكونات UTC */
export function astParts(d: Date): { y: number; m: number; d: number; dow: number } {
  const t = new Date(d.getTime() + AST_OFFSET_MS);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth(),
    d: t.getUTCDate(),
    dow: t.getUTCDay(),
  };
}

/** بناء لحظة من مكونات بتوقيت الرياض (الشهر واليوم يتجاوزان حدود مداهما تلقائياً) */
export function astDate(y: number, m: number, d: number, hours = 0): Date {
  return new Date(Date.UTC(y, m, d, hours, 0, 0) - AST_OFFSET_MS);
}

const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

/** تاريخ عربي مختصر بتوقيت الرياض: «27 أكتوبر 2026» */
export function fmtAstDate(d: Date): string {
  const p = astParts(d);
  return `${p.d} ${MONTHS_AR[p.m]} ${p.y}`;
}

export interface ReportPeriod {
  kind: SnapshotKind;
  /** بداية الفترة (منضمنة) — منتصف ليل الرياض */
  periodStart: Date;
  /** نهايتها الحصرية — منتصف ليل الرياض لليلة التالية */
  periodEnd: Date;
  /** وصف عربي جاهز للعرض: «الأسبوعي — 19 أكتوبر 2026 إلى 25 أكتوبر 2026» */
  label: string;
}

/**
 * نافذة الفترة المغطاة بحسب النوع، محسوبة لحظة الطلب:
 *  • daily   — يوم أمس الكامل بالرياض (اللقطة اليومية تعمل 00:00 الرياض).
 *  • weekly  — آخر أسبوع اثنين–أحد مكتمل بالرياض (اللقطة أول الاثنين).
 *  • monthly — الشهر الميلادي السابق كاملاً بالرياض (اللقطة بداية الشهر).
 * الدوال نقية/idempotent: الاستدعاء مرتين في اليوم نفسه يعطي النافذة ذاتها.
 */
export function periodFor(kind: SnapshotKind, now: Date = new Date()): ReportPeriod {
  const p = astParts(now);

  if (kind === "daily") {
    const start = astDate(p.y, p.m, p.d - 1);
    const end = astDate(p.y, p.m, p.d);
    return { kind, periodStart: start, periodEnd: end, label: `اليومي — ${fmtAstDate(start)}` };
  }

  if (kind === "weekly") {
    // أصل اثنين الأسبوع الحالي بالرياض ثم نرجع أسبوعاً كاملاً (اثنين → أحد)
    const daysSinceMonday = (p.dow + 6) % 7;
    const start = astDate(p.y, p.m, p.d - daysSinceMonday - 7);
    const end = new Date(start.getTime() + 7 * 24 * 3600 * 1000);
    // التسمية تصف آخر يوم مغطى (الأحد) لا الحد الحصري (اثنين التالي)
    const lastDay = new Date(end.getTime() - 24 * 3600 * 1000);
    return {
      kind,
      periodStart: start,
      periodEnd: end,
      label: `الأسبوعي — ${fmtAstDate(start)} إلى ${fmtAstDate(lastDay)}`,
    };
  }

  // monthly — الشهر الميلادي السابق كاملاً (Date.UTC يطبّع m-1 حتى مع يناير)
  const start = astDate(p.y, p.m - 1, 1);
  const end = astDate(p.y, p.m, 1);
  const sp = astParts(start);
  return {
    kind,
    periodStart: start,
    periodEnd: end,
    label: `الشهري — ${MONTHS_AR[sp.m]} ${sp.y}`,
  };
}

/**
 * الفترات التي «استحقت» التوليد عند مرور الكرون اليومي:
 * تُنفَّذ اللقطة اليومية دائماً، والأسبوعية أول الاثنين بالرياض،
 * والشهرية أول يوم من الشهر — كل ذلك من كرون واحد (حد Hobby في Vercel).
 */
export function dueKinds(now: Date = new Date()): SnapshotKind[] {
  const p = astParts(now);
  const kinds: SnapshotKind[] = ["daily"];
  if (p.dow === 1) kinds.push("weekly"); // الاثنين بالرياض
  if (p.d === 1) kinds.push("monthly"); // أول الشهر بالرياض
  return kinds;
}
