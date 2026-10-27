import { describe, it, expect } from "vitest";
import {
  computeReorderMetrics,
  groupReorderRowsBySupplier,
  type GroupableReorderRow,
} from "@/lib/reorder";

describe("إعادة الطلب الذكية — المقاييس بسرعة بيع فعلية", () => {
  it("السرعة اليومية = المبيعات ÷ أيام النافذة (تقريب 3 منازل)", () => {
    const r = computeReorderMetrics({
      quantity: 40,
      minQuantity: 10,
      soldQty: 45,
      windowDays: 30,
    });
    expect(r.dailyVelocity).toBe(1.5);
    expect(r.velocityBased).toBe(true);
  });

  it("أيام التغطية = الرصيد ÷ السرعة (تقريب عشري واحد)", () => {
    const r = computeReorderMetrics({
      quantity: 40,
      minQuantity: 5,
      soldQty: 30,
      windowDays: 30, // سرعة 1/يوم → تغطية 40 يوماً
    });
    expect(r.daysOfCover).toBe(40);
  });

  it("نقطة إعادة الطلب = السرعة × (توريد + أمان) مع تقريب لأعلى", () => {
    const r = computeReorderMetrics({
      quantity: 3,
      minQuantity: 0,
      soldQty: 15,
      windowDays: 30, // سرعة 0.5
      leadDays: 7,
      safetyDays: 7, // نقطة الطلب = 0.5 × 14 = 7
    });
    expect(r.reorderPoint).toBe(7);
    expect(r.targetStock).toBe(ceilHalf(0.5 * 37)); // 18.5 → 19
    expect(r.suggestedOrder).toBe(Math.max(1, r.targetStock - 3)); // 16
  });

  it("الرصيد فوق نقطة الطلب = لا طلب (منع التكدس)", () => {
    const r = computeReorderMetrics({
      quantity: 100,
      minQuantity: 0,
      soldQty: 30,
      windowDays: 30, // سرعة 1 — نقطة الطلب 14، الرصيد 100 فوقها
    });
    expect(r.suggestedOrder).toBe(0);
    expect(r.reorderPoint).toBe(14);
  });

  it("النزول تحت نقطة الطلب يطلب على الأقل وحدة واحدة", () => {
    const r = computeReorderMetrics({
      quantity: 1,
      minQuantity: 0,
      soldQty: 30,
      windowDays: 30, // سرعة 1 — مستهدف 37
      targetDays: 30,
      leadDays: 7,
    });
    expect(r.suggestedOrder).toBe(36); // 37 - 1
  });

  it("كسور السرعة الناتجة عن الفاصلة العائمة تُسقَّف تقريباً لأعلى نظيفاً", () => {
    const r = computeReorderMetrics({
      quantity: 0,
      minQuantity: 0,
      soldQty: 9,
      windowDays: 30, // سرعة 0.3 — 0.3×14 = 4.2 → 5
      leadDays: 7,
      safetyDays: 7,
    });
    expect(r.reorderPoint).toBe(5);
    expect(r.suggestedOrder).toBeGreaterThan(0);
  });
});

describe("إعادة الطلب الذكية — السقوط المحافظ بلا مبيعات", () => {
  it("بلا مبيعات: يملأ حتى حد التنبيه اليدوي فقط", () => {
    const r = computeReorderMetrics({
      quantity: 3,
      minQuantity: 10,
      soldQty: 0,
      windowDays: 30,
    });
    expect(r.velocityBased).toBe(false);
    expect(r.dailyVelocity).toBe(0);
    expect(r.daysOfCover).toBeNull();
    expect(r.suggestedOrder).toBe(7); // 10 - 3
  });

  it("بلا مبيعات والرصيد فوق الحد = لا طلب", () => {
    const r = computeReorderMetrics({
      quantity: 50,
      minQuantity: 10,
      soldQty: 0,
      windowDays: 30,
    });
    expect(r.suggestedOrder).toBe(0);
  });

  it("مدخلات فاسدة (سالبة/صفرية) لا تُنهي الحساب", () => {
    const r = computeReorderMetrics({
      quantity: -5,
      minQuantity: -3,
      soldQty: -10,
      windowDays: 0, // يُرفع إلى 1
    });
    expect(r.suggestedOrder).toBe(0);
    expect(Number.isFinite(r.dailyVelocity)).toBe(true);
  });
});

describe("إعادة الطلب الذكية — تجميع الموردين", () => {
  const row = (id: string, supplierId?: string | null): GroupableReorderRow & { id: string } => ({
    id,
    lastSupplierId: supplierId,
  });

  it("يجمع الصفوف حسب المورد الأخير ويحفظ ترتيب الظهور", () => {
    const groups = groupReorderRowsBySupplier([
      row("a", "s1"),
      row("b", "s2"),
      row("c", "s1"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].supplierId).toBe("s1");
    expect(groups[0].rows.map((r) => r.id)).toEqual(["a", "c"]);
    expect(groups[1].supplierId).toBe("s2");
  });

  it("بلا مورد معروف يجمع في مجموعة null مستقلة", () => {
    const groups = groupReorderRowsBySupplier([
      row("a", null),
      row("b", "s1"),
      row("c", undefined),
    ]);
    const nullGroup = groups.find((g) => g.supplierId === null);
    expect(nullGroup?.rows.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("قائمة فارغة = بلا مجموعات", () => {
    expect(groupReorderRowsBySupplier([])).toHaveLength(0);
  });
});

/** تقريب لأعلى مطابق لدلالة الحساب البشرية */
function ceilHalf(n: number): number {
  return Math.ceil(n - 1e-9);
}
