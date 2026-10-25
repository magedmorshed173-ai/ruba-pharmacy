import { describe, it, expect } from "vitest";
import {
  allergyConflicts,
  duplicateTherapyGroups,
  normalizePair,
  parseSeverity,
  exceedsMaxDailyDose,
  SEVERITY_RANK,
  SEVERITY_LABEL,
} from "@/lib/clinical";

describe("المحرك السريري — مطابقة الحساسية", () => {
  const meds = [
    { name: "أموكسيسيلين كبسولات", genericName: "amoxicillin" },
    { name: "أوجمنتين", genericName: "amoxicillin/clavulanic" },
    { name: "أسبرين بروتكت", genericName: "aspirin" },
    { name: "باراسيتامول أدفيل", genericName: "paracetamol" },
    { name: "أزيثرومايسين", genericName: "azithromycin" },
  ];

  it("يرصد حساسية البنسلين مع أموكسيسيلين (متقاطع بالعائلة)", () => {
    const hits = allergyConflicts("بنسلين", [meds[0]]);
    expect(hits).toHaveLength(1);
    expect(hits[0].familyAr).toContain("البنسلين");
    expect(hits[0].medicine).toBe("أموكسيسيلين كبسولات");
    expect(hits[0].note.length).toBeGreaterThan(10);
  });

  it("يرصد الحساسية المتقاطعة: أسبرين ← إيبوبروفين من نفس عائلة NSAID", () => {
    const hits = allergyConflicts("أسبرين", [{ name: "إيبوبروفين", genericName: "ibuprofen" }]);
    expect(hits).toHaveLength(1);
    expect(hits[0].familyAr).toContain("ستيرويدية");
  });

  it("يتعامل مع قائمة حساسيات متعددة بفواصل عربية", () => {
    const hits = allergyConflicts("بنسلين، لاكتوز", [meds[0]]);
    expect(hits).toHaveLength(1);
  });

  it("لا يعيد شيئاً بدون حساسيات أو بدون تطابق", () => {
    expect(allergyConflicts(null, meds)).toHaveLength(0);
    expect(allergyConflicts("", meds)).toHaveLength(0);
    expect(allergyConflicts("بنسلين", [meds[4]])).toHaveLength(0); // أزيثرومايسين ليس بنسليناً
  });

  it("غير حساس لحالة الأحرف الإنجليزية", () => {
    const hits = allergyConflicts("Penicillin", [meds[1]]); // أوجمنتين
    expect(hits).toHaveLength(1);
  });
});

describe("المحرك السريري — العلاج المكرر (ATC)", () => {
  it("يجمع مسكنين من نفس الفئة داخل السلة", () => {
    const groups = duplicateTherapyGroups([
      { id: "1", name: "إيبوبروفين", atcClass: "M01A — مضادات التهاب غير ستيرويدية" },
      { id: "2", name: "ديكلوفيناك جيل", atcClass: "M01A — مضادات التهاب غير ستيرويدية" },
      { id: "3", name: "وارفارين", atcClass: "B01AC — مضاد تجلط" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].names).toEqual(["إيبوبروفين", "ديكلوفيناك جيل"]);
  });

  it("يتجاهل الفئة الفردية والمفقودة", () => {
    const groups = duplicateTherapyGroups([
      { id: "1", name: "وارفارين", atcClass: "B01AC — مضاد تجلط" },
      { id: "2", name: "باراسيتامول" }, // بلا فئة
    ]);
    expect(groups).toHaveLength(0);
  });

  it("لا يحسب نفس الدواء مرتين كمكرر", () => {
    const groups = duplicateTherapyGroups([
      { id: "1", name: "إيبوبروفين", atcClass: "M01A" },
      { id: "1", name: "إيبوبروفين", atcClass: "M01A" },
    ]);
    expect(groups).toHaveLength(0);
  });
});

describe("المحرك السريري — شدة التداخلات والأزواج", () => {
  it("يرتب الشدة: ممنوع سريرياً > خطير > متوسط > بسيط", () => {
    expect(SEVERITY_RANK.contraindicated).toBeGreaterThan(SEVERITY_RANK.major);
    expect(SEVERITY_RANK.major).toBeGreaterThan(SEVERITY_RANK.moderate);
    expect(SEVERITY_RANK.moderate).toBeGreaterThan(SEVERITY_RANK.minor);
    expect(SEVERITY_LABEL.contraindicated).toBe("ممنوع سريرياً");
  });

  it("يحل قيم الشدة غير المعروفة إلى متوسط بأمان", () => {
    expect(parseSeverity("major")).toBe("major");
    expect(parseSeverity("contraindicated")).toBe("contraindicated");
    expect(parseSeverity("whatever")).toBe("moderate");
  });

  it("يوحّد زوج التداخل بأمرين معكوسين", () => {
    expect(normalizePair("Warfarin", "aspirin")).toEqual(["aspirin", "warfarin"]);
    expect(normalizePair("aspirin", "warfarin")).toEqual(normalizePair("warfarin", "aspirin"));
  });
});

describe("المحرك السريري — فحص الجرعة القصوى", () => {
  it("يحذر عند تجاوز الحد الأقصى اليومي", () => {
    expect(exceedsMaxDailyDose(6, 7)).toBe(true);
    expect(exceedsMaxDailyDose(6, 6)).toBe(false);
    expect(exceedsMaxDailyDose(null, 100)).toBe(false);
    expect(exceedsMaxDailyDose(0, 10)).toBe(false);
  });
});
