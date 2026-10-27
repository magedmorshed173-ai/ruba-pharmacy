/**
 * v5.0 — الذكاء الجرعي: تصفية الكرياتينين + معايير Beers لكبار السن
 * دوال نقية 100% — تُستخدم من الفاحص السريري ومن حاسبة الصيدلي.
 *
 * 1) Cockcroft-Gault: CrCl = [(140 − العمر) × الوزن] / (72 × SCr) × 0.85 للنساء
 *    (المرجع: Cockcroft & Gault 1976 — المعيار العملي في نشرات الأدوية)
 * 2) تعديلات جرعية كلوية لأشهر الأدوية (حدود رسمية من النشرات/FDA)
 * 3) معايير Beers 2023 (AGS) — أدوية يُتجنّبها 65+ مع البديل الآمن
 */

export interface CrclInput {
  ageYears: number;
  weightKg: number;
  serumCreatinineMgDl: number;
  female?: boolean;
}

/** تصفية الكرياتينين (ملليلتر/دقيقة) — Cockcroft-Gault. يرد NaN لمُدخلات لا معنى لها */
export function crcl({ ageYears, weightKg, serumCreatinineMgDl, female }: CrclInput): number {
  if (!(ageYears > 0) || !(weightKg > 0) || !(serumCreatinineMgDl > 0)) return NaN;
  const raw = ((140 - ageYears) * weightKg) / (72 * serumCreatinineMgDl);
  return female ? raw * 0.85 : raw;
}

/** تصنيف وظيفي عربي لمستوى الترشيح — يستخدم في الواجهة والتقارير */
export function renalStage(e: number): string | null {
  if (!Number.isFinite(e) || e <= 0) return null;
  if (e >= 90) return "طبيعي (≥90)";
  if (e >= 60) return "خفيف (60–89)";
  if (e >= 30) return "متوسط (30–59)";
  if (e >= 15) return "شديد (15–29)";
  return "فشل كلوي (<15)";
}

export interface RenalDoseRule {
  /** شرط الترشيح الذي يستدعي التحذير (بالميلي لتر/دقيقة) */
  threshold: number;
  /** اتجاه المقارنة: أقل من العتبة / أعلى منها */
  op: "<" | ">";
  advice: string;
}

/** حدود رسمية مختارة — النشرة + FDA. مفتاحها مادة فعالة */
export const RENAL_DOSING: Record<string, RenalDoseRule[]> = {
  metformin: [
    { threshold: 30, op: "<", advice: "ممنوع تماماً تحت ترشيح 30 — خطر الحماض اللبني." },
    { threshold: 45, op: "<", advice: "لا تبدأه تحت 45؛ إن كان قائماً راجع خفض الجرعة ومراقبة الوظيفة الكلوية كل 3 أشهر." },
  ],
  gabapentin: [
    { threshold: 60, op: "<", advice: "تخفيض جرعة تدريجي تحت 60 (مثل 300–600مغ/يوم تحت 30) — راجع جدول النشرة الكلوي." },
  ],
  pregabalin: [
    { threshold: 60, op: "<", advice: "تخفيض جرعة وفق CrCl — تحت 30: 25–75مغ/يوم مقسمة." },
  ],
  apixaban: [
    { threshold: 25, op: "<", advice: "2.5مغ مرتين يومياً عند استيفاء معايير العمر/الوزن/الكرياتينين — راجع النشرة." },
  ],
  rivaroxaban: [
    { threshold: 50, op: "<", advice: "خفض الجرعة (15مغ مع العشاء للرجفان الأذيني) — ممنوع تحت 15 للاستطباب غير الرجفان." },
  ],
  dabigatran: [
    { threshold: 30, op: "<", advice: "ممنوع — لا تصفية كافية؛ البديل: أبكسابان بتعديل أو وارفارين." },
  ],
  allopurinol: [
    { threshold: 30, op: "<", advice: "ابدأ 50–100مغ/يوم فقط وتدرّج ببطء مع مراقبة الطفح وCBC." },
  ],
  nitrofurantoin: [
    { threshold: 30, op: "<", advice: "ممنوع تحت 30 — فشل العلاج وسمّية عصبية محيطية." },
  ],
  colchicine: [
    { threshold: 30, op: "<", advice: "خفض الجرعة للنصف وتجنب دورات متكررة — سمية الجهاز الهضمي والنقي." },
  ],
  enoxaparin: [
    { threshold: 30, op: "<", advice: "جرعة علاجية: 1مغ/كغ مرة يومياً بدل مرتين تحت 30." },
  ],
  amoxicillin: [
    { threshold: 30, op: "<", advice: "مُباعدة الفواصل إلى كل 12–24 ساعة حسب الشدة." },
  ],
  valacyclovir: [
    { threshold: 50, op: "<", advice: "تخفيض ومُباعدة قوية (أقل من 30: جرعة كل 24 ساعة كحد أقصى للهربس النطاقي)." },
  ],
  metotrexate: [
    { threshold: 60, op: "<", advice: "أعد التقييم — خطر تثبيط نقي شديد؛ راقب CBC قبل كل دورة." },
  ],
  lisinopril: [
    { threshold: 30, op: "<", advice: "ابدأ بجرعة منخفضة (2.5–5مغ) ومراقبة كرياتينين وبوتاسيوم قريبة." },
  ],
};

