import { describe, it, expect } from "vitest";
import {
  assertClaimTransition,
  assertPolicyUsable,
  claimStatusLabel,
  coveragePercentLabel,
  splitInsurancePayment,
} from "@/lib/insurance";

// ─── splitInsurancePayment — تقسيم المطلوب ──────────────────────────────

describe("splitInsurancePayment", () => {
  it("تغطية 70% على 115.00 ر.س: المؤمن 80.50 والمريض 34.50", () => {
    expect(splitInsurancePayment(11500, 7000)).toEqual({
      insurerDue: 8050,
      patientDue: 3450,
    });
  });

  it("لا هالك مالي: مجموع الحصتين = الإجمالي دائماً", () => {
    for (const total of [1, 99, 100, 9999, 11500, 250000]) {
      for (const bps of [0, 3333, 5000, 7000, 9999, 10000]) {
        const s = splitInsurancePayment(total, bps);
        expect(s.insurerDue + s.patientDue).toBe(total);
      }
    }
  });

  it("كسور الهللات لصالح المريض: 99.99 بـ 70% ⇒ المؤمن 69.99 (تقريب لأسفل)", () => {
    const s = splitInsurancePayment(9999, 7000);
    expect(s.insurerDue).toBe(6999); // floor(6999.3)
    expect(s.patientDue).toBe(3000);
  });

  it("تغطية 100%: المؤمن يتحمل كل شيء", () => {
    expect(splitInsurancePayment(50000, 10000)).toEqual({
      insurerDue: 50000,
      patientDue: 0,
    });
  });

  it("تغطية 0%: المريض يتحمل كل شيء", () => {
    expect(splitInsurancePayment(50000, 0)).toEqual({
      insurerDue: 0,
      patientDue: 50000,
    });
  });

  it("المشاركة الثابتة copay على المريض أولاً ثم نسبة التغطية على المتبقي", () => {
    // 115 ر.س، تغطية 70%، مشاركة ثابتة 10 ر.س:
    // المتبقي 105 ⇒ مؤمن 73.50 ⇒ مريض 115 − 73.50 = 41.50
    const s = splitInsurancePayment(11500, 7000, 1000);
    expect(s.insurerDue).toBe(7350);
    expect(s.patientDue).toBe(4150);
  });

  it("copay تتجاوز الإجمالي ⇒ تُقتصر على الإجمالي ولا شيء للمؤمن", () => {
    expect(splitInsurancePayment(5000, 9000, 99999)).toEqual({
      insurerDue: 0,
      patientDue: 5000,
    });
  });

  it("copay سالبة تُعامل كصفر", () => {
    expect(splitInsurancePayment(10000, 5000, -300)).toEqual(
      splitInsurancePayment(10000, 5000)
    );
  });

  it("نسبة تغطية خارج المدى تُقتصر: 15000 ⇒ 100%، وسالبة ⇒ 0%", () => {
    expect(splitInsurancePayment(20000, 15000).insurerDue).toBe(20000);
    expect(splitInsurancePayment(20000, -50).insurerDue).toBe(0);
  });

  it("إجمالي صفر أو سالب أو غير رقمي ⇒ صفران بلا استثناء", () => {
    expect(splitInsurancePayment(0, 7000)).toEqual({ insurerDue: 0, patientDue: 0 });
    expect(splitInsurancePayment(-100, 7000)).toEqual({ insurerDue: 0, patientDue: 0 });
    expect(splitInsurancePayment(NaN, 7000)).toEqual({ insurerDue: 0, patientDue: 0 });
  });

  it("copay غير معطاة (null/undefined) تعمل كصفر", () => {
    expect(splitInsurancePayment(11500, 7000, null)).toEqual(
      splitInsurancePayment(11500, 7000)
    );
    expect(splitInsurancePayment(11500, 7000, undefined)).toEqual(
      splitInsurancePayment(11500, 7000)
    );
  });
});

// ─── assertPolicyUsable — صلاحية البوليصة ────────────────────────────────

const TODAY = new Date("2026-10-27T10:00:00Z");

