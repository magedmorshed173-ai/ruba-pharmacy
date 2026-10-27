/**
 * v5.0 — محرك CYP450 التنبؤي (نمط Medi-Span) — دوال نقية 100%
 *
 * الفكرة: قاعدة معرفية إنزيمية لكل مادة فعالة (ركيزة/مثبط/محفّز لأي إنزيم)،
 * ثم التنبؤ بالتدخلات **ميكانيكياً** حتى للثنائيات غير المنقّحة في القاعدة:
 *   - تثبيط: دواء مثبط للإنزيم × دواء ركيزة لنفس الإنزيم ⇒ ارتفاع تركيز الركيزة
 *   - استحثاث: دواء محفّز × ركيزة ⇒ انخفاض التركيز وفشل العلاج (متأخر البدء)
 * المواد ضيقة النطاق العلاجي تُرفع إلى «خطير» آلياً.
 * المرجع المنهجي: تصنيف FDA للإنزيمات + PharmGKB، والتنبؤ يُعلَّم دائماً
 * بمستوى أدلة «نظري/مرجّح» — لا يُقدَّم أبداً كموثق سريرياً.
 */

export type EnzymeRole = "substrate" | "inhibitor" | "inducer";

export const KNOWN_ENZYMES = ["CYP1A2", "CYP2C9", "CYP2C19", "CYP2D6", "CYP3A4", "P-gp"] as const;
export type EnzymeName = (typeof KNOWN_ENZYMES)[number];

export interface EnzymeProfile {
  generic: string;
  /** دور الدواء على كل إنزيم — الترتيب داخل المصفوفة لا يحمل معنى */
  roles: Partial<Record<EnzymeName, EnzymeRole[]>>;
}

/**
 * القاعدة المعرفية — أشهر 48 مادة فعالة في الصيدليات العربية/العالمية.
 * (مقتطفات مُحرَّرة من خريطة FDA CYP450 — للقرار المساند لا للاستقلال عنه)
 */
