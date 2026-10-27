import { expect, test } from "@playwright/test";

/**
 * مسار الدخول حتى لوحة التحكم — يتطلب قاعدة حية + مدير مبذور:
 * بيانات الاعتماد من E2E_ADMIN_USER / E2E_ADMIN_PASSWORD —
 * غيابهما (مثلاً معاينة محلية بلا قاعدة) يُتخطى الاختبار تلقائياً بدل أن يفشل.
 */
const user = process.env.E2E_ADMIN_USER;
const password = process.env.E2E_ADMIN_PASSWORD;
const hasCreds = Boolean(user && password);

test.describe("مسار الدخول", () => {
  test("حقل مستخدم غير صحيح يعطي خطأ ولا يدخل", async ({ page }) => {
    await page.goto("/");
    // شاشة الدخول: اسم مستخدم + كلمة مرور
    const userInput = page.locator('input[type="text"], input[name="username"]').first();
    await userInput.waitFor({ timeout: 15_000 });
    await userInput.fill("no-such-user-e2e");
    await page.locator('input[type="password"]').first().fill("wrong-password-123");
    await page
      .locator('button[type="submit"], button:has-text("دخول"), button:has-text("تسجيل الدخول")')
      .first()
      .click();
    // بقاء على شاشة الدخول مع رسالة خطأ (toast أو نص)
    await expect(page.locator('input[type="password"]').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("دخول المدير المبذور يصل لوحة التحكم ثم يخرج", async ({ page }) => {
    test.skip(!hasCreds, "E2E_ADMIN_USER/E2E_ADMIN_PASSWORD غير مضبوطة — تخطٍّ مقصود");
    await page.goto("/");
    await page.locator('input[type="text"], input[name="username"]').first().fill(user!);
    await page.locator('input[type="password"]').first().fill(password!);
    await page
      .locator('button[type="submit"], button:has-text("دخول"), button:has-text("تسجيل الدخول")')
      .first()
      .click();

    // بعد الدخول: غياب حقل كلمة المرور (انتقلنا للوحة)
    await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 20_000 });
    // نافذة نقطة البيع أو اللوحة مرتسمة — التطبيق يبدأ من POS بعد الدخول
    await expect(page.locator("body")).toContainText(/ربي فارمسي|سلة البيع|لوحة/, {
      timeout: 20_000,
    });
  });
});
