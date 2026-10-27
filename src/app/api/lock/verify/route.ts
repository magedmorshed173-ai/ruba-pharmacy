import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { fail, ok } from "@/lib/api-guard";
import { clientIp } from "@/lib/auth";
import { lockMode } from "@/lib/lock-shared";
import {
  lockRateLimiter,
  signLockToken,
  LOCK_COOKIE,
  lockTtlSec,
} from "@/lib/system-lock";

/**
 * POST /api/lock/verify — v4.7 قفل النظام + v4.8 وضعان للمفاتيح
 *
 * الواجهة الوحيدة التي تفتح قفل النظام، بوضعين يُضبطان بمتغير LOCK_MODE:
 *  - "admin" (افتراضي): كلمة مرور مدير النظام — تقابل bcrypt ضد المدراء النشطين.
 *  - "users": اسم مستخدم + كلمة مرور لأي حساب نشط — للاستخدام متعدد الموظفين،
 *             والتدقيق يسجل اسم المُفتِح في كل محاولة.
 *
 * في الحالتين يصدر كوكي ruba_lock (توكن موقّع بصلاحية محدودة)، وبصمة هاش
 * كلمة مرور المُفتِح داخل التوكن (ph) — تغيير كلمة مروره يميت مفاتيحه فوراً.
 *
 * التحصينات:
 *  - مقيّد دائم في القاعدة: 5 محاولات / 15 دقيقة لكل IP (نمط دخول v4.5)
 *  - في وضع users: حساب مجهول ⇒ مقارنة bcrypt وهمية بنفس الكلفة —
 *    منع تسريب وجود المستخدم عبر قياس زمن الاستجابة (timing attack)
 *  - رسائل خطأ عامة لا تكشف هل المشكلة في المفتاح أم في تهيئة النظام
 *  - كل محاولة (نجاح/فشل) تُدقَّق في LoginAudit باسم "system-lock"
 *    (وفي وضع users: "system-lock:<username>") — تظهر في شاشة التدقيق
 */

// هاش وهمي ثابت الكلفة لمقارنات الحسابات المجهولة (يُحسب مرة عند الإقلاع)
const DUMMY_HASH = bcrypt.hashSync("ruba-timing-dummy-2026", 10);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const password = String(
      (body as { password?: unknown } | null)?.password ?? ""
    );
    const mode = lockMode();
    const username = String(
      (body as { username?: unknown } | null)?.username ?? ""
    )
      .trim()
      .toLowerCase();

    if (!password) {
      return fail(
        mode === "users" ? "أدخل اسم المستخدم وكلمة المرور" : "أدخل مفتاح النظام"
      );
    }

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

    let matched: { id: string; password: string } | null = null;
    let auditName = "system-lock";

    if (mode === "users") {
      // وضع المفاتيح الفردية: كل مستخدم نشط يفتح بحسابه — الاسم يُدقَّق حصراً
      if (!username) return fail("أدخل اسم المستخدم", 400);
      auditName = `system-lock:${username.slice(0, 40)}`;

      const user = await db.user.findUnique({ where: { username } });
      if (user && user.isActive) {
        if (await bcrypt.compare(password, user.password)) {
          matched = user;
        }
      } else {
        // حساب مجهول أو معطل: مقارنة وهمية بنفس كلفة bcrypt — لا تسريب زمني
        await bcrypt.compare(password, DUMMY_HASH);
      }
    } else {
      // الوضع الأصلي: مفتاح النظام = كلمة مرور أي حساب مدير نشط (الأقدم أولاً)
      const admins = await db.user.findMany({
        where: { role: "admin", isActive: true },
        orderBy: { createdAt: "asc" },
        take: 5,
      });
      if (admins.length === 0) {
        return fail("النظام غير مهيأ — لا يوجد حساب مدير", 500);
      }

      for (const admin of admins) {
        if (await bcrypt.compare(password, admin.password)) {
          matched = admin;
          break;
        }
      }
    }

    // التدقيق: كل محاولة موثقة باسم ثابت يظهر في شاشة التدقيق
    await recordLockAudit(matched !== null, ip, request, matched?.id, auditName);

    if (!matched) {
      return fail(
        mode === "users" ? "بيانات غير صحيحة" : "المفتاح غير صحيح",
        401
      );
    }

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
  userId?: string,
  auditName: string = "system-lock"
) {
  try {
    await db.loginAudit.create({
      data: {
        username: auditName,
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
