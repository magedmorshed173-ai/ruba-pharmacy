/**
 * اختبارات الطبقة التنظيمية الوطنية والمحجوزات — v3.7
 * دوال نقية 100% — بلا قاعدة بيانات.
 */
import { describe, it, expect } from "vitest";
import {
  buildRegistryAlerts,
  hasRegistryBlock,
  isRegistryHardBlock,
  parseRegistryStatus,
  REGISTRY_STATUS_LABEL,
  REGISTRY_HARD_BLOCK,
} from "@/lib/registry";
import { computeAvailable, assertAvailable } from "@/lib/reservations";

describe("السجل الوطني — تحليل الحالة", () => {
  it("يحلّ الحالات الأربع المعروفة كما هي", () => {
    expect(parseRegistryStatus("registered")).toBe("registered");
    expect(parseRegistryStatus("suspended")).toBe("suspended");
    expect(parseRegistryStatus("banned")).toBe("banned");
    expect(parseRegistryStatus("unregistered")).toBe("unregistered");
  });

  it("الحالة غير المعروفة تُعامل مسجلاً (افتراضي آمن — لا حجب زائف)", () => {
    expect(parseRegistryStatus("")).toBe("registered");
    expect(parseRegistryStatus("unknown-value")).toBe("registered");
  });

  it("الحجب التنظيمي: تعليق وحظر فقط — ليسا مسجلاً أو غير مسجل", () => {
    expect(isRegistryHardBlock("suspended")).toBe(true);
    expect(isRegistryHardBlock("banned")).toBe(true);
    expect(isRegistryHardBlock("registered")).toBe(false);
    expect(isRegistryHardBlock("unregistered")).toBe(false);
    expect(REGISTRY_HARD_BLOCK).toEqual(["suspended", "banned"]);
  });

  it("الملصقات العربية كاملة للأربع حالات", () => {
    expect(Object.keys(REGISTRY_STATUS_LABEL).sort()).toEqual(
      ["banned", "registered", "suspended", "unregistered"].sort()
    );
    expect(REGISTRY_STATUS_LABEL.suspended).toContain("معلق");
    expect(REGISTRY_STATUS_LABEL.banned).toContain("محظور");
  });
});

describe("السجل الوطني — بناء التنبيهات", () => {
  const base = {
    id: "m1",
    name: "دواء تجريبي",
    sellingPrice: 1000,
    maxRetailPrice: 1000,
  };

  it("دواء مسجل بسقف سعر محترم: لا تنبيهات", () => {
    const alerts = buildRegistryAlerts([
      { ...base, registryStatus: "registered", maxRetailPrice: 1200 },
    ]);
    expect(alerts).toEqual([]);
    expect(hasRegistryBlock(alerts)).toBe(false);
  });

  it("دواء معلق: تنبيه حاجب بلا تجاوز", () => {
    const alerts = buildRegistryAlerts([{ ...base, registryStatus: "suspended" }]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("suspended");
    expect(alerts[0].severity).toBe("hard_block");
    expect(alerts[0].blocking).toBe(true);
    expect(hasRegistryBlock(alerts)).toBe(true);
  });

  it("دواء محظور: تنبيه حاجب بصياغة قانونية", () => {
    const alerts = buildRegistryAlerts([{ ...base, registryStatus: "banned" }]);
    expect(alerts[0].kind).toBe("banned");
    expect(alerts[0].blocking).toBe(true);
    expect(alerts[0].message).toContain("محظور");
  });

  it("دواء غير مسجل: تنبيه تحذيري فقط — لا يحجب", () => {
    const alerts = buildRegistryAlerts([
      { ...base, registryStatus: "unregistered", registrationNo: null },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("unregistered");
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].blocking).toBe(false);
    expect(hasRegistryBlock(alerts)).toBe(false);
  });

  it("تجاوز سقف السعر الوطني: إنذار تسعيري غير حاجب", () => {
    const alerts = buildRegistryAlerts([
      { ...base, registryStatus: "registered", sellingPrice: 650, maxRetailPrice: 600 },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("price_cap");
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].blocking).toBe(false);
  });

  it("سلة مختلطة: الحجب التنظيمي يُكتشف رغم وجود تحذيرات سلمية", () => {
    const alerts = buildRegistryAlerts([
      { id: "a", name: "سليم", registryStatus: "registered", sellingPrice: 500, maxRetailPrice: 500 },
      { id: "b", name: "غير مسجل", registryStatus: "unregistered", sellingPrice: 500 },
      { id: "c", name: "معلق", registryStatus: "suspended", sellingPrice: 500 },
    ]);
    expect(alerts).toHaveLength(2);
    expect(alerts.map((a) => a.kind).sort()).toEqual(["suspended", "unregistered"]);
    expect(hasRegistryBlock(alerts)).toBe(true);
  });

  it("سقف سعر صفر أو مفقود لا يولّد إنذاراً", () => {
    const alerts = buildRegistryAlerts([
      { ...base, registryStatus: "registered", maxRetailPrice: null },
      { ...base, registryStatus: "registered", maxRetailPrice: 0 },
    ]);
    expect(alerts).toEqual([]);
  });
});

describe("المحجوزات — حساب المتاح", () => {
  it("المتاح = الرصيد − المحجوز", () => {
    expect(computeAvailable(100, 30)).toBe(70);
    expect(computeAvailable(100, 0)).toBe(100);
    expect(computeAvailable(100, 100)).toBe(0);
  });

  it("المحجوز الزائد عن الرصيد يُقص عند الصفر (لا سالبية)", () => {
    expect(computeAvailable(5, 12)).toBe(0);
    expect(computeAvailable(0, 3)).toBe(0);
  });

  it("القيم السالبة/الكسورية تُعامل بأمان", () => {
    expect(computeAvailable(-5, 0)).toBe(0);
    expect(computeAvailable(10.9, 2.4)).toBe(8);
  });

  it("assertAvailable يمرر المسموح ويرمي عند العجز برسالة توضح الحجز", () => {
    expect(() => assertAvailable("دواء", 5, 100, 20)).not.toThrow();
    expect(() => assertAvailable("دواء", 81, 100, 20)).toThrow(/المتاح 80/);
    expect(() => assertAvailable("دواء", 1, 50, 50)).toThrow(/محجوزة لوصفات قيد التحقق/);
  });
});
