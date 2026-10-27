import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  clientIp,
  issueLoginResponse,
  sign2faChallenge,
  Role,
} from "@/lib/auth";
import { fail, ok } from "@/lib/api-guard";
import { loginLimiter } from "@/lib/rate-limit";
import { loginRateLimiter } from "@/lib/rate-limit-db";

/**
 * POST /api/auth/login
 * v3.1 — تعزيز أمني:
 *  - Rate limiting: 5 محاولات / 15 دقيقة لكل (مستخدم+IP) — يصدّ القوة الغاشمة
 *  - كوكي Secure في الإنتاج (COOKIE_SECURE=true أو NODE_ENV=production)
 *  - رسائل خطأ عامة (لا تكشف أي الحقلين خاطئ)
 * v3.9 — جلسات قابلة للسحب:
 *  - كل دخول يسجل صفاً في Session ببصمة الجهاز وIP — التوكن بلا صف لا يُعترف به
 * v4.5 — التحقق بخطوتين:
 *  - حساب TOTP مفعّل ⇒ الدخول خطوتان: كلمة المرور تعيد challenge توكن
 *    قصير الأجل (5 دقائق، ليس جلسة) ثم الكود يُرسل إلى /api/auth/login/verify
 *  - المدير بلا TOTP يعود له mustEnroll2fa ليتخذ الواجهة التوجيه المناسب
 *  - v4.5.1: المقيّد صار دائماً في القاعدة (RateLimit) — لا يُصفَّر بإعادة
 *    التشغيل ولا يتناثر بين نسخ الخادم، مع تراجع آمن للذاكرة عند تعذر القاعدة
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    if (!username || !password)
      return fail("اسم المستخدم وكلمة المرور مطلوبان");

    // ── حماية القوة الغاشمة (دائمة في القاعدة) ──
    const ip = clientIp(request.headers);
    const limit = await loginRateLimiter.hit(`${username}:${ip}`);
    if (!limit.allowed) {
      return fail(
        `محاولات كثيرة — أعد المحاولة بعد ${Math.ceil(limit.retryAfterSec / 60)} دقيقة`,
        429,
        { retryAfterSec: limit.retryAfterSec }
      );
    }

    const user = await db.user.findUnique({ where: { username } });
    if (!user || !user.isActive) {
      await recordLoginAudit(username, false, ip, request);
      return fail("بيانات الدخول غير صحيحة أو الحساب موقوف", 401);
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      await recordLoginAudit(username, false, ip, request);
      return fail("بيانات الدخول غير صحيحة", 401);
    }

    // نجاح كلمة المرور → تصفير عدّاد المحاولات
    await loginRateLimiter.reset(`${username}:${ip}`);
    await recordLoginAudit(username, true, ip, request, user.id);

    const session = {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role as Role,
    };

    // ── بوابة التحقق بخطوتين ──
    if (user.totpEnabled && user.totpSecret) {
      const challenge = await sign2faChallenge(user.id);
      return ok({ twoFactorRequired: true, challenge });
    }

    // المدير بلا TOTP: جلسة كاملة + توجيه لتفعيلها (ليس حجباً)
    return issueLoginResponse(
      session,
      request,
      user.role === "admin" ? { mustEnroll2fa: true } : undefined
    );
  } catch {
    return fail("تعذر تسجيل الدخول", 500);
  }
}

/** تسجيل كل محاولة دخول (v3.3) — لا يكسر مسار الدخول أبداً */
async function recordLoginAudit(
  username: string,
  success: boolean,
  ip: string,
  request: NextRequest,
  userId?: string
) {
  try {
    await db.loginAudit.create({
      data: {
        username: username.slice(0, 80),
        userId: userId ?? null,
        success,
        ip,
        userAgent: (request.headers.get("user-agent") ?? "").slice(0, 250) || null,
      },
    });
  } catch {
    /* التدقيق لا يعطّل الدخول */
  }
}
