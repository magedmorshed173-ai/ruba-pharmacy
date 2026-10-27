/**
 * v4.6 (P2) — مراقبة أخطاء المتصفح عبر Sentry — اختيارية:
 * تُفعَّل فقط عند ضبط NEXT_PUBLIC_SENTRY_DSN (مختلف عن DSN الخادم —
 * المفتاح العام يظهر في المتصفح بطبيعته، لذا استخدم مفتاح client من Sentry).
 */
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "client",
      tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    });
  });
}
