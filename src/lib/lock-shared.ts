/**
 * v4.7 — قفل النظام بمفتاح المدير — ثوابت مشتركة
 *
 * ⚠️ هذا الملف يُستورد من src/middleware.ts الذي يعمل على Edge Runtime —
 * ممنوع منعاً باتاً استيراد db أو prisma أو bcrypt من هنا.
 * كل ما يمكن مشاركته بين الـ Edge والـ Node يوضع في هذا الملف فقط.
 */

/** اسم كوكي القفل — مستقل عن كوكي جلسة المستخدم (ruba_token) */
export const LOCK_COOKIE = "ruba_lock";

/** غرض التوكن داخل الحمولة — يمنع خلط توكن القفل بأي توكن آخر موقّع بنفس السر */
export const LOCK_PURPOSE = "system-lock";

/**
 * السر الاحتياطي للتطوير فقط — يجب أن يطابق حرفياً DEV_FALLBACK_SECRET
 * في src/lib/auth.ts حتى يوقّع الـ Edge والـ Node بنفس المفتاح محلياً.
 * الإنتاج fail-closed: AUTH_SECRET مطلوب (يرفض auth.ts التشغيل بدونه)،
 * والقفل هنا يتحقق من التوقيع فقط فلا يفتح أبداً بسرّ خاطئ.
 */
export const DEV_FALLBACK_SECRET =
  "ruba-pharmacy-dev-secret-2026-change-in-production-0d9488";

/**
 * إعدادات القفل القابلة للضبط عبر البيئة (تُقرأ وقت الطلب — لا وقت البناء):
 *  - SYSTEM_LOCK=off     ⇒ تعطيل البوابة كلياً (تطوير/اختبارات E2E فقط)
 *  - LOCK_EPOCH=<قيمة>   ⇒ تغييرها يسحب فوراً كل مفاتيح الفتح المصدرة سلفاً
 *                          على كل الأجهزة (رافعة الطوارئ للمدير) — الافتراضي "1"
 */
export function lockEnabled(): boolean {
  return (process.env.SYSTEM_LOCK ?? "on").trim().toLowerCase() !== "off";
}

export function lockEpoch(): string {
  return process.env.LOCK_EPOCH?.trim() || "1";
}

/**
 * المسارات المستثناة من القفل — لا تكشف شيئاً عن بيانات النظام:
 *  - /lock       شاشة القفل نفسها (وإلا حلقة توجيه لا نهائية)
 *  - /api/lock   واجهة التحقق من المفتاح
 *  - /download   صفحة التحميل العامة (روابط التوزيع فقط — بلا بيانات تشغيل)
 * ملاحظة: الملفات الثابتة (أيقونات/manifest/robots) مستثناة أصلاً في matcher.
 */
const PUBLIC_PATHS = ["/lock", "/api/lock", "/download"];

export function isLockPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}
