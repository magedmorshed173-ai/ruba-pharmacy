import { describe, it, expect } from "vitest";
import { allocateFefo, isExpired, type FefoBatch } from "@/lib/fefo";

const D = (iso: string) => new Date(iso);
const batch = (
  id: string,
  quantity: number,
  expiry: string,
  lotNumber = id
): FefoBatch => ({ id, lotNumber, quantity, expiryDate: D(expiry) });

describe("FEFO — الصرف بالأقرب انتهاءً أولاً", () => {
  const today = D("2026-06-15T10:00:00Z");

  it("يصرف من الدفعة الأقرب انتهاءً أولاً", () => {
    const batches = [
      batch("b-late", 50, "2027-01-01"),
      batch("b-soon", 30, "2026-08-01"),
    ];
    const r = allocateFefo(batches, 20, today);
    expect(r.allocations).toHaveLength(1);
    expect(r.allocations[0].batchId).toBe("b-soon");
    expect(r.allocations[0].quantity).toBe(20);
    expect(r.shortfall).toBe(0);
  });

  it("يمتد للدفعة التالية عند نفاد الأولى", () => {
    const batches = [
      batch("b1", 10, "2026-07-01"),
      batch("b2", 25, "2026-09-01"),
    ];
    const r = allocateFefo(batches, 30, today);
    expect(r.allocations[0]).toMatchObject({ batchId: "b1", quantity: 10 });
    expect(r.allocations[1]).toMatchObject({ batchId: "b2", quantity: 20 });
    expect(r.shortfall).toBe(0);
  });

  it("يستبعد الدفعات المنتهية الصلاحية كلياً", () => {
    const batches = [
      batch("expired", 100, "2026-06-15"), // تنتهي اليوم نفسه = منتهية
      batch("good", 10, "2026-12-31"),
    ];
    const r = allocateFefo(batches, 5, today);
    expect(r.allocations).toHaveLength(1);
    expect(r.allocations[0].batchId).toBe("good");
    expect(r.shortfall).toBe(0);
  });

  it("يعيد نقصاً عندما لا يكفي المخزون الصالح", () => {
    const batches = [batch("b1", 4, "2026-07-01")];
    const r = allocateFefo(batches, 10, today);
    expect(r.allocations[0].quantity).toBe(4);
    expect(r.shortfall).toBe(6);
  });

  it("يرفض الصرف إذا كانت كل الدفعات منتهية", () => {
    const batches = [batch("e1", 50, "2026-01-01"), batch("e2", 30, "2026-05-01")];
    const r = allocateFefo(batches, 5, today);
    expect(r.allocations).toHaveLength(0);
    expect(r.shortfall).toBe(5);
  });

  it("يتعامل مع طلب صفري ودفعات فارغة", () => {
    expect(allocateFefo([], 5, today).shortfall).toBe(5);
    expect(allocateFefo([batch("b", 5, "2027-01-01")], 0, today).allocations).toHaveLength(0);
  });

  it("isExpired: حدّ اليوم شامل (تنتهي اليوم = منتهية)", () => {
    expect(isExpired({ expiryDate: D("2026-06-15T00:00:00") }, today)).toBe(true);
    expect(isExpired({ expiryDate: D("2026-06-16T00:00:00") }, today)).toBe(false);
  });
});
