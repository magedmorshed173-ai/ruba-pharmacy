/**
 * محدد المعدل (Rate Limiter) — نافذة منزلقة في الذاكرة
 * يحمي نقاط المصادقة من القوة الغاشمة (brute force).
 * عملية نقية داخلية + حالة معزولة لكل نسخة → قابلة للاختبار.
 * ملاحظة إنتاجية: في تعدد النسخ (Vercel/Cluster) استبدلها بـ Redis/Upstash —
 * الواجهة هنا مصممة لتُغليَّف دون تغيير نقاط الاستدعاء.
 */

interface Attempt {
  timestamps: number[];
}

export interface RateLimitOptions {
  /** أقصى محاولات داخل النافذة */
  max: number;
  /** نافذة الزمن بالمللي ثانية */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** ثوانٍ حتى إتاحة المحاولة التالية (عند الرفض) */
  retryAfterSec: number;
}

export class RateLimiter {
  private store = new Map<string, Attempt>();
  private lastSweep = Date.now();
  private readonly opts: RateLimitOptions;

  constructor(opts: RateLimitOptions = { max: 5, windowMs: 15 * 60 * 1000 }) {
    this.opts = opts;
  }

  /** فحص وتسجيل محاولة لمفتاح (username:ip مثلاً) */
  hit(key: string, now: number = Date.now()): RateLimitResult {
    this.sweepIfNeeded(now);
    const entry = this.store.get(key) ?? { timestamps: [] };
    entry.timestamps = entry.timestamps.filter(
      (t) => now - t < this.opts.windowMs
    );

    if (entry.timestamps.length >= this.opts.max) {
      this.store.set(key, entry);
      const oldest = entry.timestamps[0];
      const retryAfterSec = Math.max(
        1,
        Math.ceil((oldest + this.opts.windowMs - now) / 1000)
      );
      return { allowed: false, remaining: 0, retryAfterSec };
    }

    entry.timestamps.push(now);
    this.store.set(key, entry);
    return {
      allowed: true,
      remaining: this.opts.max - entry.timestamps.length,
      retryAfterSec: 0,
    };
  }

  /** تصفير المفتاح (مثلاً بعد نجاح الدخول) */
  reset(key: string): void {
    this.store.delete(key);
  }

  /** تنظيف دوري للمفاتيح الخاملة — يمنع تضخم الذاكرة */
  private sweepIfNeeded(now: number): void {
    if (now - this.lastSweep < 60 * 1000) return;
    this.lastSweep = now;
    for (const [key, entry] of this.store) {
      const alive = entry.timestamps.filter(
        (t) => now - t < this.opts.windowMs
      );
      if (alive.length === 0) this.store.delete(key);
      else entry.timestamps = alive;
    }
  }
}

/** الحدّث العام لمسار تسجيل الدخول (نافذة 15 دقيقة، 5 محاولات) */
export const loginLimiter = new RateLimiter({ max: 5, windowMs: 15 * 60 * 1000 });
