import { NextRequest, NextResponse } from "next/server";

/**
 * v4.6 (P2) — CSP بـ nonce لكل طلب (تنفيذ الخطة المؤجلة من v3.5):
 *
 *  - nonce جديد لكل طلب — Next.js يقرؤه آلياً من رأس CSP على الطلب
 *    ويضيفه لكل سكربتات المخطوط الخاصة به (App Router، 13.4.20+).
 *  - 'strict-dynamic': السكربتات الموثوقة بالـ nonce وحدها تحمّل تبعياتها —
 *    أي سكربت محقون في HTML (XSS) يسقط لأنه بلا nonce ولا يملك مصدراً موثوقاً.
 *  - style-src يبقى 'unsafe-inline' (مطلوب لبنياً للأنماط المضمنة في React/Next).
 *  - في التطوير فقط: 'unsafe-eval' لـ Fast Refresh.
 *  - إعدادات غير CSP تبقى في next.config.ts (HSTS، XFO…) لسريانها على API أيضاً.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      isDev ? " 'unsafe-eval'" : ""
    }`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");

  // على الطلب: ليقرأ Next الـ nonce ويضيفه لسكربتاته أثناء الترسيّر
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  // على الاستجابة: ليفرضه المتصفح
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // صفحات التطبيق فقط — الثوابت والملفات والـ API بلا حاجة لإعادة حساب CSP
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|manifest.ts|icon.svg|pwa-|maskable-|apple-touch-icon|screenshots).*)",
  ],
};