export const CYP450_PROFILES: EnzymeProfile[] = [
  // ── مضادات التجلط والألم ──
  { generic: "warfarin", roles: { CYP2C9: ["substrate"], CYP3A4: ["substrate"], "P-gp": ["substrate"] } },
  { generic: "clopidogrel", roles: { CYP2C19: ["substrate"] } }, // prodrug — التثبيط يُفشله
  { generic: "ticagrelor", roles: { CYP3A4: ["substrate"], "P-gp": ["inhibitor"] } },
  { generic: "apixaban", roles: { CYP3A4: ["substrate"], "P-gp": ["substrate"] } },
  { generic: "rivaroxaban", roles: { CYP3A4: ["substrate"], "P-gp": ["substrate"] } },
  { generic: "dabigatran", roles: { "P-gp": ["substrate"] } },
  { generic: "celecoxib", roles: { CYP2C9: ["substrate"] } },
  { generic: "diclofenac", roles: { CYP2C9: ["substrate"] } },
  { generic: "tramadol", roles: { CYP2D6: ["substrate"], CYP3A4: ["substrate"] } },
  { generic: "codeine", roles: { CYP2D6: ["substrate"] } }, // prodrug
  { generic: "morphine", roles: {} }, // جلوكورونيد مباشر — خارج الخريطة عمداً

  // ── القلب والضغط ──
  { generic: "amiodarone", roles: { CYP3A4: ["inhibitor"], CYP2C9: ["inhibitor"], "P-gp": ["inhibitor"] } },
  { generic: "diltiazem", roles: { CYP3A4: ["inhibitor"] } },
  { generic: "verapamil", roles: { CYP3A4: ["inhibitor"], "P-gp": ["inhibitor"] } },
  { generic: "amlodipine", roles: { CYP3A4: ["substrate"] } },
  { generic: "nifedipine", roles: { CYP3A4: ["substrate"] } },
  { generic: "digoxin", roles: { "P-gp": ["substrate"] } },
  { generic: "atorvastatin", roles: { CYP3A4: ["substrate"], "P-gp": ["substrate"] } },
  { generic: "simvastatin", roles: { CYP3A4: ["substrate"], "P-gp": ["substrate"] } },
  { generic: "rosuvastatin", roles: { CYP2C9: ["substrate"], "P-gp": ["substrate"] } },
  { generic: "carvedilol", roles: { CYP2D6: ["substrate"], CYP2C9: ["substrate"] } },
  { generic: "metoprolol", roles: { CYP2D6: ["substrate"] } },
  { generic: "losartan", roles: { CYP2C9: ["substrate"] } }, // prodrug → E-3174
  { generic: "irbesartan", roles: { CYP2C9: ["substrate"] } },

  // ── الجهاز الهضمي والفطريات ──
  { generic: "omeprazole", roles: { CYP2C19: ["substrate", "inhibitor"] } },
  { generic: "esomeprazole", roles: { CYP2C19: ["substrate", "inhibitor"] } },
  { generic: "pantoprazole", roles: { CYP2C19: ["substrate"] } },
  { generic: "fluconazole", roles: { CYP2C9: ["inhibitor"], CYP3A4: ["inhibitor"], CYP2C19: ["inhibitor"] } },
  { generic: "ketoconazole", roles: { CYP3A4: ["inhibitor"], "P-gp": ["inhibitor"] } },
  { generic: "itraconazole", roles: { CYP3A4: ["inhibitor"], "P-gp": ["inhibitor"] } },
  { generic: "voriconazole", roles: { CYP2C19: ["substrate", "inhibitor"], CYP3A4: ["inhibitor"] } },
  { generic: "clarithromycin", roles: { CYP3A4: ["inhibitor"], "P-gp": ["inhibitor"] } },
  { generic: "erythromycin", roles: { CYP3A4: ["inhibitor"], "P-gp": ["inhibitor"] } },
  { generic: "azithromycin", roles: {} }, // أقل تثبيطاً بكثير — لا ملف معنوي

  // ── الجهاز العصبي ──
  { generic: "carbamazepine", roles: { CYP3A4: ["substrate", "inducer"], CYP2C9: ["inducer"], CYP2C19: ["inducer"] } },
  { generic: "phenytoin", roles: { CYP2C9: ["substrate"], CYP2C19: ["substrate"], CYP3A4: ["inducer"] } },
  { generic: "valproate", roles: { CYP2C9: ["inhibitor"], CYP3A4: ["inhibitor"] } },
  { generic: "phenobarbital", roles: { CYP3A4: ["inducer"], CYP2C9: ["inducer"], CYP2C19: ["inducer"] } },
  { generic: "clobazam", roles: { CYP3A4: ["substrate"], CYP2C19: ["substrate"] } },
  { generic: "fluoxetine", roles: { CYP2D6: ["inhibitor"], CYP2C19: ["inhibitor"] } },
  { generic: "paroxetine", roles: { CYP2D6: ["inhibitor"] } },
  { generic: "sertraline", roles: { CYP2D6: ["inhibitor"], CYP2C19: ["inhibitor"] } },
  { generic: "citalopram", roles: { CYP2D6: ["substrate"] } },
  { generic: "escitalopram", roles: { CYP2D6: ["substrate"] } },
  { generic: "venlafaxine", roles: { CYP2D6: ["substrate"] } },
  { generic: "risperidone", roles: { CYP2D6: ["substrate"] } },
  { generic: "haloperidol", roles: { CYP2D6: ["substrate"], CYP3A4: ["substrate"] } },
  { generic: "aripiprazole", roles: { CYP2D6: ["substrate"], CYP3A4: ["substrate"] } },
  { generic: "donepezil", roles: { CYP2D6: ["substrate"], CYP3A4: ["substrate"] } },

  // ── التنفس والحساسية والسكري والغير ذلك ──
  { generic: "theophylline", roles: { CYP1A2: ["substrate"] } },
  { generic: "tizanidine", roles: { CYP1A2: ["substrate"] } },
  { generic: "montelukast", roles: { CYP2C9: ["substrate"] } },
  { generic: "fexofenadine", roles: { "P-gp": ["substrate"] } },
  { generic: "gliclazide", roles: { CYP2C9: ["substrate"] } },
  { generic: "glipizide", roles: { CYP2C9: ["substrate"] } },
  { generic: "tolbutamide", roles: { CYP2C9: ["substrate"] } },
  { generic: "metformin", roles: {} }, // لا تغيير أيضي — OCT فقط
  { generic: "tolterodine", roles: { CYP2D6: ["substrate"] } },
  { generic: "cyclosporine", roles: { CYP3A4: ["substrate"], "P-gp": ["substrate"] } },
  { generic: "tacrolimus", roles: { CYP3A4: ["substrate"], "P-gp": ["substrate"] } },
  { generic: "rifampicin", roles: { CYP3A4: ["inducer"], CYP2C9: ["inducer"], CYP2C19: ["inducer"], "P-gp": ["inducer"] } },
  { generic: "ciprofloxacin", roles: { CYP1A2: ["inhibitor"] } },
  { generic: "fluvoxamine", roles: { CYP1A2: ["inhibitor"], CYP2C19: ["inhibitor"], CYP3A4: ["inhibitor"] } },
];

