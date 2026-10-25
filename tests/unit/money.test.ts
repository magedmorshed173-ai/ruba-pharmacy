import { describe, it, expect } from "vitest";
import {
  halalasToSar,
  sarToHalalas,
  formatSar,
  sumHalalas,
  toInt,
} from "@/lib/money";

describe("money — دقة الحسابات المالية", () => {
  it("يحوّل الهللات إلى ريال بشكل صحيح", () => {
    expect(halalasToSar(2100)).toBe("21.00");
    expect(halalasToSar(199)).toBe("1.99");
    expect(halalasToSar(0)).toBe("0.00");
  });

  it("يحوّل الريال إلى هللات دون أخطاء الفاصلة العائمة", () => {
    // 0.1 + 0.2 ≠ 0.3 في float — Decimal يحل المشكلة
    expect(sarToHalalas("0.1")).toBe(10);
    expect(sarToHalalas("19.5")).toBe(1950);
    expect(sarToHalalas(0.29)).toBe(29);
  });

  it("يجمع الهللات (أعداد صحيحة) بلا انحراف", () => {
    const total = sumHalalas(1099, 2001, 30);
    expect(total).toBe(3130);
  });

  it("formatSar يضيف العملة", () => {
    expect(formatSar(2150)).toBe("21.50 ر.س");
  });

  it("toInt يقصّ الكسور بأمان ولا يقبل NaN", () => {
    expect(toInt("3.9")).toBe(4); // toDecimalPlaces يقرب لـ 4
    expect(toInt("abc", 7)).toBe(7);
    expect(toInt(undefined)).toBe(0);
  });
});
