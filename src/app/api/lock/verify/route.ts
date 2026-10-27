import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { fail, ok } from "@/lib/api-guard";
import { clientIp } from "@/lib/auth";
import {
  lockRateLimiter,
  signLockToken,
  LOCK_COOKIE,
  lockTtlSec,
} from "@/lib/system-lock";

/**
 * POST /api/lock/verify — v4.7 قفل النظام بمفتاح المدير
 *
 * الواجهة الوحيدة التي تفتح قفل النظام: تطلب كلمة مرور مدير النظام
 * وتقابلها (bcrypt) ضد حسابات المدراء النشطين، ثم تصدر كوكي ruba_lock
 * (توكن موقّع بصلاحية محدودة). طبقة مستقلة تماماً عن جلسات المستخدمين —
 * حتى المسجل دخوله يمر من هنا عند أول وصول للنظام من جهاز جديد.
 *
 * التحصينات:
 *  - مقيّد دائم في القاعدة: 5 محاولات / 15 دقيقة لكل IP (نمط دخول v4.5)
 *  - رسائل خطأ عامة لا تكشف هل المشكلة في المفتاح أم في تهيئة النظام
 *  - كل محاولة (نجاح/فشل) تُدقَّق في LoginAudit باسم "system-lock"
 *    — تظهر في شاشة تدقيقات الدخول للمدير
 *  - تغيير كلمة مرور المدير يُبطل كل المفاتيح القائمة تلقائياً
 *    (بصمة الهاش داخل التوكن — ph)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const password = String((body as { password?: unknown } | null)?.password ?? "");
    if (!password) return fail("أدخل مفتاح النظام");

    // ── صدّ القوة الغاشمة قبل أي bcrypt ──
    const ip = clientIp(request.headers);
    const limit = await lockRateLimiter.hit(`lock:${ip}`);
    if (!limit.allowed) {
      return fail(
        `محاولات كثيرة — أعد المحاولة بعد ${Math.ceil(limit.retryAfterSec / 60)} دقيقة`,
        429,
        { retryAfterSec: limit.retryAfterSec }
      );
    }

    // مفتاح النظام = كلمة مرور أي حساب مدير نشط (الأقدم أولاً — عادةً واحد)
    const admins = await db.user.findMany({
      where: { role: "admin", isActive: true },
      orderBy: { createdAt: "asc" },
      take: 5,
    });
    if (admins.length === 0) {
      return fail("النظام غير مهيأ — لا يوجد حساب مدير", 500);
    }

    let matched: (typeof admins)[number] | null = null;
    for (const admin of admins) {
      if (await bcrypt.compare(password, admin.password)) {
        matched = admin;
        break;
      }
    }

    // التدقيق: كل محاولة موثقة باسم ثابت يظهر في شاشة التدقيق
    await recordLockAudit(matched !== null, ip, request, matched?.id);

    if (!matched) return fail("المفتاح غير صحيح", 401);

    // نجاح ⇒ تصفير العدّاد وإصدار مفتاح الفتح
    await lockRateLimiter.reset(`lock:${ip}`);
    const token = await signLockToken(matched.password);

    const secureCookie =
      process.env.COOKIE_SECURE === "true" ||
      (process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false");
    const res = ok({ unlocked: true });
    res.cookies.set(LOCK_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookie,
      maxAge: lockTtlSec(),
      path: "/",
    });
    return res;
  } catch {
    return fail("تعذر التحقق من المفتاح — أعد المحاولة", 500);
  }
}

/** تدقيق محاولات القفل في نفس سجل الدخول — لا يعطل المسار أبداً */
async function recordLockAudit(
  success: boolean,
  ip: string,
  request: NextRequest,
  userId?: string
) {
  try {
    await db.loginAudit.create({
      data: {
        username: "system-lock",
        userId: userId ?? null,
        success,
        ip,
        userAgent: (request.headers.get("user-agent") ?? "").slice(0, 250) || null,
      },
    });
  } catch {
    /* التدقيق لا يعطل فتح القفل */
  }
}
