/**
 * v4.6 (P2) — مراقبة أخطاء الخادم عبر Sentry — اختيارية وآمنة:
 *  - بلا SENTRY_DSN: لا شيء يُهيأ ولا يُرسل — صفر عبء وصفر تسريب بيانات.
 *  - بمجرد ضبط SENTRY_DSN في البيئة تعمل المراقبة تلقائياً (بلا تغيير كود).
 *  - تُستبعد معلومات المستخدم الحساسة افتراضياً (sendDefaultPii: false — الافتراضي).
 *
 * التفعيل في الإنتاج (DEPLOYMENT.md):
 *   SENTRY_DSN="https://<key>@o<org>.ingest.sentry.io/<project>"
 *   SENTRY_TRACES_SAMPLE_RATE="0.1"   # اختياري — افتراضي 10%
 */
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    });
  } catch {
    // المراقبة يجب ألا تُسقط التطبيق مهما فشلت تهيئتها
  }
}

/** خطاف أخطاء طلبات Next.js (render/route/action/middleware) */
export async function onRequestError(
  error: unknown,
  request: {
    path: string;
    method: string;
    headers: Record<string, string | string[] | undefined>;
  },
  context: {
    routerKind: "Pages Router" | "App Router";
    routePath: string;
    routeType: "render" | "route" | "action" | "middleware";
    revalidateReason: "on-demand" | "stale-while-revalidate";
  }
) {
  if (!process.env.SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    await Sentry.captureRequestError(error, request, context);
  } catch {
    // كتم صامت — المراقبة ليست جزءاً من مسار الخدمة
  }
}
