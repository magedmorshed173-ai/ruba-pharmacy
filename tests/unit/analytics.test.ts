import { describe, it, expect } from "vitest";
import {
  astDayKey,
  buildTrend,
  buildTopMedicines,
  buildPaymentMix,
  buildExpiryBuckets,
  buildAnalytics,
  type AnalyticsSale,
  type AnalyticsBatch,
} from "@/lib/analytics";

/** الآن المرجعي: 2026-10-29T10:00Z = 13:00 بالرياض يوم الخميس 29 أكتوبر */
const NOW = new Date("2026-10-29T10:00:00Z");

function sale(
  saleDate: string,
  netAmount: number,
  paymentMethod = "cash",
  items: { medicineName: string; quantity: number; subtotal: number; costHalalas: number }[] = []
): AnalyticsSale {
  return { saleDate: new Date(saleDate), netAmount, paymentMethod, items };
}

describe("analytics — astDayKey (حدود منتصف الليل بالرياض)", () => {
  it("البيع 21:30Z يوم 28 = اليوم التالي 29 بالرياض (علة v5.0 المصلحة لا تعود)", () => {
    expect(astDayKey("2026-10-28T21:30:00Z")).toBe("2026-10-29");
  });

  it("البيع 20:59Z يوم 28 ما زال 28 بالرياض", () => {
    expect(astDayKey("2026-10-28T20:59:00Z")).toBe("2026-10-28");
  });

  it("يقبل Date و ISO معاً بنفس النتيجة", () => {
    expect(astDayKey(new Date("2026-01-01T21:00:00Z"))).toBe("2026-01-02");
    expect(astDayKey("2026-01-01T21:00:00Z")).toBe("2026-01-02");
  });
});

describe("analytics — buildTrend (اتجاه يومي)", () => {
  it("يعيد بالضبط days نقطة شاملة اليوم الحالي، والفارغ منها أصفار", () => {
    const trend = buildTrend([], 7, NOW);
    expect(trend).toHaveLength(7);
    expect(trend[6].date).toBe("2026-10-29");
    expect(trend[0].date).toBe("2026-10-23");
    expect(trend[3]).toEqual({ date: "2026-10-26", label: "26/10", revenue: 0, profit: 0, count: 0 });
  });

  it("بيع 22:00Z يوم 22 (فجر 23 بالرياض) يقع في أول نقطة من نافذة 7 أيام", () => {
    const trend = buildTrend([sale("2026-10-22T22:00:00Z", 5000)], 7, NOW);
    expect(trend[0].count).toBe(1);
    expect(trend[0].revenue).toBe(5000);
  });

  it("الربح = الإيراد − مجموع تكلفة البنود، والفواتير الملغاة تُتخطى", () => {
    const trend = buildTrend(
      [
        sale("2026-10-29T08:00:00Z", 2100, "cash", [
          { medicineName: "أ", quantity: 1, subtotal: 1200, costHalalas: 900 },
          { medicineName: "ب", quantity: 2, subtotal: 900, costHalalas: 300 },
        ]),
        { ...sale("2026-10-29T09:00:00Z", 9999, "card", []), status: "void" },
      ],
      3,
      NOW
    );
    const today = trend[2];
    expect(today.revenue).toBe(2100);
    expect(today.profit).toBe(900);
    expect(today.count).toBe(1);
  });

  it("يعبر حدود الشهر صحيحاً (سبتمبر → أكتوبر) دون أي انزلاق", () => {
    const nowOct = new Date("2026-10-02T10:00:00Z");
    const trend = buildTrend([sale("2026-09-27T21:30:00Z", 1000)], 5, nowOct);
    expect(trend[0].date).toBe("2026-09-28"); // 21:30Z يوم 27 = فجر 28 بالرياض
    expect(trend[0].count).toBe(1);
    expect(trend[4].date).toBe("2026-10-02");
  });

  it("يقصّ النافذة إلى 1..365 مهما مُرّر", () => {
    expect(buildTrend([], 0, NOW)).toHaveLength(1);
    expect(buildTrend([], 999, NOW)).toHaveLength(365);
  });
});

describe("analytics — buildTopMedicines (أعلى الأصناف)", () => {
  const sales: AnalyticsSale[] = [
    sale("2026-10-29T08:00:00Z", 5000, "cash", [
      { medicineName: "بنادول أدفانس", quantity: 2, subtotal: 3000, costHalalas: 1800 },
      { medicineName: "أوجمنتين 1g", quantity: 1, subtotal: 2000, costHalalas: 1500 },
    ]),
    sale("2026-10-28T08:00:00Z", 3000, "card", [
      { medicineName: "بنادول أدفانس", quantity: 3, subtotal: 3000, costHalalas: 2700 },
    ]),
  ];

  it("يجمع الأصناف عبر الفواتير ويرتب تنازلياً بالإيراد", () => {
    const rows = buildTopMedicines(sales, 8, NOW);
    expect(rows[0].name).toBe("بنادول أدفانس");
    expect(rows[0].quantity).toBe(5);
    expect(rows[0].revenue).toBe(6000);
    expect(rows[0].profit).toBe(1500);
    expect(rows[1].revenue).toBe(2000);
  });

  it("يحسب الهامش مع تقريب عشري واحد ويحترم topN", () => {
    const rows = buildTopMedicines(sales, 1, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].marginPct).toBe(25); // 1500/6000 = 25%
  });
});

