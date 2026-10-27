/**
 * الطبقة الوطنية المرخصة — ربي فارمسي v4.1 (فجوة #1)
 * دوال نقية 100% (بلا قاعدة بيانات) لسجل التراخيص الرسمي بنمط SFDA:
 *  1) رقم ترخيص الهيئة لكل منتج (registrationNo) + حالة الترخيص
 *  2) السعر الرسمي المعتمد (officialPrice) — مرجع التسعير الوطني
 *  3) حجب تلقائي للمسحوب/المعلق من السوق — من المصدر إلى الصرف بلا تدخل
 *
 * القاعدة الذهبية (تصعيد بلا رجوع):
 *  - السحب/تعليق الترخيص الوطني يرفع الحجب تلقائياً — حتى لو كانت الحالة
 *    المحلية «مسجل». (نمط رانيتيدين 2020: سحب عالمي فوري بسبب شوائب NDMA).
 *  - العكس لا يحدث آلياً أبداً: ترخيص وطني مرخص لا يرفع حجباً محلياً
 *    (معلق/محظور) — الرفع قرار يدوي موثق بإجراء تنظيمي (reinstatement).
 */

import {
  parseRegistryStatus,
  type RegistryAlert,
  type RegistryStatus,
} from "@/lib/registry";

// ─── أنواع الترخيص الوطني ───────────────────────────────────────────

export type LicenseStatus = "licensed" | "suspended" | "withdrawn" | "pending";

export const LICENSE_STATUS_LABEL: Record<LicenseStatus, string> = {
  licensed: "مرخص رسمياً",
  suspended: "الترخيص معلق",
  withdrawn: "مسحوب من السوق",
  pending: "قيد التقييم",
};

/** حالات الترخيص التي تحجب الصرف حجباً تلقائياً مطلقاً (بلا تجاوز) */
export const LICENSE_HARD_BLOCK: LicenseStatus[] = ["suspended", "withdrawn"];

/** يحلّ نص الترخيص القادم من المصدر إلى الحالة الآمنة (افتراضي: قيد التقييم — إنذار بلا حجب زائف) */
export function parseLicenseStatus(s: string): LicenseStatus {
  return (["licensed", "suspended", "withdrawn", "pending"] as const).includes(
    s as LicenseStatus
  )
    ? (s as LicenseStatus)
    : "pending";
}

/** حجب تلقائي لترخيص مسحوب/معلق؟ */
export function isLicenseHardBlock(status: string): boolean {
  return LICENSE_HARD_BLOCK.includes(parseLicenseStatus(status));
}

// ─── مطابقة المنتج المحلي بسجله المرخص ──────────────────────────────

export interface NationalEntryInput {
  id: string;
  registrationNo: string;
  tradeName: string;
  genericName: string;
  dosage?: string | null;
  manufacturer?: string | null;
  barcode?: string | null;
  licenseStatus: string;
  officialPrice?: number | null; // هللات
  withdrawalReason?: string | null; // سبب السحب (رسالة إنذار المسحوب)
}

export interface LicensedMedInput {
  id: string;
  name: string;
  dosage?: string | null;
  barcode?: string | null;
  registrationNo?: string | null;
  registryStatus?: string | null;
  nationalDrugId?: string | null;
  sellingPrice?: number | null;
  maxRetailPrice?: number | null; // سقف السعر الرسمي — هللات
}

export type MatchMethod =
  | "link" // ربط مخزن من مزامنة سابقة
  | "registration_no" // رقم الترخيص الرسمي
  | "barcode" // باركود GTIN
  | "name_dosage" // الاسم التجاري الطبيعي + التركيز
  | null;

/**
 * تطبيع عربي/لاتيني للمطابقة: بلا تشكيل ولا همزات متباينة ولا مسافات —
 * «أسِتامينوفين» = «استامينوفين» = «ASTAMINOFIN» على مفتاح واحد.
 */
export function normalizeArabicName(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "") // التشكيل
    .replace(/\u0640/g, "") // التطويل
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)) // أرقام عربية-هندية ٥٠٠ → 500
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0)) // أرقام فارسية ممتدة
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}]/gu, ""); // مسافات وعلامات ورموز
}

/** تطبيع التركيز للمطابقة: «500 ملغ» = «500mg» = «500 mg» */
export function normalizeDosage(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/مليغرام|ملغ|mg/g, "mg")
    .replace(/ميكروغرام|ميكروغرام|mcg|µg|μg/g, "mcg")
    .replace(/غرام/g, "g")
    .replace(/مليلتر|ملت|ml/g, "ml");
}

