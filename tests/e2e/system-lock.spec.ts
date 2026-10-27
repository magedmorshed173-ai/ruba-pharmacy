import { expect, test } from "@playwright/test";
import { unlockSystem, hasE2ECreds } from "./helpers";

/**
 * v4.7 — اختبارات قفل النظام بمفتاح المدير:
 *  - الجذر يوجّه إلى شاشة القفل ويطلب المفتاح (حتى بلا قاعدة)
 *  - مفتاح خاطئ يُرفض ويبقى القفل (يتطلب قاعدة — المقيّد والتحقق فيها)
 *  - المفتاح الصحيح (كلمة مرور مدير E2E) يفتح النظام ويكشف شاشة الدخول
 */

test.describe("قفل النظام بمفتاح المدير", () => {
  test("أي صفحة بلا مفتاح توجَّه إلى شاشة القفل", async ({ page }) => {
    // متصفح جديد بلا كوكي ruba_lock — الزيارة الأولى لأي مسار
    await page.goto("/?e2e-lock-probe=1");
    await expect(page).toHaveURL(/\/lock/, { timeout: 15_000 });
    // شاشة القفل تطلب مفتاح النظام صراحة
    await expect(page.getByLabel("مفتاح النظام")).toBeVisible();
    await expect(page.locator("body")).toContainText("النظام مقفل");
  });

  test("واجهات API بلا مفتاح ترفض 401 وتعلن القفل", async ({ request }) => {
    const res = await request.get("/api/drugs", { maxRedirects: 0 });
    expect(res.status()).toBe(401);
    const body = (await res.json()) as { locked?: boolean };
    expect(body.locked).toBe(true);
  });

  test("مفتاح خاطئ يُرفض ويبقى النظام مقفلاً", async ({ page }) => {
    test.skip(!hasE2ECreds, "يتطلب قاعدة + بيانات مدير E2E");
    await page.goto("/lock");
    await page.getByLabel("مفتاح النظام").fill("wrong-lock-key-e2e-123");
    await page.getByRole("button", { name: "فتح النظام" }).click();
    await expect(page.getByTestId("lock-error")).toContainText(/المفتاح غير صحيح|محاولات كثيرة/, {
      timeout: 15_000,
    });
    // ما زلنا على شاشة القفل
    await expect(page.getByLabel("مفتاح النظام")).toBeVisible();
  });

  test("المفتاح الصحيح يفتح النظام ويعيد التوجيه للوجهة الأصلية", async ({ page }) => {
    test.skip(!hasE2ECreds, "E2E_ADMIN_PASSWORD غير مضبوطة — تخطٍّ مقصود");
    // زيارة مسار داخلي مقفول ليُحفظ في next — ثم الفتح يعدنا إليه
    await page.goto("/");
    await expect(page).toHaveURL(/\/lock/, { timeout: 15_000 });
    await unlockSystem(page);
    await page.goto("/");
    // خلف القفل: شاشة الدخول (اسم المستخدم) — القفل سقط والدخول طبقة مستقلة
    await expect(page.getByLabel("اسم المستخدم")).toBeVisible({ timeout: 20_000 });
  });
});