describe("assertPolicyUsable", () => {
  it("بوليصة مفعّلة بلا تاريخ انتهاء ⇒ صالحة", () => {
    expect(
      assertPolicyUsable({ isActive: true, expiryDate: null, coverageBps: 7000 }, TODAY)
    ).toBeNull();
  });

  it("تنتهي غداً ⇒ صالحة", () => {
    expect(
      assertPolicyUsable(
        { isActive: true, expiryDate: "2026-10-28T00:00:00Z", coverageBps: 7000 },
        TODAY
      )
    ).toBeNull();
  });

  it("تنتهي اليوم ⇒ صالحة حتى نهاية اليوم (قاعدة شباك الصرف)", () => {
    expect(
      assertPolicyUsable(
        { isActive: true, expiryDate: "2026-10-27T00:00:00Z", coverageBps: 7000 },
        TODAY
      )
    ).toBeNull();
  });

  it("انتهت أمس ⇒ حجب expired", () => {
    expect(
      assertPolicyUsable(
        { isActive: true, expiryDate: "2026-10-26T00:00:00Z", coverageBps: 7000 },
        TODAY
      )
    ).toBe("expired");
  });

  it("غير مفعّلة ⇒ حجب inactive حتى لو لم تنتهِ", () => {
    expect(
      assertPolicyUsable({ isActive: false, expiryDate: null, coverageBps: 7000 }, TODAY)
    ).toBe("inactive");
  });

  it("نسبة تغطية غير صحيحة (سالب/فوق 10000/كسرية) ⇒ حجب coverage", () => {
    for (const bps of [-1, 10001, 7000.5]) {
      expect(
        assertPolicyUsable({ isActive: true, expiryDate: null, coverageBps: bps }, TODAY)
      ).toBe("coverage");
    }
  });

  it("الحدان 0 و10000 صالحان", () => {
    expect(
      assertPolicyUsable({ isActive: true, expiryDate: null, coverageBps: 0 }, TODAY)
    ).toBeNull();
    expect(
      assertPolicyUsable({ isActive: true, expiryDate: null, coverageBps: 10000 }, TODAY)
    ).toBeNull();
  });
});

// ─── آلة حالات المطالبة ──────────────────────────────────────────────────

describe("آلة حالات المطالبة", () => {
  it("الانتقالات المسموحة تمر بلا خطأ", () => {
    expect(() => assertClaimTransition("pending", "approved")).not.toThrow();
    expect(() => assertClaimTransition("pending", "rejected")).not.toThrow();
    expect(() => assertClaimTransition("approved", "paid")).not.toThrow();
    expect(() => assertClaimTransition("rejected", "pending")).not.toThrow();
  });

  it("الانتقالات المحظورة ترمي خطأ عربياً", () => {
    expect(() => assertClaimTransition("approved", "pending")).toThrow();
    expect(() => assertClaimTransition("rejected", "approved")).toThrow();
    expect(() => assertClaimTransition("pending", "paid")).toThrow();
  });

  it("المحصّلة (paid) نهائية بلا رجوع", () => {
    for (const to of ["pending", "approved", "rejected", "paid"])
      expect(() => assertClaimTransition("paid", to)).toThrow();
  });

  it("حالة غير معروفة تُرفض", () => {
    expect(() => assertClaimTransition("bogus", "approved")).toThrow();
    expect(() => assertClaimTransition("pending", "bogus")).toThrow();
  });

  it("تسميات الحالات العربية مع أمان القيم الدخيلة", () => {
    expect(claimStatusLabel("pending")).toBe("بانتظار المراجعة");
    expect(claimStatusLabel("paid")).toBe("محصّلة");
    expect(claimStatusLabel(null)).toBe("—");
    expect(claimStatusLabel("bogus")).toBe("—");
  });
});

// ─── العرض ───────────────────────────────────────────────────────────────

describe("coveragePercentLabel", () => {
  it("يعرض النسبة بلا كسور حين تكتمل", () => {
    expect(coveragePercentLabel(7000)).toBe("70%");
    expect(coveragePercentLabel(10000)).toBe("100%");
    expect(coveragePercentLabel(0)).toBe("0%");
  });

  it("يعرض خانة عشرية واحدة عند الكسور", () => {
    expect(coveragePercentLabel(7250)).toBe("72.5%");
    expect(coveragePercentLabel(3333)).toBe("33.3%");
  });
});
