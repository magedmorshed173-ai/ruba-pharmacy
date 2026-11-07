import { describe, expect, it } from "vitest";
import {
  checkCentralInvariant,
  classifyRow,
  computeVariance,
  newStockCountNumber,
  parseCountedQty,
  STOCK_COUNT_MAX_BATCHES,
  STOCK_COUNT_MAX_SUBMIT,
  STOCK_COUNT_STATUS_AR,
  STOCK_COUNT_STATUS_CLASS,
  STOCK_COUNT_STATUSES,
  validateStartInput,
  VARIANCE_KIND_AR,
  type VarianceInputRow,
} from "@/lib/stocktake";

describe("stocktake — أرقام الجلسات", () => {
  it("رقم الجلسة بالصيغة SC-YYYYMMDD-6محارف (بلا أحرف ملبسة: I L O 0 1)", () => {
    const n = newStockCountNumber();
    expect(n).toMatch(/^SC-\d{8}-[A-HJ-NP-Z2-9]{6}$/);
  });

  it("التاريخ بتوقيت الرياض — 21:30Z أيوم 27 = يوم 28 بالرياض", () => {
    const n = newStockCountNumber(new Date("2026-10-27T21:30:00Z"));
    expect(n.startsWith("SC-20261028-")).toBe(true);
  });

  it("قبل منتصف ليل الرياض يبقى في يومه", () => {
    const n = newStockCountNumber(new Date("2026-10-27T20:59:59Z"));
    expect(n.startsWith("SC-20261027-")).toBe(true);
  });

  it("نداءان متتاليان يعطيان رقمين مختلفين", () => {
    const a = new Set(Array.from({ length: 50 }, () => newStockCountNumber()));
    expect(a.size).toBe(50);
  });
});

describe("stocktake — تحقق المدخلات", () => {
  it("ملاحظة غائبة أو فارغة مقبولة", () => {
    expect(validateStartInput({})).toEqual({ ok: true });
    expect(validateStartInput({ note: null })).toEqual({ ok: true });
    expect(validateStartInput({ note: "" })).toEqual({ ok: true });
  });

  it("ملاحظة حتى 300 حرف مقبولة وأطول مرفوضة", () => {
    expect(validateStartInput({ note: "ا".repeat(300) })).toEqual({ ok: true });
    expect(validateStartInput({ note: "ا".repeat(301) }).ok).toBe(false);
  });

  it("parseCountedQty: الغياب = تخطٍّ مقصود (null)", () => {
    expect(parseCountedQty(null)).toBeNull();
    expect(parseCountedQty(undefined)).toBeNull();
    expect(parseCountedQty("")).toBeNull();
  });

  it("parseCountedQty: أعداد صحيحة سليمة (رقم أو نص)", () => {
    expect(parseCountedQty(0)).toBe(0);
    expect(parseCountedQty(42)).toBe(42);
    expect(parseCountedQty("42")).toBe(42);
    expect(parseCountedQty(" 7 ")).toBe(7);
    expect(parseCountedQty(1_000_000)).toBe(1_000_000);
  });

  it("parseCountedQty: المرفوض = false", () => {
    expect(parseCountedQty(-1)).toBe(false);
    expect(parseCountedQty(1.5)).toBe(false);
    expect(parseCountedQty("abc")).toBe(false);
    expect(parseCountedQty(Number.NaN)).toBe(false);
    expect(parseCountedQty(1_000_001)).toBe(false);
    expect(parseCountedQty(Infinity)).toBe(false);
  });
});

describe("stocktake — تصنيف الفروقات", () => {
  it("مطابق: صفر فرق وصفر قيمة", () => {
    expect(classifyRow({ systemQty: 10, countedQty: 10, unitCost: 500 })).toEqual({
      kind: "match",
      delta: 0,
      costDelta: 0,
    });
  });

  it("زيادة: فرق موجب بقيمة التكلفة", () => {
    expect(classifyRow({ systemQty: 10, countedQty: 13, unitCost: 500 })).toEqual({
      kind: "increase",
      delta: 3,
      costDelta: 1500,
    });
  });

  it("عجز: فرق سالب بقيمة سالبة", () => {
    expect(classifyRow({ systemQty: 10, countedQty: 8, unitCost: 250 })).toEqual({
      kind: "decrease",
      delta: -2,
      costDelta: -500,
    });
  });

  it("لم يُعدّ: بلا فرق ولا قيمة مهما كان الرصيد", () => {
    const r = classifyRow({ systemQty: 99, countedQty: null, unitCost: 999 });
    expect(r.kind).toBe("skipped");
    expect(r.delta).toBe(0);
    expect(r.costDelta).toBe(0);
  });
});

