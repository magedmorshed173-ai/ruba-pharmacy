import { describe, it, expect } from "vitest";
import { evaluateAttempt } from "@/lib/rate-limit-db";

// القرار النقي — نفس سياسة مقيّد الدخول: 5 محاولات / 15 دقيقة
const MAX = 5;
const WINDOW = 15 * 60;
const NOW = new Date("2026-01-01T12:00:00Z");
const windowStart = (offsetSec = 0) =>
  new Date(NOW.getTime() - offsetSec * 1000);

describe("evaluateAttempt — نافذة ثابتة قاعدية", () => {
  it("المحاولات ضمن الحد مسموحة", () => {
    for (let c = 1; c <= MAX; c++)
      expect(evaluateAttempt(c, windowStart(0), NOW, MAX, WINDOW).allowed).toBe(true);
  });

  it("المحاولة رقم الحد نفسها مسموحة (5 من 5)", () => {
    expect(evaluateAttempt(MAX, windowStart(0), NOW, MAX, WINDOW)).toEqual({
      allowed: true,
      retryAfterSec: 0,
    });
  });

  it("تجاوز الحد ⇒ رفض حتى نهاية النافذة", () => {
    const r = evaluateAttempt(MAX + 1, windowStart(60), NOW, MAX, WINDOW);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBe(WINDOW - 60);
  });

  it("عقد الدالة: لا ترى نافذة منتهية بعدّاد مرتفع — SQL يصفّرها قبله (بيان واحد)", () => {
    // النافذة المنتهية تُعالج في ON CONFLICT قبل الوصول هنا — لذا أي صف
    // يصل لهذه الدالة عدّاده ضمن نافذة حية؛ الصف «القديم» يستحق مهلة أدنى 1
    const expired = windowStart(WINDOW + 10);
    const r = evaluateAttempt(MAX + 50, expired, NOW, MAX, WINDOW);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBe(1);
  });

  it("مهلة الانتظار لا تقل عن ثانية واحدة (حماية من الصفر)", () => {
    const r = evaluateAttempt(MAX + 1, windowStart(WINDOW + 5), NOW, MAX, WINDOW);
    expect(r.retryAfterSec).toBe(1);
  });

  it("بداية النافذة تماماً: الرفض يعطي النافذة كاملة", () => {
    const r = evaluateAttempt(MAX + 1, windowStart(0), NOW, MAX, WINDOW);
    expect(r.retryAfterSec).toBe(WINDOW);
  });

  it("نافذة مخصصة أقصر تعمل بنفس المنطق (سياسات مستقبلية)", () => {
    const r = evaluateAttempt(11, windowStart(30), NOW, 10, 60);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBe(30);
  });
});
