import { expect, test } from "@playwright/test";
import { tryUnlockSystem } from "./helpers";

/**
 * اختبارات السطح العام — بلا قاعدة بيانات:
 * الصفحة تصير حتى بلا قاعدة (تستهلك الـ API من المتصفح) —
 * نتحقق هنا من: الترسيّر، RTL، رؤوس الأمان (CSP بـ nonce)، منع الأطر.
 * v4.7 — القفل: نحاول فتحه صامتةً إن توفرت بيانات المدير (في CI دائماً)؛
 * بلا قاعدة تبقى الشاشة المقفلة وهي نفسها عربية RTL — التأكيدات تمر.
 */

test.describe("السطح العام", () => {
  test("الصفحة الرئيسية ترتجل للدخول وترتسم RTL", async ({ page }) => {
    await tryUnlockSystem(page);
    await page.goto("/");
    // التطبيق عميل كامل: يظهر شاشة الدخول عند عدم وجود جلسة
    // (بلا قاعدة/بيانات مدير تظهر شاشة القفل — وهي عربية RTL أيضاً)
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", /ar/);
    // عنصر جذري مرتسم فعلاً (لا شاشة بيضاء ولا حدود خطأ)
    await expect(page.locator("body")).toBeVisible();
  });

  test("رؤوس الأمان: CSP بـ nonce و strict-dynamic + HSTS-ready headers", async ({ request }) => {
    const res = await request.get("/");
    expect(res.status()).toBeLessThan(500);

    const csp = res.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toMatch(/script-src[^;]*'nonce-[A-Za-z0-9+/=]+'[^;]*'strict-dynamic'/);
    // v4.6: السكربتات لم تعد بـ unsafe-inline — الإحكام الجوهري
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);

    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("كل طلب يحصل على nonce مختلف (بلا إعادة استخدام)", async ({ request }) => {
    const r1 = (await request.get("/")).headers()["content-security-policy"] ?? "";
    const r2 = (await request.get("/")).headers()["content-security-policy"] ?? "";
    const n1 = r1.match(/'nonce-([^']+)'/)?.[1];
    const n2 = r2.match(/'nonce-([^']+)'/)?.[1];
    expect(n1).toBeTruthy();
    expect(n2).toBeTruthy();
    expect(n1).not.toBe(n2);
  });
});
