/**
 * بوابة المريض الخاصة — ربي فارمسي v4.3
 * دوال نقية 100% (بلا قاعدة بيانات) لفحوص السلامة المعتمدة على خصائص
 * المريض نفسه — مكمّلة للبوابة السريرية (تداخلات/حساسية/تكرار) لا بديلاً عنها:
 *
 *  1) بوابة الحمل — فئة الحمل FDA (A B C D X) ضد حالة المريض (حامل/مرضعة)
 *  2) بوابة العمر — الحد الأدنى للعمر المعتمد (minAge) ضد العمر المحسوب
 *
 * الفلسفة (متسقة مع قواعد المشروع الراسخة):
 *  - قرارات هذه البوابة سريرية → تقبل «تجاوز صيدلي مسؤول» موثقاً على الفاتورة،
 *    والفني محجوب دائماً — تماماً كتداخلات السلة.
 *  - X أثناء الحمل حاجبة: إجماع نشرات المنظمة (مثل إيزوتريتينوين — مسوخات
 *    مؤكدة)؛ D تحذير (أدلة ضرر بشري — يوازنها الصيدلي مع الفائدة العلاجية).
 *  - الرضاعة لا تتبع فئات FDA (تتبع تصنيف Hale L) → X وحدها تحذير تحققي،
 *    لا حجب — حفاظاً على دقة العلم وهدوء التنبيهات.
 */

export type PregnancyCategory = "A" | "B" | "C" | "D" | "X";

/** وصف عربي مختصر لكل فئة حمل (نمط نشرة FDA المبسطة) */
export const PREGNANCY_CATEGORY_LABEL: Record<PregnancyCategory, string> = {
  A: "دراسات بشرية مضبوطة — لا خطر مُثبت",
  B: "لا دليل على ضرر بالبشر (دراسات حيوانية سليمة)",
  C: "الخطر غير مستبعد — يُوازن الفائدة مقابل الضرر",
  D: "أدلة إيجابية على ضرر بشري — استخدمه إن اضطررت",
  X: "ممنوع في الحمل — دراسات وأدلة تُظهر ضرراً يفوق أي فائدة",
};

export const PREGNANCY_CATEGORIES: PregnancyCategory[] = ["A", "B", "C", "D", "X"];

/**
 * يحلّ نص فئة الحمل القادم من القاعدة إلى الفئة الآمنة.
 * يقبل: "X" | "x" | "فئة X" | "Category X" | "X — نص إضافي" — ويُرجع null
 * عند الغياب أو عدم الصلاحية (بلا فئة = لا فحص حمل لهذا الدواء).
 */
export function parsePregnancyCategory(
  s: string | null | undefined
): PregnancyCategory | null {
  const raw = String(s ?? "").trim();
  if (!raw) return null;
  const ch = raw.replace(/^فئة|^Category/i, "").trim().charAt(0).toUpperCase();
  return (PREGNANCY_CATEGORIES as string[]).includes(ch)
    ? (ch as PregnancyCategory)
    : null;
}

export type PregnancyStatus = "none" | "pregnant" | "breastfeeding";

export const PREGNANCY_STATUS_LABEL: Record<PregnancyStatus, string> = {
  none: "لا ينطبق",
  pregnant: "حامل",
  breastfeeding: "مرضعة",
};

export const PREGNANCY_STATUSES: PregnancyStatus[] = [
  "none",
  "pregnant",
  "breastfeeding",
];

/** يحلّ حالة الحمل النصية القادمة من القاعدة — غير المعروف يُعامَل كـ none */
export function parsePregnancyStatus(s: string | null | undefined): PregnancyStatus {
  const v = String(s ?? "").trim().toLowerCase();
  return (PREGNANCY_STATUSES as string[]).includes(v)
    ? (v as PregnancyStatus)
    : "none";
}

/**
 * العمر بالسنوات من تاريخ الميلاد — كامل السنوات (نمط الوثائق الرسمية).
 * يُرجع null عند غياب التاريخ أو صلته بالمستقبل (بيانات غير صالحة = بلا فحص).
 */
export function ageInYears(
  dob: Date | string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!dob) return null;
  const d = dob instanceof Date ? dob : new Date(dob);
  if (Number.isNaN(d.getTime()) || d.getTime() > now.getTime()) return null;

  let years = now.getFullYear() - d.getFullYear();
  const monthDiff = now.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d.getDate())) years--;
  return years >= 0 ? years : null;
}

