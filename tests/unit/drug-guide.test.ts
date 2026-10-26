import { describe, it, expect } from "vitest";
import { normalizeArabic, drugMatchesQuery, rankAlternatives } from "@/lib/drug-guide";

describe("تطبيع البحث العربي — دليل الدواء", () => {
  it("يوحّد الهمزات والألف بأنواعها", () => {
    expect(normalizeArabic("أحمد إبراهيم")).toBe("احمد ابراهيم");
    expect(normalizeArabic("آمن")).toBe("امن");
    expect(normalizeArabic("ٱلدواء")).toBe("الدواء");
  });
  it("يحوّل التاء المربوطة والألف المقصورة والياء المهموزة", () => {
    expect(normalizeArabic("صيدلية")).toBe("صيدليه");
    expect(normalizeArabic("مستشفى")).toBe("مستشفي");
    expect(normalizeArabic("تائة")).toBe("تايه");
  });
  it("يقص التشكيل والتطويل", () => {
    expect(normalizeArabic("مُسَكِّن")).toBe("مسكن");
    expect(normalizeArabic("عـامـل")).toBe("عامل");
  });
  it("يصغّر اللاتيني ويوحّد المسافات", () => {
    expect(normalizeArabic("  PARACETAMOL  ")).toBe("paracetamol");
    expect(normalizeArabic("a   b")).toBe("a b");
  });
  it("النص الفارغ يبقى فارغاً", () => {
    expect(normalizeArabic("")).toBe("");
  });
});

describe("مطابقة استعلام العميل مع بطاقة الدواء", () => {
  const drug = {
    tradeName: "أموكسيل 500",
    scientificName: "amoxicillin",
    scientificNameAr: "أموكسيسيلين",
    atcCode: "J01CA04",
    atcClass: "J01C — مضاد حيوي بيتا-لاكتام",
    manufacturer: "GSK",
  };
  it("عربي بلا همزات يطابق الاسم العلمي العربي (تطبيع الطرفين)", () => {
    expect(drugMatchesQuery(drug, "اموكسيسيلين")).toBe(true);
  });
  it("جزئي لاتيني يطابق", () => {
    expect(drugMatchesQuery(drug, "amoxi")).toBe(true);
  });
  it("اسم تجاري جزئي يطابق", () => {
    expect(drugMatchesQuery(drug, "اموكسيل")).toBe(true);
  });
  it("اسم الشركة غير حساس للحالة", () => {
    expect(drugMatchesQuery(drug, "gsk")).toBe(true);
  });
  it("رمز ATC جزئي يطابق", () => {
    expect(drugMatchesQuery(drug, "j01")).toBe(true);
  });
  it("كلمة دخيلة لا تطابق", () => {
    expect(drugMatchesQuery(drug, "زولوفت")).toBe(false);
  });
  it("استعلام فارغ = مطابقة الكل", () => {
    expect(drugMatchesQuery(drug, "")).toBe(true);
  });
});

describe("ترتيب البدائل العلاجية وحساب الوفر", () => {
  const alts = [
    { id: "a", tradeName: "أدول 500", priceHalalas: 650 },
    { id: "b", tradeName: "بانادول أدفانس 500", priceHalalas: 975 },
    { id: "c", tradeName: "بارامول 500", priceHalalas: 800 },
  ];

  it("تصاعدياً بالسعر، والوفر من منظور الأغلى (975)", () => {
    const r = rankAlternatives(975, alts);
    expect(r.map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(r[0].savingsHalalas).toBe(325); // 975 - 650
    expect(r[0].cheaperByPct).toBe(33); // 325/975 ≈ 33.33% → 33
  });

  it("من منظور الأرخص (650): البدائل أغلى وفرهن سالب", () => {
    // المرجع نفسه (أدول) يُستبعد ذاتياً في الـ API — لا يُمرر ضمن القائمة
    const r = rankAlternatives(650, [alts[1], alts[2]]);
    expect(r.map((x) => x.id)).toEqual(["c", "b"]);
    expect(r[0].savingsHalalas).toBe(-150); // 650 - 800
    expect(r[0].cheaperByPct).toBe(-23); // -150/650 ≈ -23.07% → -23
  });

  it("كسر التعادل السعري أبجدياً عربياً", () => {
    const r = rankAlternatives(1000, [
      { id: "x", tradeName: "ز", priceHalalas: 500 },
      { id: "y", tradeName: "أ", priceHalalas: 500 },
    ]);
    expect(r[0].id).toBe("y");
  });

  it("قائمة فارغة تعيد قائمة فارغة", () => {
    expect(rankAlternatives(100, [])).toEqual([]);
  });

  it("سعر مرجعي صفر: نسبة 0 دون انهيار قسمة", () => {
    const r = rankAlternatives(0, [{ id: "z", tradeName: "د", priceHalalas: 50 }]);
    expect(r[0].cheaperByPct).toBe(0);
    expect(r[0].savingsHalalas).toBe(-50);
  });
});