/**
 * يرد نصيحة الجرعة الكلوية لدواء معيّن عند تصفية معطاة —
 * يختار القاعدة الأشد قابلة للتطبيق (تُفحص بالترتيب).
 */
export function renalAdvice(generic: string, crclValue: number): string | null {
  const rules = RENAL_DOSING[generic.trim().toLowerCase()];
  if (!rules || !Number.isFinite(crclValue) || crclValue <= 0) return null;
  for (const r of rules) {
    const hit = r.op === "<" ? crclValue < r.threshold : crclValue > r.threshold;
    if (hit) return r.advice;
  }
  return null;
}

// ── معايير Beers 2023 (AGS) — مقتطف أشهر المخالفات في الصيدليات ──

export interface BeersEntry {
  generic: string;
  reason: string;
  safer: string;
}

export const BEERS_CRITERIA: BeersEntry[] = [
  { generic: "diazepam", reason: "عمر نصف طويل — تراكم وهذيان وسقوط وكسور", safer: "لورازيبام بمدة قصيرة جداً أو علاج غير دوائي" },
  { generic: "diphenhydramine", reason: "مضاد كوليني قوي — تشوش وهذيان واحتباس بول", safer: "لوراتادين/فيكسوفينادين أو سبارين" },
  { generic: "chlorpheniramine", reason: "مضاد كوليني — تشوش وسقوط", safer: "مضاد هيستامين من الجيل الثاني" },
  { generic: "hydroxyzine", reason: "مضاد كوليني ومهيّئ هذيان", safer: "بدائل غير كولينية للشرط" },
  { generic: "promethazine", reason: "مضاد كوليني وتثبيط مركزي شديد", safer: "مضاد هيستامين حديث أو إعادة تقييم الدواعي" },
  { generic: "amitriptyline", reason: "مضاد كوليني + هبوط ضغط انتصابي + سكتة محتملة", safer: "دولوكسيتين/سانورتيبتين حسب الداعي" },
  { generic: "nitrofurantoin", reason: "غير فعّال تحت ترشيح 30 وسمّية رئوية مع الاستخدام المطوّل", safer: "سيفالكسين/فوسفوميسين" },
  { generic: "ciprofloxacin", reason: "أثر عصبي واضطراب سكر وسقوط — يُفضَّل مضاد أضيق الطيف عند كبار السن", safer: "حسب المزرعة — راجع البديل الأضيق" },
  { generic: "ketorolac", reason: "NSAID حاد — نزف هضمي وفشل كلوي حتى الجرعات القصيرة", safer: "الباراسيتامول" },
  { generic: "ibuprofen", reason: "NSAID مزمن — نزف/كلوي/ضغط (يُتجنب الاستخدام المطوّل)", safer: "باراسيتامول + جيل موضعي عند الضرورة" },
  { generic: "diclofenac", reason: "NSAID — خطر قلبي وعائي ونزفي عالٍ", safer: "الباراسيتامول" },
  { generic: "zolpidem", reason: "أداء مسائي منخفض — هذيان وسقوط وحوادث", safer: "نظافة نوم + ميلاتونين؛ إن اضطر: جرعة صغيرة جداً لمدة قصيرة" },
  { generic: "zopiclone", reason: "كما السابق — سقوط واعتماد", safer: "نظافة نوم أولاً" },
  { generic: "codeine", reason: "تثبيط تنفسي وإمساك — أدنى عتبة أمان عند كبار السن", safer: "الباراسيتامول؛ إن اضطر أفيوني: جرعة صغيرة ومراقبة" },
  { generic: "meperidine", reason: "ناتج أيضي سمّي (normeperidine) — تشنجات", safer: "مورفين/أوكسيكودون بحذر — أياً كان فمدة قصيرة" },
  { generic: "tolterodine", reason: "مضاد كوليني — جفاف وهذيان (يفضل التطريز الجلدي عند الضرورة)", safer: "ميرابيغرون إن تسمح الضغوط" },
];

export interface BeersAlert {
  generic: string;
  reason: string;
  safer: string;
}

/** تحذيرات Beers لقائمة مواد فعالة بعمر معيّن — 65+ فقط */
export function beersAlerts(generics: string[], ageYears: number | null | undefined): BeersAlert[] {
  if (ageYears == null || ageYears < 65) return [];
  const norm = generics.map((g) => g.trim().toLowerCase()).filter(Boolean);
  const out: BeersAlert[] = [];
  for (const entry of BEERS_CRITERIA) {
    const key = entry.generic.toLowerCase();
    if (entry.safer === "—") continue; // مدخل مرجعي غير قابل للتنبيه
    if (norm.some((g) => g.includes(key))) {
      out.push({ generic: entry.generic, reason: entry.reason, safer: entry.safer });
    }
  }
  return out;
}
