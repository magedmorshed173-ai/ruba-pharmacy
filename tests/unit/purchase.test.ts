import { describe, it, expect } from "vitest";
import {
  computePOTotal,
  normalizePOItems,
  mergeIntoBatch,
  autoLotNumber,
} from "@/lib/purchase";

describe("purchase — حساب إجمالي أمر الشراء", () => {
  it("يجمع الكمية × التكلفة لكل البنود بالهللات", () => {
    expect(
      computePOTotal([
        { quantity: 10, unitCost: 1250 }, // 12.50 ر.س
        { quantity: 3, unitCost: 999 }, // 9.99 ر.س
      ])
    ).toBe(15497); // 154.97 ر.س
  });

  it("يعامل القيم السالبة كصفر دون كسر المجموع", () => {
    expect(
      computePOTotal([
        { quantity: 5, unitCost: -100 },
        { quantity: -2, unitCost: 500 },
      ])
    ).toBe(0);
  });

  it("أمر فارغ = صفر", () => {
    expect(computePOTotal([])).toBe(0);
  });
});

describe("purchase — تطبيع بنود أمر الشراء", () => {
  it("يقبل بنوداً سليمة ويحسب الإجمالي خادمياً", () => {
    const r = normalizePOItems([
      { medicineId: "m1", quantity: 5, unitCost: 1000 },
      { medicineId: "m2", quantity: 2, unitCost: 2500, lotNumber: "L-9", expiryDate: "2027-06-30" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items).toHaveLength(2);
      expect(r.totalHalalas).toBe(10000);
      expect(r.items[1].lotNumber).toBe("L-9");
      expect(r.items[1].expiryDate).toBeInstanceOf(Date);
    }
  });

  it("يرفض قائمة فارغة", () => {
    expect(normalizePOItems([]).ok).toBe(false);
    expect(normalizePOItems(undefined).ok).toBe(false);
  });

  it("يرفض بنداً بلا معرّف دواء", () => {
    const r = normalizePOItems([{ quantity: 5, unitCost: 100 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("دواء");
  });

  it("يرفض الكميات غير الموجبة", () => {
    expect(normalizePOItems([{ medicineId: "m1", quantity: 0, unitCost: 100 }]).ok).toBe(false);
    expect(normalizePOItems([{ medicineId: "m1", quantity: -3, unitCost: 100 }]).ok).toBe(false);
    expect(
      normalizePOItems([{ medicineId: "m1", quantity: "خمسة", unitCost: 100 }]).ok
    ).toBe(false);
  });

  it("يرفض تكرار نفس الدواء في بندين", () => {
    const r = normalizePOItems([
      { medicineId: "m1", quantity: 5, unitCost: 100 },
      { medicineId: "m1", quantity: 2, unitCost: 100 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("لا تكرر");
  });

  it("يرفض تاريخ صلاحية غير صالح", () => {
    const r = normalizePOItems([
      { medicineId: "m1", quantity: 5, unitCost: 100, expiryDate: "بكرة الصبح" },
    ]);
    expect(r.ok).toBe(false);
  });

  it("المدخل غير الرقمي لا ينهار — fallback صفر (بعد إصلاح v3.1)", () => {
    const r = normalizePOItems([{ medicineId: "m1", quantity: 3, unitCost: "غير رقم" }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items[0].unitCost).toBe(0);
  });
});

describe("purchase — دمج استلام في دفعة قائمة", () => {
  it("يجمع الكمية ويحدّث التكلفة لآخر شراء", () => {
    const merged = mergeIntoBatch(
      { lotNumber: "L1", quantity: 10, expiryDate: new Date("2027-01-01"), unitCost: 900 },
      { quantity: 5, unitCost: 1100 }
    );
    expect(merged.quantity).toBe(15);
    expect(merged.unitCost).toBe(1100);
    expect(merged.expiryDate).toEqual(new Date("2027-01-01"));
  });

  it("تكلفة صفرية في الاستلام تُبقي التكلفة القديمة", () => {
    const merged = mergeIntoBatch(
      { lotNumber: "L1", quantity: 10, expiryDate: new Date("2027-01-01"), unitCost: 900 },
      { quantity: 5, unitCost: 0 }
    );
    expect(merged.unitCost).toBe(900);
  });
});

describe("purchase — توليد رقم التشغيلة التلقائي", () => {
  it("يصيغ الرقم من رقم الأمر وتسلسل البند", () => {
    expect(autoLotNumber(7, 0)).toBe("PO-7-01");
    expect(autoLotNumber(123, 11)).toBe("PO-123-12");
  });
});
