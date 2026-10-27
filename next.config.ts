import type { NextConfig } from "next";

/**
 * رؤوس الأمان — أحدث المعايير (v3.5 ثم v4.6):
 *  - HSTS يفرض HTTPS في الإنتاج (أثر لا يذكر محلياً)
 *  - CSP انتقلت في v4.6 إلى src/middleware.ts بـ nonce لكل طلب +
 *    'strict-dynamic' — أعلى درجة تشديد عملية مع Next.js (بلا unsafe-inline للسكربتات)
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
