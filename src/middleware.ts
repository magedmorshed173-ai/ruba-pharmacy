import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import {
  LOCK_COOKIE,
  LOCK_PURPOSE,
  DEV_FALLBACK_SECRET,
  lockEnabled,
  lockEpoch,
  isLockPublicPath,
} from "@/lib/lock-shared";

/**
 * ── v4.7 — قفل النظام بمفتاح المدير + v4.6 CSP بـ nonce ──
 *
 * بوابة القفل (أول الطبقات قبل شاشة الدخول نفسها):
 *  - أي طلب صفحة أو واجهة API بلا مفتاح فتح صالح ⇒ توجيه إلى /lock
 *    (للصفحات) أو 401 JSON (للـ API) — لا يُرى النظام إطلاقاً بلا المفتاح.
 *  - المفتاح = كلمة مرور مدير النظام، تُدخل مرة واحدة في /lock ثم تصدر
 *    كوكي ruba_lock (توكن JWT موقّع HS256 — httpOnly) بصلاحية محدودة.
 *  - التحقق هنا توقيعي فقط (Edge — بلا قاعدة بيانات): التوقيع + الغرض +
 *    الـ epoch + الصلاحية. التحقق من كلمة المرور نفسها في /api/lock/verify.
 *  - SYSTEM_LOCK=off يعطل البوابة كلياً (تطوير/اختبارات فقط).
 *
 * CSP (منذ v4.6 — كما هي دون تغيير):
 *  - nonce جديد لكل طلب — Next.js يقرؤه آلياً من رأس CSP على الطلب
 *    ويضيفه لكل سكربتات المخطوط الخاصة به (App Router، 13.4.20+).
 *  - 'strict-dynamic': السكربتات الموثوقة بالـ nonce وحدها تحمّل تبعياتها —
 *    أي سكربت محقون في HTML (XSS) يسقط لأنه بلا nonce ولا يملك مصدراً موثوقاً.
 *  - style-src يبقى 'unsafe-inline' (مطلوب لبنياً للأنماط المضمنة في React/Next).
 *  - في التطوير فقط: 'unsafe-eval' لـ Fast Refresh.
 *  - إعدادات غير CSP تبقى في next.config.ts (HSTS، XFO…) لسريانها على API أيضاً.
 */

// عميل jose متوافق مع Edge — نفس منطق السر الاحتياطي في src/lib/auth.ts
const lockSecret = new TextEncoder().encode(
  process.env.AUTH_SECRET || DEV_FALLBACK_SECRET
);

/** هل كوكي القفل يحمل توكن موقّعاً صالحاً بالغرض والـ epoch الصحيحين؟ */
async function isUnlocked(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(LOCK_COOKIE)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, lockSecret, {
      // الصلاحية (exp) تُفحص آلياً — الفارق الزمني المسموح دقيقة واحدة
      clockTolerance: 60,
    });
    return (
      payload.purpose === LOCK_PURPOSE &&
      // v5.0 — مقارنة عددية (>=): رفع LOCK_EPOCH البيئي يسحب كل المفاتيح الأدنى
      // فوراً على كل الأجهزة، والمفاتيح الصادرة بإعدادات أعلى من اللوحة تبقى صالحة
      Number(payload.epoch) >= Number(lockEpoch())
    );
  } catch {
    return false;
  }
}

function buildCsp(isDev: boolean): { csp: string; nonce: string } {
  // الـ nonce الواحد يُستخدم في رأس الطلب ورأس الاستجابة معاً —
  // Next.js يقرؤه من رأس الطلب ليضيفه لسكربتاته، والمتصفح يفرض رأس الاستجابة
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
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
  return { csp, nonce };
}

export async function middleware(request: NextRequest) {
  const isDev = process.env.NODE_ENV === "development";
  const { csp, nonce } = buildCsp(isDev);

  // ── بوابة القفل ──
  // v5.0: مسار كرون التقارير (POST فقط) يُعفى من البوابة — الطلب نفسه
  // يُحصَّن داخل النقطة بـ CRON_SECRET أو جلسة مدير أو مقيّد معدل صارم،
  // بينما GET يبقى خلف البوابة (يعرض بيانات تشغيلية).
  const isCronPost =
    request.nextUrl.pathname === "/api/reports/snapshot" &&
    request.method === "POST";
  if (
    lockEnabled() &&
    !isCronPost &&
    !isLockPublicPath(request.nextUrl.pathname) &&
    !(await isUnlocked(request))
  ) {
    if (request.nextUrl.pathname.startsWith("/api")) {
      // واجهات API: رفض صريح بلا أي محتوى — لا تسريب ولا توجيهات
      const denied = NextResponse.json(
        { error: "النظام مقفل — أدخل مفتاح مدير النظام", locked: true },
        { status: 401 }
      );
      denied.headers.set("Cache-Control", "no-store");
      return denied;
    }
    // الصفحات: شاشة القفل مع وجهة العودة بعد الفتح (داخلية فقط)
    const next = request.nextUrl.pathname + request.nextUrl.search;
    const url = request.nextUrl.clone();
    url.pathname = "/lock";
    url.search = "";
    if (next && next !== "/") url.searchParams.set("next", next);
    const redirect = NextResponse.redirect(url);
    redirect.headers.set("Cache-Control", "no-store");
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }

  // ── CSP كما في v4.6 ──
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
  // كل شيء عدا الثوابت والملفات — بما فيها /api الآن (البوابة تغطي الواجهات)
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|manifest.webmanifest|manifest.ts|icon.svg|pwa-|maskable-|apple-touch-icon|screenshots).*)",
  ],
};
