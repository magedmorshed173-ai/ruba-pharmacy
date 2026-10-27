/**
 * v4.7 — قفل النظام بمفتاح المدير — نواة الخادم (Node runtime فقط)
 *
 * الفكرة: طبقة حماية أولى قبل شاشة الدخول نفسها — من يريد استخدام النظام
 * يطلب منه كلمة مرور مدير النظام. الفتح يصدر توكن JWT موقّعاً بنفس سرّ
 * الجلسات (AUTH_SECRET) يحمل:
 *  - purpose: "system-lock" — لا يمكن استخدامه كتوكن جلسة والعكس صحيح
 *  - epoch:   رافعة السحب الفوري العالمي (تغيير LOCK_EPOCH يميت كل المفاتيح)
 *  - ph:      بصمة SHA-256 لـ hash كلمة مرور المدير — تغيير كلمة المرور
 *             يُبطل تلقائياً كل مفاتيح الفتح القائمة مبنية عليها
 *  - exp:     صلاحية قصيرة افتراضياً (4 ساعات — قابلة للضبط)
 */
import { randomUUID, createHash } from "node:crypto";
import { SignJWT } from "jose";
import { DEV_FALLBACK_SECRET, LOCK_COOKIE, LOCK_PURPOSE, lockEpoch } from "./lock-shared";
import { createDbRateLimiter } from "./rate-limit-db";

export { LOCK_COOKIE };

/** صلاحية مفتاح الفتح بالثواني — الافتراضي 4 ساعات (LOCK_TTL_HOURS للضبط) */
export function lockTtlSec(): number {
  const hours = Number(process.env.LOCK_TTL_HOURS ?? "4");
  return Math.min(24 * 7, Math.max(1, Number.isFinite(hours) && hours > 0 ? hours : 4)) * 3600;
}

function lockSecret(): Uint8Array {
  return new TextEncoder().encode(
    process.env.AUTH_SECRET || DEV_FALLBACK_SECRET
  );
}

/** بصمة هاش كلمة المرور — 16 محرف hex كافية للإبطال ولا تكشف شيئاً */
export function lockKeyFingerprint(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);
}

/** إصدار توكن فتح موقّع (HS256) بصلاحية محدودة */
export async function signLockToken(passwordHash: string): Promise<string> {
  return new SignJWT({
    purpose: LOCK_PURPOSE,
    epoch: lockEpoch(),
    ph: lockKeyFingerprint(passwordHash),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(`${lockTtlSec()}s`)
    .sign(lockSecret());
}

/**
 * مقيّد محاولات فتح القفل — دائم في القاعدة (نمط v4.5): 5 محاولات / 15 دقيقة
 * لكل IP. القوة الغاشمة على بوابة المدير تُصدّ هنا قبل الوصول لـ bcrypt.
 */
export const lockRateLimiter = createDbRateLimiter(5, 15 * 60);