export interface NationalMatch {
  entry: NationalEntryInput;
  method: Exclude<MatchMethod, null>;
}

/**
 * يحلّ السجل المرخص المطابق لمنتج محلي — بأولوية صارمة:
 *  1) الربط المخزن (link) — نتيجة مزامنة سابقة
 *  2) رقم الترخيص الرسمي (registration_no) — المطابقة القانونية الدقيقة
 *  3) باركود GTIN (barcode) — مطابقة المعبأة الفريدة
 *  4) الاسم التجاري الطبيعي + التركيز (name_dosage) — احتياطي بشرط عدم الغموض:
 *     إن طابق الاسم أكثر من ترخيص → لا مطابقة بالاسم (الحسم للباركود/الرقم).
 */
export function resolveNationalMatch(
  med: LicensedMedInput,
  entries: NationalEntryInput[]
): NationalMatch | null {
  // 1) الربط المخزن
  const linked = med.nationalDrugId
    ? entries.find((e) => e.id === med.nationalDrugId)
    : undefined;
  if (linked) return { entry: linked, method: "link" };

  // 2) رقم الترخيص الرسمي
  const regNo = String(med.registrationNo ?? "").trim();
  if (regNo) {
    const byReg = entries.find((e) => e.registrationNo === regNo);
    if (byReg) return { entry: byReg, method: "registration_no" };
  }

  // 3) باركود GTIN
  const barcode = String(med.barcode ?? "").trim();
  if (barcode) {
    const byBarcode = entries.find((e) => e.barcode === barcode);
    if (byBarcode) return { entry: byBarcode, method: "barcode" };
  }

  // 4) الاسم الطبيعي + التركيز — بلا غموض
  const key = normalizeArabicName(med.name);
  if (key) {
    const candidates = entries.filter(
      (e) => normalizeArabicName(e.tradeName) === key
    );
    if (candidates.length === 1) {
      const dMed = normalizeDosage(med.dosage ?? "");
      const dNat = normalizeDosage(candidates[0].dosage ?? "");
      if (!dMed || !dNat || dMed === dNat) {
        return { entry: candidates[0], method: "name_dosage" };
      }
    }
  }
  return null;
}

// ─── قاعدة التصعيد (بلا رجوع) ───────────────────────────────────────

/**
 * حالة التسجيل الفعلية بعد دمج المصدرين:
 *  - سحب/تعليق وطني → «suspended» تلقائياً مهما كانت الحالة المحلية (حجب فوري)
 *  - غير ذلك → الحالة المحلية كما هي (لا رجوع آلي — الرفع بقرار يدوي موثق)
 */
export function effectiveRegistryStatus(
  localStatus: string,
  licenseStatus: string
): RegistryStatus {
  const local = parseRegistryStatus(localStatus);
  if (isLicenseHardBlock(licenseStatus)) return "suspended";
  return local;
}

// ─── تنبيهات الطبقة المرخصة (متوافقة مع RegistryAlert) ──────────────

/**
 * يبني تنبيهات الترخيص الوطني لقائمة أدوية مقابل السجل المرخص:
 *  - withdrawn / suspended → hard_block (حجب تلقائي بلا تجاوز)
 *  - unlisted (غير مدرج) / pending / mismatch → warning (إنذار بلا حجب)
 *  - تجاوز السعر الرسمي المعتمد → price_cap warning بالفرق المضبوط
 */
