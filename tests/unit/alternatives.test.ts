import { describe, it, expect } from "vitest";
import {
  findTherapeuticAlternatives,
  type AlternativeCandidate,
} from "@/lib/alternatives";

const cand = (
  id: string,
  name: string,
  sellingPrice: number,
  availableQuantity: number,
  genericName = "paracetamol",
  atcClass = "N02B — مسكنات",
  extra?: Partial<AlternativeCandidate>
): AlternativeCandidate => ({
  id,
  name,
  genericName,
  sellingPrice,
  availableQuantity,
  atcClass,
  ...extra,
});

const target = {
  id: "t1",
  name: "أدول 500",
  genericName: "paracetamol",
  sellingPrice: 650,
  atcClass: "N02B — مسكنات",
};

describe("البدائل العلاجية — الترشيح", () => {
  it("يرشح البدائل من نفس الفئة العلاجية فقط", () => {
    const r = findTherapeuticAlternatives(target, [
      cand("c1", "بنادول 500", 700, 10), // نفس الفئة
      cand("c2", "أموكسيل 500", 900, 10, "amoxicillin", "J01C — مضادات حيوية"), // فئة أخرى
      cand("c3", "بروفين 400", 950, 10, "ibuprofen", "M01A — مضادات التهاب"), // فئة أخرى
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("c1");
  });

  it("لا فئة ATC محفوظة للمطلوب = بلا اقتراحات (لا تخمين خارج التصنيف)", () => {
    expect(findTherapeuticAlternatives({ ...target, atcClass: null }, [cand("c1", "ب", 700, 5)])).toHaveLength(0);
    expect(findTherapeuticAlternatives({ ...target, atcClass: "  " }, [cand("c1", "ب", 700, 5)])).toHaveLength(0);
  });

  it("يستبعد المطلوب نفسه والنافد والمحجوب تنظيمياً", () => {
    const r = findTherapeuticAlternatives(target, [
      cand("t1", "أدول 500", 650, 100), // نفس الدواء
      cand("c1", "بنادول", 700, 0), // نافد
      cand("c2", "بنادول إكسترا", 800, -3), // رصيد سالب (نظري)
    ]);
    expect(r).toHaveLength(0);
  });

  it("يحترم حد العدد الافتراضي (5) والحد المخصص", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      cand(`c${i}`, `بديل ${i}`, 700 + i, 10)
    );
    expect(findTherapeuticAlternatives(target, many)).toHaveLength(5);
    expect(findTherapeuticAlternatives(target, many, { limit: 2 })).toHaveLength(2);
  });
});

describe("البدائل العلاجية — الترتيب", () => {
  it("البديل الجنيس (نفس المادة الفعالة) يتقدم مهما كان سعره", () => {
    const r = findTherapeuticAlternatives(target, [
      cand("cheap", "جنيس آخر", 500, 10, "ibuprofen"), // أرخص لكن مادة أخرى
      cand("same", "بنادول 500", 1200, 10, "paracetamol"), // نفس المادة — أغلى
    ]);
    expect(r[0].id).toBe("same");
    expect(r[0].sameGeneric).toBe(true);
  });

  it("داخل نفس المادة أو الفئة: الأقرب سعرياً أولاً", () => {
    const r = findTherapeuticAlternatives(
      target,
      [
        cand("far", "بعيد سعراً", 2000, 10),
        cand("near", "قريب سعراً", 660, 10),
        cand("equal", "مساوٍ", 650, 10),
      ],
      { limit: 10 }
    );
    expect(r.map((x) => x.id)).toEqual(["equal", "near", "far"]);
  });

  it("يحسب فرق السعر بالهللات (سالب = أرخص من المطلوب)", () => {
    const r = findTherapeuticAlternatives(target, [
      cand("cheap", "أرخص", 500, 10),
      cand("pricey", "أغلى", 750, 10),
    ]);
    const cheap = r.find((x) => x.id === "cheap")!;
    const pricey = r.find((x) => x.id === "pricey")!;
    expect(cheap.priceDiff).toBe(-150);
    expect(pricey.priceDiff).toBe(100);
  });

  it("التعادل السعري يُحسم أبجدياً — حتمية كاملة", () => {
    const r = findTherapeuticAlternatives(
      target,
      [cand("b2", "بتا", 700, 10), cand("a1", "ألفا", 700, 10)],
      { limit: 10 }
    );
    expect(r.map((x) => x.id)).toEqual(["a1", "b2"]);
  });

  it("يحمل وسم الوصفة والتركيز للعرض في الواجهة", () => {
    const r = findTherapeuticAlternatives(target, [
      cand("rx1", "بديل بوصفة", 700, 10, "paracetamol", undefined, {
        requiresPrescription: true,
        dosage: "1 غ",
      }),
    ]);
    expect(r[0].requiresPrescription).toBe(true);
    expect(r[0].dosage).toBe("1 غ");
  });

  it("قائمة مرشحين فارغة = قائمة فارغة بلا انهيار", () => {
    expect(findTherapeuticAlternatives(target, [])).toHaveLength(0);
  });
});
