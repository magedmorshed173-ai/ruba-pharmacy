/**
 * المحرك السريري — ربي فارمسي v3.5
 * دوال نقية 100% (بلا قاعدة بيانات) لفحوص السلامة الدوائية:
 *  1) تصنيف شدة التداخلات بعد نمط Lexicomp/Stockley
 *  2) مطابقة حساسية المريض مع عائلات الدواء (حساسية عرضية/متقاطعة)
 *  3) كشف العلاج المكرر عبر الفئة العلاجية (ATC)
 * كل قرار مرفق بمصدره العلمي — قابل للتدقيق والاختبار الوحدوي.
 */

export type InteractionSeverity =
  | "contraindicated"
  | "major"
  | "moderate"
  | "minor";

/** ترتيب الخطورة التصاعدي — الأعلى رقمياً أخطر */
export const SEVERITY_RANK: Record<InteractionSeverity, number> = {
  minor: 1,
  moderate: 2,
  major: 3,
  contraindicated: 4,
};

export const SEVERITY_LABEL: Record<InteractionSeverity, string> = {
  contraindicated: "ممنوع سريرياً",
  major: "خطير",
  moderate: "متوسط",
  minor: "بسيط",
};

/** مستويات الأدلة العلمية (نمط Stockley) */
export const EVIDENCE_LABEL: Record<string, string> = {
  documented: "موثق سريرياً",
  probable: "مرجّح",
  theoretical: "نظري",
};

export const ONSET_LABEL: Record<string, string> = {
  rapid: "فوري (خلال ساعات)",
  delayed: "متأخر (أيام إلى أسابيع)",
};

/** يحلّ severity النصي القادم من قاعدة البيانات إلى النوع الآمن */
export function parseSeverity(s: string): InteractionSeverity {
  return (["contraindicated", "major", "moderate", "minor"] as const).includes(
    s as InteractionSeverity
  )
    ? (s as InteractionSeverity)
    : "moderate";
}

/**
 * عائلات الحساسية الدوائية — المطابقة المتقاطعة بين حساسية المريض
 * (نص حر) والمواد الفعالة. كل عائلة: كلمات مفتاحية عربية/إنجليزية
 * للألرجيا + المواد الفعالة (Generics) التي تحملها العائلة.
 * المرجع: تصنيف فرط الحساسية الدوائية (WHO / EAACI).
 */
export interface AllergyFamily {
  family: string;
  familyAr: string;
  /** كلمات يدل وجودها في سجل حساسية المريض على انتماء العائلة */
  allergyKeywords: string[];
  /** المواد الفعالة (كجزء نصي) التي تُفعّل العائلة */
  generics: string[];
  /** ملاحظة سريرية تُعرض للصيدلي */
  note: string;
}

export const ALLERGY_FAMILIES: AllergyFamily[] = [
  {
    family: "penicillin",
    familyAr: "مضادات البنسلين (بيتا-لاكتام)",
    allergyKeywords: ["بنسلين", "penicillin", "amoxicillin", "augmentin", "أوجمنتين"],
    generics: ["amoxicillin", "amoxicillin/clavulanic", "ampicillin", "flucloxacillin", "penicillin"],
    note: "خطر تفاعل تحسسي شديد (تأق) — تجنّب كامل العائلة وافحص البديل من فئة أخرى (مثل ماكروليد).",
  },
  {
    family: "nsaid",
    familyAr: "مضادات التهاب غير ستيرويدية",
    allergyKeywords: ["أسبرين", "aspirin", "nsaid", "إيبوبروفين", "ibuprofen"],
    generics: ["aspirin", "ibuprofen", "diclofenac", "ibuprofen topical", "naproxen", "ketoprofen"],
    note: "حساسية متقاطعة داخل العائلة — تُحجب بقية الأعضاء؛ البديل الآمن: الباراسيتامول.",
  },
  {
    family: "sulfonamide",
    familyAr: "المركبات السلفوناميدية",
    allergyKeywords: ["سلفا", "sulfa", "sulfonamide", "باكتريم", "cotrimoxazole"],
    generics: ["sulfamethoxazole", "sulfasalazine", "cotrimoxazole"],
    note: "خطر طفح جلدي وتفاعلات فرط حساسية شديدة — راجع المركبات السلفوناميدية بالكامل.",
  },
  {
    family: "tetracycline",
    familyAr: "مضادات التتراسيكلين",
    allergyKeywords: ["tetracycline", "tetracyclines", "تتراسيكلين"],
    generics: ["tetracycline", "doxycycline", "minocycline"],
    note: "حساسية متقاطعة محتملة داخل العائلة.",
  },
  {
    family: "opioid",
    familyAr: "المسكنات الأفيونية",
    allergyKeywords: ["codeine", "كودائين", "مورفين", "morphine", "opioid"],
    generics: ["codeine", "morphine", "tramadol", "oxycodone"],
    note: "قد لا تتقاطع الحساسية بين جميع الأفيونيات — راجع نوع التفاعل السابق (تحسسي vs. آثار جانبية).",
  },
  {
    family: "lactose",
    familyAr: "اللاكتوز (سواغ)",
    allergyKeywords: ["لاكتوز", "lactose", "حليب"],
    generics: ["lactose"],
    note: "حساسية سواغ — تحقق من قائمة المكونات غير الفعالة للشكل الصيدلاني.",
  },
];