export function buildLicenseAlerts(
  meds: LicensedMedInput[],
  entries: NationalEntryInput[]
): RegistryAlert[] {
  const alerts: RegistryAlert[] = [];
  for (const med of meds) {
    const match = resolveNationalMatch(med, entries);
    const local = parseRegistryStatus(med.registryStatus ?? "registered");

    if (!match) {
      alerts.push({
        medicineId: med.id,
        medicine: med.name,
        kind: "unlisted",
        severity: "warning",
        status: local,
        message: `«${med.name}» غير مدرج في السجل الوطني المرخص — تحقق من الترخيص ومصدر التوريد`,
        blocking: false,
      });
      continue; // لا فحص سعر رسمي بلا سجل مرجعي
    }

    const { entry, method } = match;
    const lic = parseLicenseStatus(entry.licenseStatus);

    if (lic === "withdrawn") {
      alerts.push({
        medicineId: med.id,
        medicine: med.name,
        kind: "withdrawn",
        severity: "hard_block",
        status: "suspended",
        message: `«${med.name}» مسحوب من السوق بقرار الهيئة (ترخيص ${entry.registrationNo}${entry.withdrawalReason ? ` — ${entry.withdrawalReason}` : ""}) — حجب تلقائي ولا يُصرف`,
        blocking: true,
      });
    } else if (lic === "suspended") {
      alerts.push({
        medicineId: med.id,
        medicine: med.name,
        kind: "license_suspended",
        severity: "hard_block",
        status: "suspended",
        message: `ترخيص «${med.name}» معلق لدى الهيئة (ترخيص ${entry.registrationNo}) — الحجب تلقائي حتى رفع التعليق`,
        blocking: true,
      });
    } else if (lic === "pending") {
      alerts.push({
        medicineId: med.id,
        medicine: med.name,
        kind: "license_pending",
        severity: "warning",
        status: local,
        message: `ترخيص «${med.name}» (${entry.registrationNo}) قيد التقييم لدى الهيئة — راجع وضع المنتج`,
        blocking: false,
      });
    } else if (local === "suspended" || local === "banned") {
      // مرخص وطنياً لكن الحالة المحلية محجوبة — لا رجوع آلي، إنذار مراجعة
      alerts.push({
        medicineId: med.id,
        medicine: med.name,
        kind: "license_mismatch",
        severity: "warning",
        status: local,
        message: `الحالة المحلية لـ«${med.name}» (${local === "banned" ? "محظور" : "معلق"}) لا تطابق الترخيص الوطني المرخص — راجع قرار الرفع يدوياً`,
        blocking: false,
      });
    }

    // رقم الترخيص المحلي يخالف السجل الرسمي (حُسمت المطابقة بوسيلة أخرى)
    const medReg = String(med.registrationNo ?? "").trim();
    if (
      method !== "registration_no" &&
      medReg &&
      medReg !== entry.registrationNo
    ) {
      alerts.push({
        medicineId: med.id,
        medicine: med.name,
        kind: "license_mismatch",
        severity: "warning",
        status: local,
        message: `رقم الترخيص المحلي لـ«${med.name}» (${medReg}) يخالف السجل الرسمي (${entry.registrationNo}) — ستُموّأ بالمزامنة`,
        blocking: false,
      });
    }

    // السعر الرسمي المعتمد — مرجع التسعير الوطني
    if (
      typeof entry.officialPrice === "number" &&
      entry.officialPrice > 0 &&
      typeof med.sellingPrice === "number" &&
      med.sellingPrice > entry.officialPrice
    ) {
      const delta = med.sellingPrice - entry.officialPrice;
      alerts.push({
        medicineId: med.id,
        medicine: med.name,
        kind: "price_cap",
        severity: "warning",
        status: local,
        message: `سعر بيع «${med.name}» (${med.sellingPrice} هللة) يتجاوز السعر الرسمي المعتمد (${entry.officialPrice} هللة) بفارق ${delta} هللة — راجع التسعير`,
        blocking: false,
      });
    }
  }
  return alerts;
}

/** هل من حجب تلقائي (سحب/تعليق ترخيص) في القائمة؟ */
export function hasLicenseBlock(alerts: RegistryAlert[]): boolean {
  return alerts.some((a) => a.blocking);
}

// ─── خطة المزامنة — من الهيئة إلى المخزون ───────────────────────────

export interface SyncPlanActions {
  /** ربط المنتج المحلي بسجله المرخص */
  linkNationalDrug?: string;
  /** مواءمة رقم الترخيص المحلي مع الرقم الرسمي */
  setRegistrationNo?: string;
  /** مواءمة سقف البيع مع السعر الرسمي (لا يُخفض سقفاً أشد قائمة) */
  setMaxRetailPrice?: number;
  /** حجب تلقائي: رفع الحالة المحلية إلى «suspended» (المسحوب/المعلق) */
  escalateToSuspended?: boolean;
  /** مرخص وطنياً لكن محجوب محلياً — رفع الحجب قرار يدوي موثق */
  needsManualReview?: boolean;
}