describe("stocktake — ملخص الفروقات", () => {
  const rows: VarianceInputRow[] = [
    { systemQty: 10, countedQty: 10, unitCost: 100 }, // مطابق
    { systemQty: 10, countedQty: 13, unitCost: 500 }, // زيادة +3 (+1500)
    { systemQty: 10, countedQty: 8, unitCost: 250 }, // عجز −2 (−500)
    { systemQty: 4, countedQty: null, unitCost: 700 }, // تخطٍّ
  ];

  it("الأعداد والصافيات تُجمع بدقة", () => {
    const { totals, rows: out } = computeVariance(rows);
    expect(out).toHaveLength(4);
    expect(totals.matched).toBe(1);
    expect(totals.increased).toBe(1);
    expect(totals.decreased).toBe(1);
    expect(totals.skipped).toBe(1);
    expect(totals.counted).toBe(3);
    expect(totals.netQtyDelta).toBe(1); // +3 −2
    expect(totals.netCostDelta).toBe(1000); // +1500 −500
  });

  it("جلسة فارغة = ملخص صفري", () => {
    const { totals } = computeVariance([]);
    expect(totals.counted).toBe(0);
    expect(totals.netQtyDelta).toBe(0);
    expect(totals.netCostDelta).toBe(0);
  });

  it("الزيادات والعجوزات على نفس الدواء تُحسم صافياً (لا تتعارض)", () => {
    const { totals } = computeVariance([
      { systemQty: 5, countedQty: 9, unitCost: 100 },
      { systemQty: 5, countedQty: 2, unitCost: 100 },
    ]);
    expect(totals.increased).toBe(1);
    expect(totals.decreased).toBe(1);
    expect(totals.netQtyDelta).toBe(1); // +4 −3
  });
});

describe("stocktake — ثبات التوزيع (المخصص ≤ المركزي)", () => {
  it("مركزي يغطي المخصص بعد الخصم ⇒ سليم", () => {
    const g = checkCentralInvariant({ centralQuantity: 20, delta: -5, totalAssigned: 15 });
    expect(g.ok).toBe(true);
    expect(g.headroom).toBe(0); // حد التساوي مقبول
  });

  it("خصم يخالف الثابت ⇒ مرفوض برأس مال سالب", () => {
    const g = checkCentralInvariant({ centralQuantity: 20, delta: -6, totalAssigned: 15 });
    expect(g.ok).toBe(false);
    expect(g.headroom).toBe(-1);
  });

  it("زيادة الجرد لا تخالف الثابت أبداً", () => {
    const g = checkCentralInvariant({ centralQuantity: 10, delta: 40, totalAssigned: 15 });
    expect(g.ok).toBe(true);
    expect(g.headroom).toBe(35);
  });
});

describe("stocktake — مرجعيات العرض", () => {
  it("الحالات الثلاث بتسميات وألوان كاملة", () => {
    expect([...STOCK_COUNT_STATUSES]).toEqual(["open", "closed", "cancelled"]);
    for (const s of STOCK_COUNT_STATUSES) {
      expect(STOCK_COUNT_STATUS_AR[s]).toBeTruthy();
      expect(STOCK_COUNT_STATUS_CLASS[s]).toBeTruthy();
      expect(VARIANCE_KIND_AR[s === "open" ? "match" : s === "closed" ? "increase" : "decrease"]).toBeTruthy();
    }
  });

  it("حدود الحماية موثقة", () => {
    expect(STOCK_COUNT_MAX_BATCHES).toBe(5000);
    expect(STOCK_COUNT_MAX_SUBMIT).toBe(2000);
  });
});