/** تنبيه بوابة المريض — يُعرض في المراجعة المركزية ويُحكم به على البيع */
export interface GateAlert {
  medicineId?: string;
  medicine: string;
  kind: "pregnancy_x" | "pregnancy_d" | "pregnancy_breastfeeding" | "age_restriction";
  /** حاجب = يتطلب تجاوز صيدلي مسؤول (الفني محجوب) — متسق مع البوابة السريرية */
  severity: "blocking" | "warning";
  message: string;
  note: string;
}

export interface GateMedInput {
  id?: string;
  name: string;
  pregnancyCategory?: string | null;
  minAge?: number | null;
}

/**
 * بوابة الحمل: يفحص فئة حمل كل دواء في السلة ضد حالة المريض.
 *  - حامل:  X → حاجب · D → تحذير · A/B/C بلا تنبيه (تفادي إزعاج التنبيهات)
 *  - مرضعة: X → تحذير تحققي (تصنيف Hale L يختلف عن FDA) · غير ذلك بلا تنبيه
 *  - بلا حالة خاصة (none) أو بلا فئة محفوظة: بلا تنبيهات.
 */
export function pregnancyConflicts(
  meds: GateMedInput[],
  status: string | null | undefined
): GateAlert[] {
  const st = parsePregnancyStatus(status);
  if (st === "none") return [];

  const alerts: GateAlert[] = [];
  for (const med of meds) {
    const cat = parsePregnancyCategory(med.pregnancyCategory);
    if (!cat) continue;

    if (st === "pregnant") {
      if (cat === "X") {
        alerts.push({
          medicineId: med.id,
          medicine: med.name,
          kind: "pregnancy_x",
          severity: "blocking",
          message: `«${med.name}» من فئة الحمل X — ممنوع أثناء الحمل ويحجب الصرف حتى مراجعة صيدلي`,
          note: PREGNANCY_CATEGORY_LABEL.X,
        });
      } else if (cat === "D") {
        alerts.push({
          medicineId: med.id,
          medicine: med.name,
          kind: "pregnancy_d",
          severity: "warning",
          message: `«${med.name}» من فئة الحمل D — أدلة ضرر بشري؛ راجع الفائدة مقابل الخطر مع الواصف`,
          note: PREGNANCY_CATEGORY_LABEL.D,
        });
      }
    } else {
      // مرضعة — تصنيفات Hale L مختلفة عن فئات FDA؛ X فقط تحذير تحققي
      if (cat === "X") {
        alerts.push({
          medicineId: med.id,
          medicine: med.name,
          kind: "pregnancy_breastfeeding",
          severity: "warning",
          message: `«${med.name}» من فئة الحمل X — يُفضَّل تجنبه أثناء الرضاعة؛ راجع توافقه مع الإرضاع`,
          note: "فئات FDA لا تصف الرضاعة — المرجع: تصنيف Hale للرضاعة",
        });
      }
    }
  }
  return alerts;
}

/**
 * بوابة العمر: يفحص الحد الأدنى للعمر لكل دواء ضد العمر المحسوب من تاريخ
 * الميلاد. بلا تاريخ ميلاد موثق = بلا فحص (لا نُخمّن العمر).
 * أمثلة مرجعية للحدود: أسبرين < 16 سنة (متلازمة راي)، كودائين < 12 سنة.
 */
export function ageRestrictionViolations(
  meds: GateMedInput[],
  ageYears: number | null | undefined
): GateAlert[] {
  const age = typeof ageYears === "number" && Number.isFinite(ageYears) && ageYears >= 0
    ? ageYears
    : null;
  if (age === null) return [];

  const alerts: GateAlert[] = [];
  for (const med of meds) {
    const min = med.minAge ?? null;
    if (!min || min <= 0) continue;
    if (age < min) {
      alerts.push({
        medicineId: med.id,
        medicine: med.name,
        kind: "age_restriction",
        severity: "blocking",
        message: `عمر المريض ${age} سنة وهو أقل من الحد الأدنى المعتمد لدواء «${med.name}» (${min} سنة) — يتطلب مراجعة صيدلي`,
        note: "حد العمر مأخوذ من النشرة المرخصة — مخالفته تحمل خطراً موثقاً (متلازمة راي، تثبيط تنفسي…)",
      });
    }
  }
  return alerts;
}
