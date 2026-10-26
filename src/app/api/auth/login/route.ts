import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  COOKIE_NAME,
  signSession,
  createSession,
  hashDevice,
  Role,
} from "@/lib/auth";
import { fail, ok } from "@/lib/api-guard";
import { loginLimiter } from "@/lib/rate-limit";

/**
 * POST /api/auth/login
 * v3.1 — تعزيز أمني:
 *  - Rate limiting: 5 محاولات / 15 دقيقة لكل (مستخدم+IP) — يصدّ القوة الغاشمة
 *  - كوكي Secure في الإنتاج (COOKIE_SECURE=true أو NODE_ENV=production)
 *  - رسائل خطأ عامة (لا تكشف أي الحقلين خاطئ)
 * v3.9 — جلسات قابلة للسحب:
 *  - كل دخول يسجل صفاً في Session ببصمة الجهاز وIP — التوكن بلا صف لا يُعترف به
 *  - الخروج أو تغيير كلمة المرور أو إيقاف الحساب يسحب الجلسات فوراً
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    if (!username || !password)
      return fail("اسم المستخدم وكلمة المرور مطلوبان");

    // ── حماية القوة الغاشمة ──
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "local";
    const limit = loginLimiter.hit(`${username}:${ip}`);
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

    // نجاح الدخول → تصفير عدّاد المحاولات
    loginLimiter.reset(`${username}:${ip}`);
    await recordLoginAudit(username, true, ip, request, user.id);

    const session = {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role as Role,
    };
    const token = await signSession(session);

    // تسجيل الجلسة في القاعدة — بلا صف، التوكن ميت (قابل للسحب لاحقاً)
    try {
      await createSession({
        token,
        userId: user.id,
        deviceHash: hashDevice(request.headers.get("user-agent")),
        ip,
        userAgent: request.headers.get("user-agent"),
      });
    } catch {
      return fail("تعذر بدء الجلسة — أعد المحاولة", 500);
    }

    const res = ok({ user: session });
    const secureCookie =
      process.env.COOKIE_SECURE === "true" ||
      (process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false");
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookie,
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });
    return res;
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
