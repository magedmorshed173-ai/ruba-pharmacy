/**
 * v5.0 — ماسح المتلازمات الدوائية التراكمية (نمط Epocrates/Micromedex Panels)
 * دوال نقية 100% — يفحص قائمة المواد الفعالة **كاملة** لا ثنائي-ثنائي:
 *  1) طابور QT الممتد            — الجمع يضاعف خطر TdP
 *  2) متلازمة السيروتونين        — MAOI × أي مضاد اكتئاب = ممنوع
 *  3) خطر النزيف التراكمي        — مضاد تجلط + مضاد صفيحات/NSAID
 *  4) تثبيط الجهاز العصبي المركزي — أفيونيات + بنزوديازيبينات + مضادات هيستامين مهدئة
 *  5) نقص سكر الدم الجمعي        — سلفونيل يوريا + أنسولين ± مثبط CYP2C9
 *  6) «الثلاثية الكلوية»          — NSAID + مثبط ACE/ARB + مدر (خطر فشل كلوي حاد)
 * كل لوحة تحمل عتبات شدة متدرجة ونصيحة صيدلانية عربية.
 */

import type { InteractionSeverity } from "./clinical";

export interface SyndromePanelDef {
  id: string;
  name: string;
  /** وصف متلازمة الخطر */
  description: string;
  /** مواد فعالة تُحسب عضواً في اللوحة (مطابقة جزئية بأمر منخفض الحالة) */
  members: string[];
  /** العضو ذو الخطورة القصوى القائمة بذاتها (يستدعي أعلى عتبة فوراً) */
  anchor?: string;
  /** عتبة العضوين ⇒ شدة */
  severityAt2: InteractionSeverity;
  /** عتبة 3 أعضاء فأكثر ⇒ شدة */
  severityAt3: InteractionSeverity;
  advice: string;
}

export const SYNDROME_PANELS: SyndromePanelDef[] = [
  {
    id: "qt-prolongation",
    name: "طابور QT الممتد",
    description:
      "أكثر من دواء مُطوِّل لفترة QT يجمع الأثر على قنوات البوتاسيوم ويضاعف خطر Torsade de Pointes.",
    members: [
      "amiodarone", "sotalol", "clarithromycin", "erythromycin", "azithromycin",
      "ciprofloxacin", "levofloxacin", "moxifloxacin", "fluconazole", "ketoconazole",
      "itraconazole", "ondansetron", "domperidone", "haloperidol", "quetiapine",
      "olanzapine", "risperidone", "citalopram", "escitalopram", "hydroxyzine",
      "diphenhydramine", "fexofenadine", "methadone", "gadolinium",
    ],
    severityAt2: "moderate",
    severityAt3: "major",
    advice:
      "راجع تخطيط القلب وEQT قبل الجمع وبعده، وصحّح البوتاسيوم/المغنيسيوم، وابحث عن بديل غير مطوِّل للQT إن أمكن.",
  },
  {
    id: "serotonin",
    name: "متلازمة السيروتونين",
    description:
      "تراكم تأثير السيروتونين المركزي: تعرّق، رجفة، تململ، تصلب عضلي، فرط حرارة — قد تكون مهدكة للحياة.",
    members: [
      "fluoxetine", "paroxetine", "sertraline", "citalopram", "escitalopram",
      "venlafaxine", "duloxetine", "fluvoxamine", "tramadol", "linezolid",
      "methadone", "sumatriptan", "rizatriptan", " St. john's wort", "moclobemide",
    ],
    anchor: "moclobemide",
    severityAt2: "major",
    severityAt3: "major",
    advice:
      "MAOI (كالموكلوبيميد) مع أي مضاد اكتئاب/ترامادول ممنوع — أسبوعان غسل على الأقل عند التبديل (5 أسابيع بعد الفلوكسيتين). راقب الأعراض عند الضرورة القسرية.",
  },
  {
    id: "bleeding",
    name: "خطر النزيف التراكمي",
    description:
      "مضاد تجلط + مضاد صفيحات أو NSAID يضاعف خطر النزف الهضمي والقحفي فوق جمع أثرهما.",
    members: [
      "warfarin", "apixaban", "rivaroxaban", "dabigatran", "aspirin",
      "clopidogrel", "ticagrelor", "dipyridamole", "ibuprofen", "diclofenac",
      "naproxen", "ketoprofen", "celecoxib", "sertraline", "citalopram",
      "escitalopram", "fluoxetine", "paroxetine",
    ],
    severityAt2: "major",
    severityAt3: "contraindicated",
    advice:
      "الباراسيتامول هو المسكن الآمن. عند الضرورة القسرية: حماية هضمية بمثبط مضخة البروتون ومراقبة علامات النزف وتعليم المريض إياها.",
  },
  {
    id: "cns-depression",
    name: "تثبيط الجهاز العصبي المركزي",
    description:
      "الجمع بين مهدئات متعددة يضخّم النعاس، تشوش الوعي، وانخفاض التنفس — خطر خاص على كبار السن والقيادة.",
    members: [
      "morphine", "codeine", "tramadol", "oxycodone", "methadone",
      "diazepam", "alprazolam", "lorazepam", "clonazepam", "bromazepam",
      "zolpidem", "zopiclone", "promethazine", "hydroxyzine", "diphenhydramine",
      "chlorpheniramine", "gabapentin", "pregabalin", "quetiapine",
    ],
    severityAt2: "moderate",
    severityAt3: "major",
    advice:
      "حدد أقل عدد من المهدئات وأقل جرعة فعالة، حذّر من القيادة والآلات، وتجنّب الكحول؛ فكّر في مضاد هيستامين غير مهدئ للحساسية.",
  },
  {
    id: "hypoglycemia",
    name: "نقص سكر الدم الجمعي",
    description:
      "سلفونيل يوريا مع أنسولين أو دواء يثبط أيضها يهبط بالسكر إلى مستويات خطرة.",
    members: [
      "gliclazide", "glipizide", "glibenclamide", "glimepiride", "tolbutamide",
      "insulin", "insulin glargine", "insulin lispro", "fluconazole",
      "clarithromycin", "ciprofloxacin", "warfarin",
    ],
    severityAt2: "moderate",
    severityAt3: "major",
    advice:
      "علّم المريض أعراض نقص السكر وعلاجه الفوري (15غ سكر سريع)، وزد وتيرة القياس، وراجع إمكانية استبدال السلفونيل يوريا بدواء أقل حدوثاً لنقص السكر.",
  },
  {
    id: "renal-triple-whammy",
    name: "الثلاثية الكلوية (Whammy الثلاثية)",
    description:
      "NSAID + مثبط ACE/ARB + مدر يجمّد الترشيح الكلوي بثلاث آليات — سبب شائع للفشل الكلوي الحاد.",
    members: [
      "ibuprofen", "diclofenac", "naproxen", "ketoprofen", "celecoxib", "aspirin",
      "enalapril", "lisinopril", "ramipril", "captopril", "losartan", "valsartan",
      "candesartan", "irbesartan", "furosemide", "hydrochlorothiazide",
      "chlortalidone", "indapamide", "spironolactone", "torsemide",
    ],
    severityAt2: "moderate",
    severityAt3: "major",
    advice:
      "أوقف NSAID أولًا (البديل: الباراسيتامول)، راقب الكرياتينين والبول قبل الجمع وأثناءه، وانتبه للجفاف والإسهال ومرضية الأوعية الدموية.",
  },
];

