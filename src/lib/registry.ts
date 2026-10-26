/**
 * الطبقة التنظيمية الوطنية — ربي فارمسي v3.7
 * دوال نقية 100% (بلا قاعدة بيانات) لفحص السجل الوطني للدواء:
 *  1) حالة التسجيل التنظيمي (مسجل/معلق/محظور/غير مسجل)
 *  2) سقف السعر البيعي الوطني
 *
 * الفلسفة التنظيمية (الفرق الجوهري عن الطبقة السريرية):
 *  - القرار السريري (تداخل/حساسية) يقابله «تجاوز صيدلي مسؤول» — لأن الصيدلي
 *    يملك التقدير المهني الموثق.
 *  - القرار التنظيمي (تعليق/حظر وطني) لا يقبل التجاوز — إذ هو أمر قانوني
 *    من الجهة المختصة يوقف التداول بكامله، ولا يملك الصيدلي سلطة نقضه.
 *    (نمط SFDA/FDA/EMA: تعليق رانيتيدين 2020 بسبب شوائب NDMA أوقف
 *    التداول العالمي كاملاً بلا استثناء صيدليات).
 */

export type RegistryStatus =
  | "registered"
  | "suspended"
  | "banned"
  | "unregistered";

export const REGISTRY_STATUS_LABEL: Record<RegistryStatus, string> = {
  registered: "مسجل وطنياً",
  suspended: "معلق تنظيمياً",
  banned: "محظور",
  unregistered: "غير مسجل",
};

/** الحالات التي تحجب الصرف حجماً تنظيمياً مطلقاً (بلا تجاوز) */
export const REGISTRY_HARD_BLOCK: RegistryStatus[] = ["suspended", "banned"];

/** يحلّ النص القادم من قاعدة البيانات إلى الحالة الآمنة (افتراضي: مسجل) */
export function parseRegistryStatus(s: string): RegistryStatus {
  return (["registered", "suspended", "banned", "unregistered"] as const).includes(
    s as RegistryStatus
  )
    ? (s as RegistryStatus)
    : "registered";
}

/** حجب تنظيمي مطلق؟ (تعليق أو حظر — لا يقبل تجاوزاً) */
export function isRegistryHardBlock(status: string): boolean {
  return REGISTRY_HARD_BLOCK.includes(parseRegistryStatus(status));
}

/** المادة الفعالة مرتبطة برقم تسجيل وطني؟ */
export function hasRegistration(med: { registrationNo?: string | null }): boolean {
  return Boolean(med.registrationNo && String(med.registrationNo).trim());
}

export interface RegistryMedInput {
  id?: string;
  name: string;
  registryStatus?: string;
  registrationNo?: string | null;
  sellingPrice: number; // هللات
  maxRetailPrice?: number | null; // هللات
}

export interface RegistryAlert {
  medicineId?: string;
  medicine: string;
  kind:
    | "suspended"
    | "banned"
    | "unregistered"
    | "price_cap"
    // v4.1 — الطبقة الوطنية المرخصة (ترخيص SFDA)
    | "withdrawn" // مسحوب من السوق بقرار الهيئة — حجب تلقائي
    | "license_suspended" // ترخيص معلق — حجب تلقائي
    | "unlisted" // غير مدرج في السجل المرخص — إنذار
    | "license_pending" // ترخيص قيد التقييم — إنذار
    | "license_mismatch"; // تعارض الحالة المحلية مع السجل — إنذار مراجعة
  severity: "hard_block" | "warning";
  status: RegistryStatus;
  message: string;
  /** هل يمنع هذا التنبيه إتمام الصرف؟ (تنظيمياً — بلا تجاوز) */
  blocking: boolean;
}

/**
 * يبني تنبيهات السجل الوطني لقائمة أدوية (سلة بيع/وصفة).
 * - suspended/banned → hard_block (يحجب الصرف بلا تجاوز)
 * - unregistered → warning (يُعرض للصيدلي، لا يحجب — الدواء قد يكون
 *   مستورداً لمسؤولية شخصية أو مكملاً خارج نطاق التسجيل)
 * - تجاوز سقف السعر → warning تسعيري (المخزون القائم يُ grandfathered،
 *   لكن الصيدلي يُنبَّه — نمط ضبط الأسعار الوطني)
 */
export function buildRegistryAlerts(meds: RegistryMedInput[]): RegistryAlert[] {
  const alerts: RegistryAlert[] = [];
  for (const med of meds) {
    const status = parseRegistryStatus(med.registryStatus ?? "registered");
    if (status === "suspended") {
      alerts.push({
        medicineId: med.id,
        medicine: med.name,
        kind: "suspended",
        severity: "hard_block",
        status,
        message: `«${med.name}» معلق تنظيمياً من السجل الوطني — لا يُصرف حتى رفع القرار (تحقق من إشعار الجهة المختصة)`,
        blocking: true,
      });
    } else if (status === "banned") {
      alerts.push({
        medicineId: med.id,
        medicine: med.name,
        kind: "banned",
        severity: "hard_block",
        status,
        message: `«${med.name}» محظور من التداول بقرار تنظيمي — صرفه مخالف للقانون`,
        blocking: true,
      });
    } else if (status === "unregistered") {
      alerts.push({
        medicineId: med.id,
        medicine: med.name,
        kind: "unregistered",
        severity: "warning",
        status,
        message: `«${med.name}» غير مسجل في السجل الوطني — تأكد من مصدر الاستيراد والمسؤولية`,
        blocking: false,
      });
    }
    if (
      typeof med.maxRetailPrice === "number" &&
      med.maxRetailPrice > 0 &&
      med.sellingPrice > med.maxRetailPrice
    ) {
      alerts.push({
        medicineId: med.id,
        medicine: med.name,
        kind: "price_cap",
        severity: "warning",
        status,
        message: `سعر بيع «${med.name}» (${med.sellingPrice} هللة) يتجاوز السقف الوطني (${med.maxRetailPrice} هللة) — راجع التسعير`,
        blocking: false,
      });
    }
  }
  return alerts;
}

/** هل من تنبيه حاجب تنظيمياً في القائمة؟ */
export function hasRegistryBlock(alerts: RegistryAlert[]): boolean {
  return alerts.some((a) => a.blocking);
}
