import { describe, it, expect } from "vitest";
import {
  parsePregnancyCategory,
  parsePregnancyStatus,
  ageInYears,
  pregnancyConflicts,
  ageRestrictionViolations,
  PREGNANCY_CATEGORY_LABEL,
} from "@/lib/patient-gate";

const med = (
  name: string,
  pregnancyCategory?: string | null,
  minAge?: number | null
) => ({ id: `m-${name}`, name, pregnancyCategory, minAge });

describe("بوابة المريض — تحليل المدخلات", () => {
  it("يحلل فئات الحمل الصالحة بكل الصيغ الشائعة", () => {
    expect(parsePregnancyCategory("X")).toBe("X");
    expect(parsePregnancyCategory("d")).toBe("D");
    expect(parsePregnancyCategory("فئة C")).toBe("C");
    expect(parsePregnancyCategory("Category B")).toBe("B");
    expect(parsePregnancyCategory("X — ممنوع")).toBe("X");
  });

  it("يرجع null للفئات الغائبة أو غير الصالحة (بلا فحص)", () => {
    expect(parsePregnancyCategory(null)).toBeNull();
    expect(parsePregnancyCategory("")).toBeNull();
    expect(parsePregnancyCategory("Z")).toBeNull();
    expect(parsePregnancyCategory("فئة")).toBeNull();
  });

  it("يحلل حالة الحمل — غير المعروف يُعامل كـ none", () => {
    expect(parsePregnancyStatus("pregnant")).toBe("pregnant");
    expect(parsePregnancyStatus("BREASTFEEDING")).toBe("breastfeeding");
    expect(parsePregnancyStatus("none")).toBe("none");
    expect(parsePregnancyStatus("حامل")).toBe("none"); // القاعدة تخزن الإنجليزية فقط
    expect(parsePregnancyStatus(undefined)).toBe("none");
  });

  it("يحسب العمر بالسنوات الكاملة صحيحاً قبل وبعد عيد الميلاد", () => {
    const now = new Date("2026-10-27T12:00:00Z");
    expect(ageInYears("2014-06-01", now)).toBe(12); // تجاوز عيد ميلاده
    expect(ageInYears("2014-12-01", now)).toBe(11); // لم يأتِ بعد
    expect(ageInYears(new Date("2026-10-27"), now)).toBe(0); // اليوم
  });

  it("يرجع null لعمر غير صالح (غياب أو مستقبل)", () => {
    expect(ageInYears(null)).toBeNull();
    expect(ageInYears("")).toBeNull();
    expect(ageInYears("2076-01-01")).toBeNull();
    expect(ageInYears("not-a-date")).toBeNull();
  });
});

describe("بوابة الحمل", () => {
  it("فئة X لحامل = حاجب — لا يُصرف إلا بتجاوز صيدلي مسؤول", () => {
    const alerts = pregnancyConflicts([med("إيزوتريتينوين", "X")], "pregnant");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("pregnancy_x");
    expect(alerts[0].severity).toBe("blocking");
    expect(alerts[0].message).toContain("ممنوع أثناء الحمل");
  });

  it("فئة D لحامل = تحذير فقط (موازنة فائدة/خطر للصيدلي)", () => {
    const alerts = pregnancyConflicts([med("فينيتوين", "D")], "pregnant");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("pregnancy_d");
    expect(alerts[0].severity).toBe("warning");
  });

  it("الفئات A/B/C لحامل بلا تنبيه — تفادي إزعاج التنبيهات", () => {
    expect(pregnancyConflicts([med("أدول", "B"), med("دواء", "C"), med("آمن", "A")], "pregnant")).toHaveLength(0);
  });

  it("المرضعة: X فقط تحذير تحققي (Hale L يختلف عن FDA) — لا حجب", () => {
    const alerts = pregnancyConflicts([med("إيزوتريتينوين", "X"), med("فينيتوين", "D")], "breastfeeding");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("pregnancy_breastfeeding");
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].note).toContain("Hale");
  });

  it("بلا حالة خاصة أو بلا فئة محفوظة = بلا تنبيهات إطلاقاً", () => {
    expect(pregnancyConflicts([med("أدول", "X")], "none")).toHaveLength(0);
    expect(pregnancyConflicts([med("أدول", "X")], null)).toHaveLength(0);
    expect(pregnancyConflicts([med("أدول", null), med("ثاني", "Z")], "pregnant")).toHaveLength(0);
    expect(pregnancyConflicts([], "pregnant")).toHaveLength(0);
  });

  it("وسميات الحمل مغطاة (A..X) — كمال التسميات", () => {
    for (const c of ["A", "B", "C", "D", "X"] as const) {
      expect(PREGNANCY_CATEGORY_LABEL[c]).toBeTruthy();
    }
  });
});

describe("بوابة العمر", () => {
  it("طفل 10 سنوات ودواء حده 16 = حاجب مع ذكر العمرين", () => {
    const alerts = ageRestrictionViolations([med("أسبرين بروتكت", null, 16)], 10);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("age_restriction");
    expect(alerts[0].severity).toBe("blocking");
    expect(alerts[0].message).toContain("10 سنة");
    expect(alerts[0].message).toContain("16 سنة");
  });

  it("عمر يساوي الحد أو يتجاوزه = بلا تنبيه", () => {
    expect(ageRestrictionViolations([med("أسبرين", null, 16)], 16)).toHaveLength(0);
    expect(ageRestrictionViolations([med("أسبرين", null, 16)], 40)).toHaveLength(0);
  });

  it("بلا تاريخ ميلاد موثق = بلا فحص (لا تخمين للعمر)", () => {
    expect(ageRestrictionViolations([med("أسبرين", null, 16)], null)).toHaveLength(0);
    expect(ageRestrictionViolations([med("أسبرين", null, 16)], undefined)).toHaveLength(0);
    expect(ageRestrictionViolations([med("أسبرين", null, 16)], -3)).toHaveLength(0);
  });

  it("أدوية بلا حد عمر محفوظ تُتجاهل — والسلة المختلطة تفحص المحفوظ فقط", () => {
    const alerts = ageRestrictionViolations(
      [med("أدول 500", null, null), med("أسبرين", null, 16), med("باراكود", null, 12)],
      10
    );
    expect(alerts).toHaveLength(2);
    expect(alerts.map((a) => a.medicine)).toEqual(["أسبرين", "باراكود"]);
  });
});
