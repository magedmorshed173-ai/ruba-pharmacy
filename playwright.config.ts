import { defineConfig, devices } from "@playwright/test";

/**
 * E2E — v4.6 (P2) — Playwright:
 *  - E2E_BASE_URL: وجهة الاختبار (افتراضي http://127.0.0.1:3000)
 *  - في CI: مهمة e2e تُهيّئ Postgres خدمياً + ترحيلات + بذر مدير +
 *    بناء إنتاج + تشغيل الخادم ثم تشغّل هذه الحزمة (.github/workflows/ci.yml)
 *  - بيانات مدير الاختبار من E2E_ADMIN_USER / E2E_ADMIN_PASSWORD —
 *    بلاها تُتخطى الاختبارات التي تتطلب دخولاً (skip) وتُنفَّذ اختبارات الواجهة العامة
 *  - ملاحظة: tests/e2e/live.e2e.ts سكربت حي قديم (bun) — لا يدخل في اختبارات Playwright
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    locale: "ar-SA",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
