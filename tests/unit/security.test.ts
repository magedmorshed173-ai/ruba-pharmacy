import { describe, it, expect } from "vitest";
import { RateLimiter } from "@/lib/rate-limit";
import { hasMinRole } from "@/lib/auth";

describe("RateLimiter — صدّ القوة الغاشمة", () => {
  it("يسمح حتى الحد ثم يرفض مع retryAfter", () => {
    const rl = new RateLimiter({ max: 3, windowMs: 60_000 });
    const t0 = Date.now();
    expect(rl.hit("u:ip", t0).allowed).toBe(true);
    expect(rl.hit("u:ip", t0 + 1).allowed).toBe(true);
    expect(rl.hit("u:ip", t0 + 2).allowed).toBe(true);
    const blocked = rl.hit("u:ip", t0 + 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("يفتح النافذة مجدداً بعد انقضائها", () => {
    const rl = new RateLimiter({ max: 2, windowMs: 1_000 });
    const t0 = Date.now();
    rl.hit("u:ip", t0);
    rl.hit("u:ip", t0 + 100);
    expect(rl.hit("u:ip", t0 + 200).allowed).toBe(false);
    // بعد انقضاء النافذة
    expect(rl.hit("u:ip", t0 + 1_500).allowed).toBe(true);
  });

  it("يفرّق بين المستخدمين المختلفين", () => {
    const rl = new RateLimiter({ max: 1, windowMs: 60_000 });
    expect(rl.hit("a:ip", Date.now()).allowed).toBe(true);
    expect(rl.hit("b:ip", Date.now()).allowed).toBe(true);
    expect(rl.hit("a:ip", Date.now()).allowed).toBe(false);
  });

  it("reset يصفّر العدّاد", () => {
    const rl = new RateLimiter({ max: 1, windowMs: 60_000 });
    rl.hit("u:ip");
    rl.reset("u:ip");
    expect(rl.hit("u:ip").allowed).toBe(true);
  });
});

describe("hasMinRole — التسلسل الهرمي للأدوار", () => {
  it("المدير يمر كل الحدود", () => {
    expect(hasMinRole("admin", "admin")).toBe(true);
    expect(hasMinRole("admin", "pharmacist")).toBe(true);
    expect(hasMinRole("admin", "technician")).toBe(true);
  });
  it("الصيدلي يفشل على حدود المدير", () => {
    expect(hasMinRole("pharmacist", "pharmacist")).toBe(true);
    expect(hasMinRole("pharmacist", "admin")).toBe(false);
  });
  it("الفني مفيد فقط للعمليات العامة", () => {
    expect(hasMinRole("technician", "technician")).toBe(true);
    expect(hasMinRole("technician", "pharmacist")).toBe(false);
    expect(hasMinRole("technician", "admin")).toBe(false);
  });
});
