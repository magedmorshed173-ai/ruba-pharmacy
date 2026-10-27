import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  issueLoginResponse,
  verify2faChallenge,
  Role,
} from "@/lib/auth";
import { fail, ok } from "@/lib/api-guard";
import { loginRateLimiter } from "@/lib/rate-limit-db";
import { verifyTotp } from "@/lib/totp";

/**
 * POST /api/auth/login/verify — الخطوة الثانية للدخول (v4.5)
 * المدخل: challenge (توكن 5 دقائق من الخطوة الأولى) + كود TOTP.
 * القاعدة: لا جلسة بلا تحدي صالح + كود صحيح. المحاولات الفاشلة تُقيَّد
 * بنفس مقيّد الدخول (5/15د) — التخمين مستحيل عملياً.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const challenge = String(body.challenge ?? "");
    const code = String(body.code ?? "");
    if (!challenge || !code)
      return fail("التحدي والكود مطلوبان");

    const userId = await verify2faChallenge(challenge);
    if (!userId)
      return fail("انتهت صلاحية التحقق — سجّل الدخول من جديد", 401);

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive || !user.totpEnabled || !user.totpSecret)
      return fail("الحساب غير مهيأ للتحقق بخطوتين — سجّل الدخول من جديد", 401);

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const limit = await loginRateLimiter.hit(`2fa:${user.username}:${ip}`);
    if (!limit.allowed)
      return fail(
        `محاولات كثيرة — أعد المحاولة بعد ${Math.ceil(limit.retryAfterSec / 60)} دقيقة`,
        429,
        { retryAfterSec: limit.retryAfterSec }
      );

    const { valid } = verifyTotp(user.totpSecret, code, Math.floor(Date.now() / 1000));
    if (!valid)
      return fail("كود التحقق غير صحيح", 401);

    await loginRateLimiter.reset(`2fa:${user.username}:${ip}`);

    return issueLoginResponse(
      {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role as Role,
      },
      request
    );
  } catch {
    return fail("تعذر التحقق", 500);
  }
}