export interface SyncPlanItem {
  medicineId: string;
  name: string;
  matched: boolean;
  method: MatchMethod;
  entryId?: string;
  registrationNo?: string;
  licenseStatus?: LicenseStatus;
  localStatus: RegistryStatus;
  effectiveStatus: RegistryStatus;
  actions: SyncPlanActions;
  alerts: RegistryAlert[];
}

/**
 * يحسب خطة المزامنة الكاملة (نقية — بلا تنفيذ):
 * لكل دواء محلي: المطابقة، حالة الترخيص، الحالة الفعلية، الإجراءات المطلوبة.
 * قواعد الأمان:
 *  - التصعيد فقط آلياً (suspended عند السحب/التعليق) — لا خفض آلياً أبداً.
 *  - سقف البيع لا يُخفض تحت سقف محلي أشد (الأشد يبقى).
 *  - غير المطابق يخرج بخطة فارغة + إنذار unlisted (بلا تغيير بيانات).
 */
export function computeSyncPlan(
  meds: LicensedMedInput[],
  entries: NationalEntryInput[]
): SyncPlanItem[] {
  const plan: SyncPlanItem[] = [];
  for (const med of meds) {
    const local = parseRegistryStatus(med.registryStatus ?? "registered");
    const match = resolveNationalMatch(med, entries);

    if (!match) {
      plan.push({
        medicineId: med.id,
        name: med.name,
        matched: false,
        method: null,
        localStatus: local,
        effectiveStatus: local,
        actions: {},
        alerts: buildLicenseAlerts([med], entries),
      });
      continue;
    }

    const { entry, method } = match;
    const lic = parseLicenseStatus(entry.licenseStatus);
    const effective = effectiveRegistryStatus(local, entry.licenseStatus);
    const actions: SyncPlanActions = {};

    // الربط
    if (med.nationalDrugId !== entry.id) actions.linkNationalDrug = entry.id;

    // مواءمة رقم الترخيص مع الرقم الرسمي (عند المطابقة بوسيلة غير الرقم)
    const medReg = String(med.registrationNo ?? "").trim();
    if (method !== "registration_no" && medReg !== entry.registrationNo) {
      actions.setRegistrationNo = entry.registrationNo;
    }

    // التسعير الرسمي: يُعتمد ما لم يكن هناك سقف محلي أشد
    if (
      typeof entry.officialPrice === "number" &&
      entry.officialPrice > 0 &&
      (typeof med.maxRetailPrice !== "number" ||
        med.maxRetailPrice <= 0 ||
        med.maxRetailPrice > entry.officialPrice)
    ) {
      actions.setMaxRetailPrice = entry.officialPrice;
    }

    // الحجب التلقائي — تصعيد فقط
    if (
      isLicenseHardBlock(lic) &&
      local !== "suspended" &&
      local !== "banned"
    ) {
      actions.escalateToSuspended = true;
    }

    // مرخص وطنياً لكن محجوب محلياً — لا رجوع آلي
    if (lic === "licensed" && (local === "suspended" || local === "banned")) {
      actions.needsManualReview = true;
    }

    plan.push({
      medicineId: med.id,
      name: med.name,
      matched: true,
      method,
      entryId: entry.id,
      registrationNo: entry.registrationNo,
      licenseStatus: lic,
      localStatus: local,
      effectiveStatus: effective,
      actions,
      alerts: buildLicenseAlerts([med], entries),
    });
  }
  return plan;
}

/** ملخص خطة المزامنة — للواجهة والاستجابة */
export function summarizeSyncPlan(plan: SyncPlanItem[]): {
  total: number;
  matched: number;
  unlisted: number;
  autoBlocked: number;
  priceAligned: number;
  linked: number;
  manualReview: number;
  blockingAlerts: number;
} {
  let matched = 0,
    unlisted = 0,
    autoBlocked = 0,
    priceAligned = 0,
    linked = 0,
    manualReview = 0,
    blockingAlerts = 0;
  for (const item of plan) {
    if (item.matched) matched++;
    else unlisted++;
    if (item.actions.escalateToSuspended) autoBlocked++;
    if (item.actions.setMaxRetailPrice !== undefined) priceAligned++;
    if (item.actions.linkNationalDrug) linked++;
    if (item.actions.needsManualReview) manualReview++;
    blockingAlerts += item.alerts.filter((a) => a.blocking).length;
  }
  return {
    total: plan.length,
    matched,
    unlisted,
    autoBlocked,
    priceAligned,
    linked,
    manualReview,
    blockingAlerts,
  };
}