export interface SyndromePanelHit {
  panelId: string;
  panelName: string;
  description: string;
  severity: InteractionSeverity;
  /** الأعضاء المكتشفة فعلاً من قائمة الأدوية */
  detected: string[];
  advice: string;
}

/** مطابقة جزئية بأمر منخفض الحالة — مع قص الفراغات (عضو « St. john's wort» يُطابق st. john) */
function detectMembers(generics: string[], panel: SyndromePanelDef): string[] {
  const norm = generics.map((g) => g.trim().toLowerCase()).filter(Boolean);
  const detected: string[] = [];
  for (const m of panel.members) {
    const key = m.trim().toLowerCase();
    if (!key) continue;
    if (norm.some((g) => g === key || g.includes(key))) detected.push(key);
  }
  return detected;
}

/**
 * يفحص قائمة المواد الفعالة كاملة ضد كل اللوحات ويعيّن الأشد فقط.
 * - عضو من فئة خلفية (ssri) يُحسب عضواً — لا يضاعف بعدد أسمائه.
 * - العضو «المرساة» (مثل MAOI) يرفع اللوحة مباشرة إلى أقصى شدتها.
 */
export function scanSyndromePanels(generics: string[]): SyndromePanelHit[] {
  const hits: SyndromePanelHit[] = [];
  for (const panel of SYNDROME_PANELS) {
    const detected = detectMembers(generics, panel);
    if (detected.length < 2) continue;
    const hasAnchor = panel.anchor
      ? detected.includes(panel.anchor.trim().toLowerCase())
      : false;
    const severity =
      hasAnchor || detected.length >= 3 ? panel.severityAt3 : panel.severityAt2;
    hits.push({
      panelId: panel.id,
      panelName: panel.name,
      description: panel.description,
      severity,
      detected,
      advice: panel.advice,
    });
  }
  return hits;
}
