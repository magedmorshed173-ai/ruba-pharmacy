import type { NextConfig } from "next";

/**
 * رؤوس الأمان — أحدث المعايير (v3.5):
 *  - HSTS يفرض HTTPS في الإنتاج (أثر لا يذكر محلياً)
 *  - CSP بسياسة مشددة مع استثناء inline المطلوب بنية Next.js (خطة لاحقة: nonce عبر middleware)
 *  - camera=(self) لأن ماسح الباركود بالكاميرا ميزة معتمدة
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "media-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // v4.4.1: أخطاء الأنواع لا تُخفى بعد — البناء يفشل أمام أي خطأ tsc
  // (كان ignoreBuildErrors: true يسمح بديون صامتة عالجناها في P0)
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