describe("analytics — buildPaymentMix (مزيج الدفع)", () => {
  it("يبني المزيج بالنسب المئوية مع تسميات عربية وترتيب ثابت", () => {
    const mix = buildPaymentMix(
      [
        sale("2026-10-29T08:00:00Z", 4000, "cash"),
        sale("2026-10-29T08:10:00Z", 6000, "card"),
        sale("2026-10-29T08:20:00Z", 10000, "insurance"),
        sale("2026-10-29T08:30:00Z", 5000, "wallet"), // طريقة غير معروفة
      ],
      NOW
    );
    expect(mix.map((m) => m.method)).toEqual(["cash", "card", "insurance", "wallet"]);
    expect(mix.map((m) => m.label)).toEqual(["نقدي", "شبكة", "تأمين", "أخرى"]);
    expect(mix[0].pct).toBe(16); // 4000/25000
    expect(mix[1].pct).toBe(24);
    expect(mix[2].pct).toBe(40);
  });

  it("بلا مبيعات يعيد مصفوفة فارغة (لا أصفار زائفة)", () => {
    expect(buildPaymentMix([], NOW)).toEqual([]);
  });
});

describe("analytics — buildExpiryBuckets (دلاء الصلاحية)", () => {
  /** بداية اليوم المرجعي بالرياض: 2026-10-28T21:00Z */
  function batch(isoExpiry: string, quantity: number, unitCost: number): AnalyticsBatch {
    return { expiryDate: new Date(isoExpiry), quantity, unitCost };
  }

  it("الدفعات المنتهية (قبل فجر اليوم) تدلو «منتهية» ومنتهية اليوم نفسه لا", () => {
    const buckets = buildExpiryBuckets(
      [batch("2026-10-28T00:00:00Z", 5, 1000), batch("2026-10-29T00:00:00Z", 7, 1000)],
      NOW
    );
    const expired = buckets.find((b) => b.key === "expired")!;
    expect(expired.count).toBe(1); // دفعة 28 فقط — دفعة 29 صالحة اليوم بالرياض
    expect(expired.quantity).toBe(5);
    expect(expired.costValue).toBe(5000);
  });

  it("حدود الدلاء قاطعة: 30 يوماً بالضبط في d30 وأقل من 1ms بعده في d60", () => {
    const at30 = "2026-11-27T21:00:00Z"; // startToday + 30d بالضبط
    const past30 = "2026-11-27T21:00:00.001Z";
    const buckets = buildExpiryBuckets([batch(at30, 1, 100), batch(past30, 1, 100)], NOW);
    expect(buckets.find((b) => b.key === "d30")!.count).toBe(1);
    expect(buckets.find((b) => b.key === "d60")!.count).toBe(1);
  });

  it("يجمع الكمية والقيمة المهددة بالتكلفة ويستثني الدفعات المستنزفة", () => {
    const buckets = buildExpiryBuckets(
      [batch("2026-11-20T00:00:00Z", 10, 250), batch("2026-11-25T00:00:00Z", 4, 500), batch("2026-11-21T00:00:00Z", 0, 9999)],
      NOW
    );
    const d30 = buckets.find((b) => b.key === "d30")!;
    expect(d30.count).toBe(2);
    expect(d30.quantity).toBe(14);
    expect(d30.costValue).toBe(4500);
  });

  it("كل الدلاء الستة موجودة دائماً حتى لو فارغة", () => {
    const keys = buildExpiryBuckets([], NOW).map((b) => b.key);
    expect(keys).toEqual(["expired", "d30", "d60", "d90", "d180", "later"]);
  });
});

describe("analytics — buildAnalytics (نقطة الدخول)", () => {
  it("يلخص الإيراد والربح والهامش ومتوسط السلة عبر النافذة كاملة", () => {
    const result = buildAnalytics(
      [
        sale("2026-10-29T08:00:00Z", 2100, "cash", [
          { medicineName: "أ", quantity: 1, subtotal: 2100, costHalalas: 1200 },
        ]),
        sale("2026-10-28T12:00:00Z", 3000, "card", [
          { medicineName: "ب", quantity: 1, subtotal: 3000, costHalalas: 1500 },
        ]),
      ],
      ["2026-11-20T00:00:00Z" as const].map((e) => ({ expiryDate: new Date(e), quantity: 3, unitCost: 1000 })),
      30,
      NOW
    );
    expect(result.summary.revenue).toBe(5100);
    expect(result.summary.profit).toBe(2400);
    expect(result.summary.count).toBe(2);
    expect(result.summary.marginPct).toBe(47.1); // 2400/5100 = 47.05… → 47.1
    expect(result.summary.avgBasket).toBe(2550);
    expect(result.trend).toHaveLength(30);
    expect(result.expiry.find((b) => b.key === "d30")!.quantity).toBe(3);
  });
});
