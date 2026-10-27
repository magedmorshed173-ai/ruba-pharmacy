/**
 * المقيّد الدائم للأسعار — v4.5 (P1)
 * يحل عيب المقيّد في الذاكرة: العدّاد كان يُصفَّر بإعادة التشغيل ولا يتوزع
 * على نسخ الخادم المتعددة. الآن كل محاولة تُكتب في جدول RateLimit ببيان
 * واحد ذري (INSERT..ON CONFLICT..RETURNING) — نافذة ثابتة لكل مفتاح.
 *
 * التراجع الآمن: تعذر القاعدة (Network blip على Neon مثلاً) لا يوقف
 * مسار الدخول — يعود فوراً للمقيّد المحلي في الذاكرة حتى تتعافى القاعدة.
 */
import { db } from "@/lib/db";
import { loginLimiter } from "@/lib/rate-limit";

export interface LimiterResult {
  allowed: boolean;
  /** ثوانٍ حتى نهاية النافذة الحالية — 0 إذا مسموح */
  retryAfterSec: number;
}

/**
 * القرار النقي: هل المحاولة رقم count (بعد الزيادة) ضمن نافذة تبدأت في
 * windowStart مسموحة؟ نافذة ثابتة: تجاوز الحد ⇒ رفض حتى انتهاء النافذة.
 */
export function evaluateAttempt(
  count: number,
  windowStart: Date,
  now: Date,
  maxAttempts: number,
  windowSec: number
): LimiterResult {
  if (count <= maxAttempts) return { allowed: true, retryAfterSec: 0 };
  const elapsedSec = Math.floor((now.getTime() - windowStart.getTime()) / 1000);
  const remaining = Math.max(1, windowSec - elapsedSec);
  return { allowed: false, retryAfterSec: remaining };
}

export interface DbRateLimiter {
  hit(key: string): Promise<LimiterResult>;
  reset(key: string): Promise<void>;
}

/** مقيّد قاعدي بنافذة ثابتة — maxAttempts داخل كل windowSec */
export function createDbRateLimiter(
  maxAttempts: number,
  windowSec: number
): DbRateLimiter {
  return {
    async hit(key: string): Promise<LimiterResult> {
      const now = new Date();
      const cutoff = new Date(now.getTime() - windowSec * 1000);
      try {
        const rows = await db.$queryRaw<{ count: number; windowStart: Date }[]>`
          INSERT INTO "RateLimit" ("key", "count", "windowStart")
          VALUES (${key}, 1, ${now})
          ON CONFLICT ("key") DO UPDATE SET
            "count"    = CASE WHEN "RateLimit"."windowStart" < ${cutoff} THEN 1 ELSE "RateLimit"."count" + 1 END,
            "windowStart" = CASE WHEN "RateLimit"."windowStart" < ${cutoff} THEN ${now} ELSE "RateLimit"."windowStart" END
          RETURNING "count", "windowStart"
        `;
        const row = rows[0];
        return evaluateAttempt(
          Number(row.count),
          new Date(row.windowStart),
          now,
          maxAttempts,
          windowSec
        );
      } catch {
        // القاعدة غير متاحة — تراجع آمن للذاكرة (لا يوقف الدخول أبداً)
        return loginLimiter.hit(key);
      }
    },

    async reset(key: string): Promise<void> {
      try {
        await db.rateLimit.delete({ where: { key } });
      } catch {
        /* التصفير لا يفشل مسار الدخول */
      }
      loginLimiter.reset(key);
    },
  };
}

/** مقيّد الدخول: 5 محاولات / 15 دقيقة لكل (مستخدم+IP) — نفس سياسة v3.1 */
export const loginRateLimiter = createDbRateLimiter(5, 15 * 60);