/** مواد ضيقة النطاق العلاجي — التنبؤ عليها يُرفع إلى «خطير» */
export const NARROW_THERAPEUTIC_INDEX = new Set([
  "warfarin", "digoxin", "phenytoin", "carbamazepine", "lithium",
  "theophylline", "tacrolimus", "cyclosporine",
]);

function findProfile(generic: string): EnzymeProfile | undefined {
  const g = generic.trim().toLowerCase();
  return CYP450_PROFILES.find((p) => p.generic === g);
}

export interface MechanisticPrediction {
  /** الدواء المُغيَّر (الركيزة) */
  object: string;
  /** الدواء المسبّب (المثبط/المحفّز) */
  perpetrator: string;
  enzyme: EnzymeName;
  type: "inhibition" | "induction";
  severity: "major" | "moderate";
  /** وصف عربي للتنبؤ */
  description: string;
  /** مستوى الأدلة — التنبؤ الميكانيكي نظري/مرجّح دائماً */
  evidenceLevel: "theoretical" | "probable";
}

const ENZYME_AR: Record<EnzymeName, string> = {
  CYP1A2: "CYP1A2",
  CYP2C9: "CYP2C9",
  CYP2C19: "CYP2C19",
  CYP2D6: "CYP2D6",
  CYP3A4: "CYP3A4",
  "P-gp": "مضخة P-جليكوبروتين",
};

/**
 * يتنبأ بالتداخل الميكانيكي بين مادتين فعالتين من خريطة الإنزيمات.
 * لا يعيد شيئاً إن لم تتقاطع الأدوار (أو أحد الدواءين خارج القاعدة) —
 * والتنبؤ لا يُصدر إن كان الثنائي شائعاً بما يكفي ليكون منقحاً؟ لا:
 * طبقة المراجعة تُظهر المنقح أولاً وتعلّم التنبؤ بوضوح كطبقة مساندة.
 */
export function predictMechanistic(genericA: string, genericB: string): MechanisticPrediction[] {
  const a = findProfile(genericA);
  const b = findProfile(genericB);
  if (!a || !b || a.generic === b.generic) return [];

  const out: MechanisticPrediction[] = [];

  const addPrediction = (
    object: EnzymeProfile,
    perpetrator: EnzymeProfile,
    enzyme: EnzymeName,
    type: "inhibition" | "induction"
  ) => {
    const narrow = NARROW_THERAPEUTIC_INDEX.has(object.generic);
    // prodrugs: التثبيط يعطل التفعيل — وصف معكوس خاص
    const isProdrug = PRODRUG_SUBSTRATES.has(object.generic) && type === "inhibition";
    const dir = isProdrug
      ? "ينخفض تفعيلها الدوائي وقد يفشل العلاج"
      : type === "inhibition"
        ? "يرتفع تركيزها البلازمي وخطر السمّية"
        : "ينخفض تركيزها وقد يفشل العلاج";
    out.push({
      object: object.generic,
      perpetrator: perpetrator.generic,
      enzyme,
      type,
      severity: narrow ? "major" : "moderate",
      description: isProdrug
        ? `${ perpetrator.generic } يثبّط ${ENZYME_AR[enzyme]} وهو مسار تفعيل ${object.generic} ⇒ ${dir} (تنبؤ ميكانيكي).`
        : `${perpetrator.generic} ${type === "inhibition" ? "يثبّط" : "يحفّز"} ${ENZYME_AR[enzyme]} وهو المسار الأيضي لـ ${object.generic} ⇒ ${dir} (تنبؤ ميكانيكي).`,
      evidenceLevel: type === "induction" || narrow ? "probable" : "theoretical",
    });
  };

  // (أ ركيزة × ب مؤثر) ثم العكس
  for (const [obj, perp] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const [enzyme, roles] of Object.entries(obj.roles) as [EnzymeName, EnzymeRole[]][]) {
      if (!roles.includes("substrate")) continue;
      for (const [enzyme2, roles2] of Object.entries(perp.roles) as [EnzymeName, EnzymeRole[]][]) {
        if (enzyme2 !== enzyme) continue;
        if (roles2.includes("inhibitor")) addPrediction(obj, perp, enzyme, "inhibition");
        if (roles2.includes("inducer")) addPrediction(obj, perp, enzyme, "induction");
      }
    }
  }

  return out;
}

/** أدوية تُفعَّل أيضياً (prodrugs) — تثبيط إنزيمها يُفشل العلاج لا يسمّمه */
export const PRODRUG_SUBSTRATES = new Set(["clopidogrel", "codeine", "losartan", "tramadol"]);

/** مساعد آمن للاستخدام الخارجي — يرد ملف الدواء من الخريطة أو undefined */
export function findProfileSafe(generic: string): EnzymeProfile | undefined {
  return findProfile(generic);
}
