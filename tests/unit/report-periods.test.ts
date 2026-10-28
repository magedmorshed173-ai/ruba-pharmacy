import { describe, it, expect } from "vitest";
import {
  astParts,
  astDate,
  dueKinds,
  fmtAstDate,
  isSnapshotKind,
  periodFor,
} from "@/lib/report-periods";

/**
 * v5.1 — اختبارات فترات التقارير بتوقيت الرياض
 * الحقائق المرجعية: الرياض = UTC+3 ثابت؛ 2026-10-28 أربعاء؛ 2026-10-26 اثنين.
 */

describe("report-periods — النوافذ الزمنية بتوقيت السعودية", () => {
  it("astParts يحوّل اللحظة إلى مكونات الرياض (+3)", () => {
    // 2026-10-27T21:00:00Z = 2026-10-28T00:00 بالرياض
    const p = astParts(new Date("2026-10-27T21:00:00Z"));
    expect(p).toEqual({ y: 2026, m: 9, d: 28, dow: 3 }); // الأربعاء
    // 2026-10-27T20:59:59Z ما زال 27 أكتوبر بالرياض
    const q = astParts(new Date("2026-10-27T20:59:59Z"));
    expect(q.d).toBe(27);
  });

  it("astDate يبني منتصف ليل الرياض الموافق 21:00 UTC", () => {
    expect(astDate(2026, 9, 28).toISOString()).toBe("2026-10-27T21:00:00.000Z");
  });

  it("اللقطة اليومية تغطي أمس الكامل بالرياض لا أمس UTC", () => {
    // الكرون يطلق 2026-10-28T00:30 بالرياض = 2026-10-27T21:30Z
    const now = new Date("2026-10-27T21:30:00Z");
    const p = periodFor("daily", now);
    expect(p.periodStart.toISOString()).toBe("2026-10-26T21:00:00.000Z"); // أمس 00:00 الرياض
    expect(p.periodEnd.toISOString()).toBe("2026-10-27T21:00:00.000Z"); // اليوم 00:00 الرياض
    expect(p.label).toContain("اليومي");
    expect(p.label).toContain("27 أكتوبر 2026");
  });

  it("isSnapshotKind يقبل الأنواع الثلاثة ويرفض غيرها", () => {
    expect(isSnapshotKind("daily")).toBe(true);
    expect(isSnapshotKind("weekly")).toBe(true);
    expect(isSnapshotKind("monthly")).toBe(true);
    expect(isSnapshotKind("yearly")).toBe(false);
    expect(isSnapshotKind("")).toBe(false);
  });

  it("الأسبوعية تغطي اثنين→أحد المنقضي كاملاً", () => {
    // الأربعاء 28 أكتوبر 2026 — الأسبوع المنقضي: الاثنين 19 → الأحد 25 أكتوبر
    const now = new Date("2026-10-28T10:00:00Z");
    const p = periodFor("weekly", now);
    expect(p.periodStart.toISOString()).toBe("2026-10-18T21:00:00.000Z"); // اثنين 19 أكتوبر 00:00 الرياض
    expect(p.periodEnd.toISOString()).toBe("2026-10-25T21:00:00.000Z"); // اثنين 26 أكتوبر 00:00 الرياض
    expect(p.label).toContain("الأسبوعي");
    expect(p.label).toContain("19 أكتوبر 2026");
    expect(p.label).toContain("25 أكتوبر 2026");
  });

  it("الأسبوعية تعمل صحيحاً يوم الاثنين نفسه (لحظة الكرون)", () => {
    // اثنين 26 أكتوبر 2026 00:30 بالرياض = الأحد 25 أكتوبر 21:30Z
    const now = new Date("2026-10-25T21:30:00Z");
    const p = periodFor("weekly", now);
    expect(p.periodStart.toISOString()).toBe("2026-10-18T21:00:00.000Z");
    expect(p.periodEnd.toISOString()).toBe("2026-10-25T21:00:00.000Z");
  });

  it("الشهرية تغطي الشهر الميلادي السابق كاملاً", () => {
    const now = new Date("2026-10-28T10:00:00Z");
    const p = periodFor("monthly", now);
    // سبتمبر: 1 سبتمبر 00:00 الرياض → 1 أكتوبر 00:00 الرياض
    expect(p.periodStart.toISOString()).toBe("2026-08-31T21:00:00.000Z");
    expect(p.periodEnd.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(p.label).toBe("الشهري — سبتمبر 2026");
  });

  it("الشهرية تتخطى حدود السنة عند يناير", () => {
    const now = new Date("2026-01-15T10:00:00Z");
    const p = periodFor("monthly", now);
    expect(p.periodStart.toISOString()).toBe("2025-11-30T21:00:00.000Z"); // 1 ديسمبر 2025 الرياض
    expect(p.periodEnd.toISOString()).toBe("2025-12-31T21:00:00.000Z"); // 1 يناير 2026 الرياض
    expect(p.label).toBe("الشهري — ديسمبر 2025");
  });

  it("idempotent: الاستدعاء مرتين في اليوم نفسه يعطي النافذة ذاتها", () => {
    const a = periodFor("daily", new Date("2026-10-28T05:00:00Z"));
    const b = periodFor("daily", new Date("2026-10-28T18:00:00Z"));
    expect(a.periodStart).toEqual(b.periodStart);
    expect(a.periodEnd).toEqual(b.periodEnd);
  });

  it("dueKinds: الكرون اليومي يولّد اليومية دائماً", () => {
    const now = new Date("2026-10-27T21:30:00Z"); // أربعاء بالرياض
    expect(dueKinds(now)).toEqual(["daily"]);
  });

  it("dueKinds: أول الاثنين بالرياض يضيف الأسبوعية", () => {
    const now = new Date("2026-10-25T21:30:00Z"); // اثنين 00:30 الرياض
    expect(dueKinds(now)).toEqual(["daily", "weekly"]);
  });

  it("dueKinds: أول الشهر بالرياض يضيف الشهرية", () => {
    const now = new Date("2026-10-31T21:30:00Z"); // 1 نوفمبر 00:30 الرياض
    expect(dueKinds(now)).toEqual(["daily", "monthly"]);
  });

  it("dueKinds: ليلة اثنين صاحبة أول شهر تُلحق الأنواع الثلاثة", () => {
    const now = new Date("2025-11-30T21:30:00Z"); // اثنين 1 ديسمبر 00:30 الرياض
    expect(dueKinds(now)).toEqual(["daily", "weekly", "monthly"]);
  });

  it("fmtAstDate ينسّق عربياً بتوقيت الرياض", () => {
    expect(fmtAstDate(new Date("2026-10-27T21:00:00Z"))).toBe("28 أكتوبر 2026");
    expect(fmtAstDate(new Date("2026-01-01T00:00:00Z"))).toBe("1 يناير 2026");
  });
});
