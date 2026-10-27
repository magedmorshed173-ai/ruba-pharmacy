import type { Page } from "@playwright/test";

/**
 * v4.7 — أدوات مشتركة لاختبارات E2E
 */

/**
 * فتح قفل النظام (v4.7) من داخل سياق المتصفح:
 * page.request يشارك مخزن الكوكيز مع الصفحة — الكوكي ruba_lock يُحفظ
 * هنا فتَرى كل page.goto() اللاحقة النظام مفتوحاً.
 *
 * ملاحظة: تستهلك القاعدة (تقابل كلمة المرور بمدير E2E المبذور) —
 * في CI القاعدة موجودة دائماً؛ محلياً بلا قاعدة سيفشل النداء فتتعامل
 * معه specs بـ tryUnlockSystem.
 */
export async function unlockSystem(page: Page): Promise<void> {
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!password) throw new Error("E2E_ADMIN_PASSWORD غير مضبوطة — تعذر فتح القفل");
  const res = await page.request.post("/api/lock/verify", {
    data: { password },
  });
  if (!res.ok()) {
    throw new Error(`فشل فتح قفل النظام: HTTP ${res.status()}`);
  }
}

/** محاولة فتح صامتة — للاختبارات التي يجب أن تمر حتى بلا قاعدة (نمط smoke) */
export async function tryUnlockSystem(page: Page): Promise<void> {
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!password) return;
  try {
    await unlockSystem(page);
  } catch {
    /* بلا قاعدة يبقى النظام مقفلاً — الاختبار يتحقق مما يظهر فعلاً */
  }
}

/** هل بيانات مدير E2E متوفرة؟ (نمط skip المعمول به في auth.spec) */
export const hasE2ECreds = Boolean(
  process.env.E2E_ADMIN_USER && process.env.E2E_ADMIN_PASSWORD
);