export interface AllergyHit {
  allergy: string;
  familyAr: string;
  medicine: string;
  note: string;
}

/**
 * يطابق نص حساسية المريض (مثل: "بنسلين، لاكتوز") مع قائمة الأدوية.
 * المطابقة نصية جزئية غير حساسة لحالة الأحرف على مستوى الكلمة المفتاحية
 * والمادة الفعالة — ثم تُبنى تنبيهات بالعائلة والملاحظة السريرية.
 */
export function allergyConflicts(
  patientAllergies: string | null | undefined,
  meds: { name: string; genericName: string }[]
): AllergyHit[] {
  const raw = String(patientAllergies ?? "").trim();
  if (!raw) return [];

  // تقسيم نص الحساسية إلى عناصر (فواصل عربية/إنجليزية شائعة)
  const allergyItems = raw
    .split(/[,،;؛\n\/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (allergyItems.length === 0) return [];

  const hits: AllergyHit[] = [];
  for (const allergy of allergyItems) {
    const a = allergy.toLowerCase();
    const family = ALLERGY_FAMILIES.find((f) =>
      f.allergyKeywords.some((k) => a.includes(k.toLowerCase()))
    );
    if (!family) continue;

    for (const med of meds) {
      const g = String(med.genericName ?? "").toLowerCase();
      const n = String(med.name ?? "").toLowerCase();
      const matched =
        family.generics.some((gen) => g.includes(gen.toLowerCase())) ||
        family.generics.some((gen) => n.includes(gen.toLowerCase()));
      if (matched) {
        hits.push({
          allergy,
          familyAr: family.familyAr,
          medicine: med.name,
          note: family.note,
        });
      }
    }
  }
  return hits;
}

export interface DuplicateGroup {
  atcClass: string;
  names: string[];
}

/**
 * يكشف العلاج المكرر: أدوية مختلفة تنتمي لنفس الفئة العلاجية الوظيفية
 * (atcClass) داخل السلة — دون دمج نفس الدواء المكرر بكميات.
 * المرجع: مفهوم Duplicate Therapy في مراجعة الأدوية الصيدلانية.
 */
export function duplicateTherapyGroups(
  meds: { id: string; name: string; atcClass?: string | null }[]
): DuplicateGroup[] {
  const byClass = new Map<string, { id: string; name: string }[]>();
  for (const m of meds) {
    const cls = String(m.atcClass ?? "").trim();
    if (!cls) continue;
    const bucket = byClass.get(cls) ?? [];
    if (!bucket.some((x) => x.id === m.id)) bucket.push({ id: m.id, name: m.name });
    byClass.set(cls, bucket);
  }
  return Array.from(byClass.entries())
    .filter(([, list]) => list.length >= 2)
    .map(([atcClass, list]) => ({ atcClass, names: list.map((x) => x.name) }));
}

/**
 * يوحّد زوج المادتين الفعالتين أبجدياً — يمنع تكرار نفس التداخل
 * بأمرين معكوسين (warfarin+aspirin = aspirin+warfarin).
 */
export function normalizePair(a: string, b: string): [string, string] {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return x <= y ? [x, y] : [y, x];
}

/** فحص الجرعة اليومية القصوى — تحذير إن تجاوزت الكمية المبيعة الحد */
export function exceedsMaxDailyDose(
  maxDailyDose: number | null | undefined,
  requestedQty: number
): boolean {
  if (!maxDailyDose || maxDailyDose <= 0) return false;
  return requestedQty > maxDailyDose;
}
