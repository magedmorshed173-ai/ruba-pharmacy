import { afterEach, describe, expect, it } from "vitest";
import {
  isLockPublicPath,
  lockMode,
  lockWarnBeforeSec,
  type LockMode,
} from "@/lib/lock-shared";

/**
 * v4.8 — اختبارات إعدادات القفل الجديدة:
 *  - lockMode: قراءة LOCK_MODE بأمان (افتراضي admin، users وحدها يُقبل،
 *    أي قيمة غريبة تسقط إلى admin — fail-closed)
 *  - lockWarnBeforeSec: حساب موعد التنبيه قبل انتهاء المفتاح
 *  - isLockPublicPath: المسارات العامة الجديدة (sw.js، offline، status)
 */

const OLD = process.env.LOCK_MODE;
afterEach(() => {
  if (OLD === undefined) delete process.env.LOCK_MODE;
  else process.env.LOCK_MODE = OLD;
});

describe("lockMode — وضع مفاتيح النظام (v4.8)", () => {
  it("الافتراضي admin عند غياب المتغير", () => {
    delete process.env.LOCK_MODE;
    expect(lockMode()).toBe<LockMode>("admin");
  });

  it("LOCK_MODE=users يفعّل المفاتيح الفردية", () => {
    process.env.LOCK_MODE = "users";
    expect(lockMode()).toBe<LockMode>("users");
  });

  it("حساسية الأحرف والمسافات — USERS و users* يقبلان", () => {
    process.env.LOCK_MODE = "  USERS  ";
    expect(lockMode()).toBe<LockMode>("users");
  });

  it("أي قيمة أخرى تسقط إلى admin (fail-closed)", () => {
    for (const bad of ["anyone", "admin2", "user", "", "all", "public"]) {
      process.env.LOCK_MODE = bad;
      expect(lockMode()).toBe<LockMode>("admin");
    }
  });
});

describe("lockWarnBeforeSec — موعد التنبيه قبل انتهاء المفتاح", () => {
  it("الافتراضي 4 ساعات ⇒ تنبيه بعد 10 دقائق (السقف الأعلى)", () => {
    expect(lockWarnBeforeSec(4 * 3600)).toBe(600);
  });

  it("ساعة واحدة ⇒ سدس المدة = 10 دقائق أيضاً", () => {
    expect(lockWarnBeforeSec(3600)).toBe(600);
  });

  it("مدة أقصر ⇒ سدس المدة (36 دقيقة ⇒ 6 دقائق)", () => {
    expect(lockWarnBeforeSec(36 * 60)).toBe(360);
  });

  it("حد أدنى دقيقة واحدة للأمد القصيرة جداً", () => {
    expect(lockWarnBeforeSec(5 * 60)).toBe(60);
    expect(lockWarnBeforeSec(60)).toBe(60);
  });
});

describe("isLockPublicPath — المسارات العامة الجديدة (v4.8)", () => {
  it("الـ Service Worker متاح حتى والقفل مشدود", () => {
    expect(isLockPublicPath("/sw.js")).toBe(true);
  });

  it("صفحة دون اتصال ومساراتها الفرعية عامة", () => {
    expect(isLockPublicPath("/offline")).toBe(true);
    expect(isLockPublicPath("/offline/nested")).toBe(true);
  });

  it("حالة القفل عامة (ضمن /api/lock)", () => {
    expect(isLockPublicPath("/api/lock/status")).toBe(true);
    expect(isLockPublicPath("/api/lock/verify")).toBe(true);
  });

  it("المسارات المحمية تبقى محمية — بلا تسريب بادئات مشابهة", () => {
    expect(isLockPublicPath("/sw.jsX")).toBe(false);
    expect(isLockPublicPath("/sw")).toBe(false);
    expect(isLockPublicPath("/offline-bypass")).toBe(false);
    expect(isLockPublicPath("/api/locksmith")).toBe(false);
    expect(isLockPublicPath("/drugs")).toBe(false);
    expect(isLockPublicPath("/api/drugs")).toBe(false);
  });
});
