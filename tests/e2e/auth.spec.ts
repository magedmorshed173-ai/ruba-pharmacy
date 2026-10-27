import { expect, test } from "@playwright/test";
import { unlockSystem, hasE2ECreds } from "./helpers";

/**
 * مسار الدخول حتى لوحة التحكم — يتطلب قاعدة حية + مدير مبذور:
 * بيانات الاعتماد من E2E_ADMIN_USER / E2E_ADMIN_PASSWORD —
 * غيابهما (مثلاً معاينة محلية بلا قاعدة) يُتخطى الاختبار تلقائياً بدل أن يفشل.
 *
 * v4.6.1 — إصلاح جذري بعد أول تشغيل حقيقي في CI:
 * المحددات القديمة `input[type="text"]` كانت لا تطابق الحقل إطلاقاً
 * (CSS attribute selector يطابق الـ attribute لا الخصائص المحسوبة، والحقل
 * كان بلا type/name صريحين) — أُصلح الحقل في login-view.tsx (type + name)
 * والمحددات هنا عبر getByLabel المرتبط بـ <Label htmlFor> — أثبت وأصح.
 *
 * v4.7 — قفل النظام: كل اختبار يفتح القفل أولاً بمفتاح المدير
 * (E2E_ADMIN_PASSWORD) عبر helpers.unlockSystem — الكوكي يشارك الصفحات.
 */
const user = process.env.E2E_ADMIN_USER;
const password = process.env.E2E_ADMIN_PASSWORD;
const hasCreds = Boolean(user && password);

test.describe("مسار الدخول", () => {
  test("حقل مستخدم غير صحيح يعطي خطأ ولا يدخل", async ({ page }) => {
    test.skip(!hasCreds, "فتح القفل يتطلب E2E_ADMIN_PASSWORD (v4.7) — تخطٍّ مقصود");
    await unlockSystem(page);
    await page.goto("/");
    const userInput = page.getByLabel("اسم المستخدم");
    await userInput.waitFor({ timeout: 15_000 });
    await userInput.fill("no-such-user-e2e");
    await page.getByLabel("كلمة المرور").fill("wrong-password-123");
    await page.getByRole("button", { name: "دخول", exact: true }).click();
    // بقاء على شاشة الدخول (رسالة الخطأ toast أو نص) — حقل كلمة المرور ما زال مرئياً
    await expect(page.getByLabel("كلمة المرور")).toBeVisible({ timeout: 15_000 });
  });

  test("دخول المدير المبذور يصل لوحة التحكم ثم يخرج", async ({ page }) => {
    test.skip(!hasCreds, "E2E_ADMIN_USER/E2E_ADMIN_PASSWORD غير مضبوطة — تخطٍّ مقصود");
    await unlockSystem(page);
    await page.goto("/");
    await page.getByLabel("اسم المستخدم").fill(user!);
    await page.getByLabel("كلمة المرور").fill(password!);
    await page.getByRole("button", { name: "دخول", exact: true }).click();

    // خروج من نموذج الدخول: إما الوصول للتطبيق أو شاشة تفعيل 2FA للمدير
    // (سلوك v4.5: المدير بلا TOTP يوجَّه للتفعيل عند الدخول) — كلاهما يخفي حقل كلمة المرور
    await expect(page.getByLabel("كلمة المرور")).toHaveCount(0, { timeout: 20_000 });
    // واجهة التطبيق (POS/لوحة) أو توجيه التفعيل — كلها داخل غلاف المنصة المرسوم
    await expect(page.locator("body")).toContainText(/ربي فارمسي|سلة البيع|لوحة|التحقق بخطوتين/, {
      timeout: 20_000,
    });
  });
});
