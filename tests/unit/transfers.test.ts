import { describe, it, expect } from "vitest";
import {
  gateSaleForBranch,
  planAccept,
  shouldRestoreBranchOnVoid,
  validateTransferInput,
  TRANSFER_STATUS_AR,
} from "@/lib/transfers";

describe("transfers — التحقق من صيغة التحويل", () => {
  const base = {
    medicineId: "med1",
    fromBranchId: null,
    toBranchId: "b1",
    quantity: 10,
  };

  it("يقبل تحويلاً سليماً من المستودع", () => {
    expect(validateTransferInput(base)).toEqual({ ok: true });
  });

  it("يقبل تحويلاً بين فرعين", () => {
    expect(validateTransferInput({ ...base, fromBranchId: "b2" })).toEqual({ ok: true });
  });

  it("يرفض كمية صفر أو سالبة أو غير رقمية", () => {
    expect(validateTransferInput({ ...base, quantity: 0 })).toMatchObject({ ok: false });
    expect(validateTransferInput({ ...base, quantity: -3 })).toMatchObject({ ok: false });
    expect(validateTransferInput({ ...base, quantity: NaN })).toMatchObject({ ok: false });
  });

  it("يرفض غياب الفرع المستلم أو الدواء", () => {
    expect(validateTransferInput({ ...base, toBranchId: "" })).toMatchObject({ ok: false });
    expect(validateTransferInput({ ...base, medicineId: "  " })).toMatchObject({ ok: false });
  });

  it("يرفض التحويل من فرع إلى نفسه", () => {
    expect(
      validateTransferInput({ ...base, fromBranchId: "b1", toBranchId: "b1" })
    ).toMatchObject({ ok: false, error: "لا يمكن التحويل من فرع إلى نفسه" });
  });

  it("يقتطع كسور الكمية ويرفض الملاحظة الطويلة", () => {
    expect(validateTransferInput({ ...base, quantity: 7.9 })).toEqual({ ok: true }); // ⇒ 7
    expect(validateTransferInput({ ...base, note: "x".repeat(301) })).toMatchObject({
      ok: false,
    });
  });
});

describe("transfers — خطة قبول التحويل", () => {
  it("من المستودع: يقبل ضمن غير المخصص", () => {
    const plan = planAccept({
      quantity: 10,
      fromWarehouse: true,
      fromBranchStock: null,
      centralQuantity: 100,
      totalAssigned: 60, // غير المخصص = 40
    });
    expect(plan).toEqual({ ok: true, ops: { targetBranchDelta: 10, sourceBranchDelta: 0 } });
  });

  it("من المستودع: يرفض عند تجاوز غير المخصص ويعرض الرقمين", () => {
    const plan = planAccept({
      quantity: 10,
      fromWarehouse: true,
      fromBranchStock: null,
      centralQuantity: 65,
      totalAssigned: 60, // غير المخصص = 5
    });
    expect(plan).toMatchObject({ ok: false });
    if (!plan.ok) expect(plan.error).toContain("5 فقط — المطلوب 10");
  });

  it("غير المخصص السالب يُعرض صفراً (انحراف مُعلن لا رقم مخل)", () => {
    const plan = planAccept({
      quantity: 1,
      fromWarehouse: true,
      fromBranchStock: null,
      centralQuantity: 50,
      totalAssigned: 70, // انحراف: مخصص > مركزي
    });
    if (!plan.ok) expect(plan.error).toContain("0 فقط");
    else expect.unreachable();
  });

  it("بين فرعين: يقبل إذا رصيد المصدر يكفي وينقل المرايا", () => {
    const plan = planAccept({
      quantity: 8,
      fromWarehouse: false,
      fromBranchStock: 15,
      centralQuantity: 100,
      totalAssigned: 40,
    });
    expect(plan).toEqual({ ok: true, ops: { targetBranchDelta: 8, sourceBranchDelta: -8 } });
  });

  it("بين فرعين: يرفض إذا رصيد المصدر لا يكفي", () => {
    const plan = planAccept({
      quantity: 8,
      fromWarehouse: false,
      fromBranchStock: 5,
      centralQuantity: 100,
      totalAssigned: 40,
    });
    expect(plan).toMatchObject({ ok: false });
    if (!plan.ok) expect(plan.error).toContain("5 فقط");
  });
});

describe("transfers — بوابة البيع من فرع مُوزَّع", () => {
  it("بلا صفوف توزيع: بيع حر كما كان (توافق كامل)", () => {
    const g = gateSaleForBranch({
      hasDistribution: false,
      saleBranchId: "b1",
      branchStock: undefined,
      quantity: 100,
      medicineName: "بانادول",
    });
    expect(g).toEqual({ allowed: true, branchDelta: 0 });
  });

  it("مع توزيع ورصيد كافٍ: يخصم من المرآة", () => {
    const g = gateSaleForBranch({
      hasDistribution: true,
      saleBranchId: "b1",
      branchStock: 12,
      quantity: 5,
      medicineName: "بانادول",
    });
    expect(g).toEqual({ allowed: true, branchDelta: -5 });
  });

  it("مع توزيع ورصيد ناقص: يرفض برسالة عربية بالرقمين", () => {
    const g = gateSaleForBranch({
      hasDistribution: true,
      saleBranchId: "b1",
      branchStock: 3,
      quantity: 5,
      medicineName: "بانادول",
    });
    expect(g.allowed).toBe(false);
    expect(g.message).toContain("المتاح في فرعك 3 فقط من 5");
  });

  it("مع توزيع وغياب صف الفرع: يعامله صفر مخصص", () => {
    const g = gateSaleForBranch({
      hasDistribution: true,
      saleBranchId: "b2",
      branchStock: undefined,
      quantity: 1,
      medicineName: "بانادول",
    });
    expect(g.allowed).toBe(false);
    expect(g.message).toContain("المتاح في فرعك 0 فقط");
  });

  it("موظف بلا فرع مع دواء مُوزَّع: رفض بإرشاد واضح", () => {
    const g = gateSaleForBranch({
      hasDistribution: true,
      saleBranchId: null,
      branchStock: 10,
      quantity: 1,
      medicineName: "بانادول",
    });
    expect(g.allowed).toBe(false);
    expect(g.message).toContain("بلا فرع معرَّف");
  });
});

describe("transfers — رجوع الإلغاء والتسميات", () => {
  it("الإلغاء يرجع لمرآة الفرع فقط مع توزيع وفرع محدد", () => {
    expect(shouldRestoreBranchOnVoid({ hasDistribution: true, saleBranchId: "b1" })).toBe(true);
  });

  it("بلا توزيع أو بلا فرع: رجوع مركزي فقط كما كان", () => {
    expect(shouldRestoreBranchOnVoid({ hasDistribution: false, saleBranchId: "b1" })).toBe(false);
    expect(shouldRestoreBranchOnVoid({ hasDistribution: true, saleBranchId: null })).toBe(false);
  });

  it("التسميات العربية الثلاث مكتملة", () => {
    expect(TRANSFER_STATUS_AR).toEqual({
      pending: "معلّق",
      accepted: "مقبول",
      cancelled: "ملغى",
    });
  });
});
