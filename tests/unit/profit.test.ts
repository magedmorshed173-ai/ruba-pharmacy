import { describe, it, expect } from "vitest";
import {
  aggregateProfit,
  profitPerMedicine,
  dailyProfitSeries,
  type ProfitSale,
} from "@/lib/profit";

const sale = (over: Partial<ProfitSale>): ProfitSale => ({
  status: "completed",
  netAmount: 0,
  saleDate: "2026-10-20T10:00:00.000Z",
  items: [],
  ...over,
});

describe("profit — تجميع الأرباح", () => {
  it("الإيراد − التكلفة = الربح، والهامش بنسبة دقيقة", () => {
    const r = aggregateProfit([
      sale({
        netAmount: 5000, // 50.00 ر.س
        items: [{ medicineName: "أ", quantity: 2, subtotal: 5000, costHalalas: 3000 }],
      }),
    ]);
    expect(r.revenue).toBe(5000);
    expect(r.cogs).toBe(3000);
    expect(r.profit).toBe(2000);
    expect(r.marginPct).toBe(40);
  });

  it("يتجاهل الفواتير الملغاة (void) كلياً", () => {
    const r = aggregateProfit([
      sale({ netAmount: 9999, items: [{ medicineName: "أ", quantity: 1, subtotal: 9999, costHalalas: 500 }] }),
      sale({ status: "void", netAmount: 50000, items: [{ medicineName: "ب", quantity: 9, subtotal: 50000, costHalalas: 9000 }] }),
    ]);
    expect(r.revenue).toBe(9999);
    expect(r.cogs).toBe(500);
  });

  it("بنود بلا لقطة تكلفة (ما قبل v3.3) تُعد غير معروفة لا صفر ربح", () => {
    const r = aggregateProfit([
      sale({
        netAmount: 10000,
        items: [
          { medicineName: "قديم", quantity: 1, subtotal: 5000, costHalalas: 0 },
          { medicineName: "جديد", quantity: 1, subtotal: 5000, costHalalas: 2000 },
        ],
      }),
    ]);
    expect(r.unknownCostItems).toBe(1);
    expect(r.knownCostItems).toBe(1);
    expect(r.cogs).toBe(2000); // لا يُفترض أن التكلفة صفر
  });

  it("فترة فارغة = أصفار بلا انهيار قسمة", () => {
    const r = aggregateProfit([]);
    expect(r.marginPct).toBe(0);
    expect(r.profit).toBe(0);
  });
});

describe("profit — ربحية لكل دواء", () => {
  it("يجمع البنود المتكررة ويرتب تنازلياً بالربح ويحدّ الصفوف", () => {
    const rows = profitPerMedicine(
      [
        sale({
          netAmount: 10000,
          items: [
            { medicineName: "عادي", quantity: 3, subtotal: 4000, costHalalas: 3000 },
            { medicineName: "نجم", quantity: 2, subtotal: 6000, costHalalas: 1000 },
          ],
        }),
        sale({
          netAmount: 2000,
          items: [{ medicineName: "نجم", quantity: 1, subtotal: 2000, costHalalas: 500 }],
        }),
      ],
      1
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("نجم");
    expect(rows[0].revenue).toBe(8000);
    expect(rows[0].profit).toBe(6500);
    expect(rows[0].marginPct).toBe(81.3);
  });
});

describe("profit — السلسلة اليومية", () => {
  it("ينشئ دلواً لكل يوم ويموضع البيع في يومه", () => {
    const days = 7;
    const series = dailyProfitSeries(
      [
        sale({
          saleDate: new Date(Date.now() - 2 * 86400000).toISOString(),
          netAmount: 3000,
          items: [{ medicineName: "أ", quantity: 1, subtotal: 3000, costHalalas: 1000 }],
        }),
      ],
      days
    );
    expect(series).toHaveLength(days);
    const withData = series.filter((d) => d.revenue > 0);
    expect(withData).toHaveLength(1);
    expect(withData[0].profit).toBe(2000);
  });

  it("البيع الملغى لا يدخل السلسلة", () => {
    const series = dailyProfitSeries(
      [
        sale({
          status: "void",
          netAmount: 5000,
          items: [{ medicineName: "أ", quantity: 1, subtotal: 5000, costHalalas: 100 }],
        }),
      ],
      7
    );
    expect(series.every((d) => d.revenue === 0)).toBe(true);
  });
});
