/**
 * اختبارات الطبقة الوطنية المرخصة — v4.1 (فجوة #1)
 * دوال نقية 100% — بلا قاعدة بيانات.
 * تغطي: تحليل الترخيص، المطابقة بأولويتها، الحجب التلقائي للمسحوب،
 * قاعدة «تصعيد بلا رجوع»، خطة المزامنة، والسعر الرسمي المعتمد.
 */
import { describe, it, expect } from "vitest";
import {
  buildLicenseAlerts,
  computeSyncPlan,
  effectiveRegistryStatus,
  isLicenseHardBlock,
  LICENSE_HARD_BLOCK,
  LICENSE_STATUS_LABEL,
  normalizeArabicName,
  normalizeDosage,
  parseLicenseStatus,
  resolveNationalMatch,
  summarizeSyncPlan,
  type LicensedMedInput,
  type NationalEntryInput,
} from "@/lib/national-license";

const ENTRY = (over: Partial<NationalEntryInput> = {}): NationalEntryInput => ({
  id: "nat-1",
  registrationNo: "H5-0032",
  tradeName: "زانتاك 150",
  genericName: "رانيتيدين",
  dosage: "150 ملغ",
  barcode: null,
  licenseStatus: "licensed",
  officialPrice: null,
  ...over,
});

const MED = (over: Partial<LicensedMedInput> = {}): LicensedMedInput => ({
  id: "med-1",
  name: "زانتاك 150",
  dosage: "150 ملغ",
  barcode: null,
  registrationNo: null,
  registryStatus: "registered",
  nationalDrugId: null,
  sellingPrice: null,
  ...over,
});

describe("الترخيص الوطني — تحليل الحالة", () => {
  it("يحلّ الحالات الأربع المعروفة كما هي", () => {
    expect(parseLicenseStatus("licensed")).toBe("licensed");
    expect(parseLicenseStatus("suspended")).toBe("suspended");
    expect(parseLicenseStatus("withdrawn")).toBe("withdrawn");
    expect(parseLicenseStatus("pending")).toBe("pending");
  });

  it("الحالة غير المعروفة → قيد التقييم (إنذار بلا حجب زائف)", () => {
    expect(parseLicenseStatus("")).toBe("pending");
    expect(parseLicenseStatus("garbage!!")).toBe("pending");
    expect(parseLicenseStatus(undefined as unknown as string)).toBe("pending");
  });

  it("الحجب التلقائي: سحب وتعليق فقط — ليس مرخصاً أو قيد التقييم", () => {
    expect(isLicenseHardBlock("withdrawn")).toBe(true);
    expect(isLicenseHardBlock("suspended")).toBe(true);
    expect(isLicenseHardBlock("licensed")).toBe(false);
    expect(isLicenseHardBlock("pending")).toBe(false);
    expect(LICENSE_HARD_BLOCK).toEqual(["suspended", "withdrawn"]);
  });

  it("الملصقات العربية مكتملة للأربع حالات", () => {
    expect(Object.keys(LICENSE_STATUS_LABEL).sort()).toEqual(
      ["licensed", "pending", "suspended", "withdrawn"].sort()
    );
  });
});

describe("التطبيع العربي للمطابقة", () => {
  it("يوحّد الهمزات والتاء المربوطة والأرقام العربية والتشكيل", () => {
    expect(normalizeArabicName("أَدُول")).toBe(normalizeArabicName("ادول"));
    expect(normalizeArabicName("إبروتسول")).toBe(normalizeArabicName("ابروتسول"));
    expect(normalizeArabicName("مدرسة")).toBe(normalizeArabicName("مدرسه"));
    expect(normalizeArabicName("بانــادول")).toBe(normalizeArabicName("بانادول"));
    expect(normalizeArabicName("أدول ٥٠٠")).toBe(normalizeArabicName("ادول 500"));
    expect(normalizeArabicName("آخر ى"), "الألف المقصورة = الياء").toBe(
      normalizeArabicName("اخر ي")
    );
  });

  it("يطبّع التركيز: «500 ملغ» = «500mg» = «500 mg»", () => {
    expect(normalizeDosage("500 ملغ")).toBe("500mg");
    expect(normalizeDosage("500mg")).toBe("500mg");
    expect(normalizeDosage("500 mg")).toBe("500mg");
    expect(normalizeDosage("100 mcg")).toBe(normalizeDosage("100 ميكروغرام"));
  });
});

describe("المطابقة — أولوية صارمة", () => {
  const entries = [
    ENTRY({ id: "nat-a", registrationNo: "H5-0001", tradeName: "أدول 500", barcode: "6281001000011", dosage: "500 ملغ" }),
    ENTRY({ id: "nat-b", registrationNo: "H5-0032", tradeName: "زانتاك 150", barcode: "6281001000032", dosage: "150 ملغ" }),
  ];

  it("الأولوية 1: الربط المخزن يسبق كل شيء", () => {
    const med = MED({ nationalDrugId: "nat-b", registrationNo: "H5-0001" });
    const m = resolveNationalMatch(med, entries);
    expect(m?.method).toBe("link");
    expect(m?.entry.id).toBe("nat-b");
  });

  it("الأولوية 2: رقم الترخيص الرسمي", () => {
    const med = MED({ registrationNo: "H5-0001" });
    const m = resolveNationalMatch(med, entries);
    expect(m?.method).toBe("registration_no");
    expect(m?.entry.id).toBe("nat-a");
  });

  it("الأولوية 3: باركود GTIN", () => {
    const med = MED({ barcode: "6281001000032" });
    const m = resolveNationalMatch(med, entries);
    expect(m?.method).toBe("barcode");
    expect(m?.entry.id).toBe("nat-b");
  });

  it("الأولوية 4: الاسم الطبيعي + التركيز (بلا غموض)", () => {
    const med = MED({ name: "أدول ٥٠٠", dosage: "500 ملغ" });
    const m = resolveNationalMatch(med, entries);
    expect(m?.method).toBe("name_dosage");
    expect(m?.entry.id).toBe("nat-a");
  });

  it("الغموض بالاسم يحسمه رفض المطابقة بالاسم (الحسم للباركود/الرقم)", () => {
    const dup = [...entries, ENTRY({ id: "nat-a2", registrationNo: "H5-0002", tradeName: "أدول 500", dosage: "250 ملغ" })];
    const m = resolveNationalMatch(MED({ name: "أدول 500", dosage: "500 ملغ" }), dup);
    expect(m).toBeNull();
  });

  it("اختلاف التركيز يمنع المطابقة بالاسم", () => {
    const m = resolveNationalMatch(MED({ name: "أدول 500", dosage: "1000 ملغ" }), entries);
    expect(m).toBeNull();
  });

  it("بلا مطابقة → null", () => {
    expect(resolveNationalMatch(MED({ name: "منتج دخيل كلياً" }), entries)).toBeNull();
  });
});

describe("قاعدة التصعيد بلا رجوع", () => {
  it("سحب/تعليق وطني يرفع الحجب تلقائياً حتى لو كانت المحلية مسجلة", () => {
    expect(effectiveRegistryStatus("registered", "withdrawn")).toBe("suspended");
    expect(effectiveRegistryStatus("registered", "suspended")).toBe("suspended");
    expect(effectiveRegistryStatus("unregistered", "withdrawn")).toBe("suspended");
  });

  it("ترخيص مرخص لا يخفض حجباً محلياً أبداً (الرفع قرار يدوي موثق)", () => {
    expect(effectiveRegistryStatus("suspended", "licensed")).toBe("suspended");
    expect(effectiveRegistryStatus("banned", "licensed")).toBe("banned");
  });

  it("قيد التقييم لا يغيّر الحالة المحلية", () => {
    expect(effectiveRegistryStatus("registered", "pending")).toBe("registered");
  });
});

describe("تنبيهات الطبقة المرخصة", () => {
  it("المسحوب من السوق → hard_block برسالة السحب والسبب", () => {
    const entries = [ENTRY({ licenseStatus: "withdrawn", withdrawalReason: "شوائب NDMA" })];
    const alerts = buildLicenseAlerts([MED()], entries);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("withdrawn");
    expect(alerts[0].blocking).toBe(true);
    expect(alerts[0].message).toContain("مسحوب من السوق");
    expect(alerts[0].message).toContain("NDMA");
  });

  it("الترخيص المعلق → hard_block تلقائي", () => {
    const alerts = buildLicenseAlerts([MED()], [
      ENTRY({ licenseStatus: "suspended" }),
    ]);
    expect(alerts[0].kind).toBe("license_suspended");
    expect(alerts[0].blocking).toBe(true);
  });

  it("غير المدرج في السجل → إنذار بلا حجب", () => {
    const alerts = buildLicenseAlerts([MED({ name: "منتج دخيل" })], []);
    expect(alerts[0].kind).toBe("unlisted");
    expect(alerts[0].blocking).toBe(false);
  });

  it("قيد التقييم → إنذار بلا حجب", () => {
    const alerts = buildLicenseAlerts([MED()], [ENTRY({ licenseStatus: "pending" })]);
    expect(alerts[0].kind).toBe("license_pending");
    expect(alerts[0].blocking).toBe(false);
  });

  it("مرخص وطنياً لكن محجوب محلياً → إنذار تعارض بلا حجب ولا رجوع", () => {
    const alerts = buildLicenseAlerts(
      [MED({ registryStatus: "banned" })],
      [ENTRY({ licenseStatus: "licensed" })]
    );
    expect(alerts[0].kind).toBe("license_mismatch");
    expect(alerts[0].blocking).toBe(false);
    expect(alerts[0].message).toContain("يدوياً");
  });

  it("تجاوز السعر الرسمي المعتمد → إنذار تسعيري بالفرق المضبوط", () => {
    const alerts = buildLicenseAlerts(
      [MED({ sellingPrice: 650 })],
      [ENTRY({ officialPrice: 600 })]
    );
    const price = alerts.find((a) => a.kind === "price_cap");
    expect(price).toBeDefined();
    expect(price!.blocking).toBe(false);
    expect(price!.message).toContain("600 هللة");
    expect(price!.message).toContain("50 هللة");
  });

  it("سعر البيع تحت الرسمي → بلا تنبيه تسعيري", () => {
    const alerts = buildLicenseAlerts(
      [MED({ sellingPrice: 550 })],
      [ENTRY({ officialPrice: 600 })]
    );
    expect(alerts.find((a) => a.kind === "price_cap")).toBeUndefined();
  });

  it("رقم ترخيص محلي مخالف للرسمي → إنذار مواءمة", () => {
    const alerts = buildLicenseAlerts(
      [MED({ barcode: "6281001000032", registrationNo: "N-26-0032" })],
      [ENTRY({ barcode: "6281001000032", registrationNo: "H5-0032" })]
    );
    const mismatch = alerts.find((a) => a.kind === "license_mismatch");
    expect(mismatch).toBeDefined();
    expect(mismatch!.message).toContain("H5-0032");
  });
});

describe("خطة المزامنة — التصعيد فقط والسقف الأشد يبقى", () => {
  it("المسحوب: يربط + يصعّد إلى suspended + لا يمس الحجب الأشد", () => {
    const plan = computeSyncPlan([MED()], [
      ENTRY({ licenseStatus: "withdrawn" }),
    ]);
    expect(plan[0].actions.escalateToSuspended).toBe(true);
    expect(plan[0].effectiveStatus).toBe("suspended");
    expect(plan[0].actions.linkNationalDrug).toBe("nat-1");
  });

  it("المحظور محلياً مع مسحوب وطنياً: بلا تصعيد زائد (الحجب أشد أصلاً)", () => {
    const plan = computeSyncPlan([MED({ registryStatus: "banned" })], [
      ENTRY({ licenseStatus: "withdrawn" }),
    ]);
    expect(plan[0].actions.escalateToSuspended).toBeUndefined();
    expect(plan[0].effectiveStatus).toBe("suspended");
  });

  it("السقف الأشد المحلي يبقى — الرسمي لا يخفضه", () => {
    const plan = computeSyncPlan(
      [MED({ maxRetailPrice: 500 })],
      [ENTRY({ officialPrice: 600 })]
    );
    expect(plan[0].actions.setMaxRetailPrice).toBeUndefined();
  });

  it("بلا سقف محلي: السعر الرسمي يُعتمد سقفاً", () => {
    const plan = computeSyncPlan([MED()], [ENTRY({ officialPrice: 600 })]);
    expect(plan[0].actions.setMaxRetailPrice).toBe(600);
  });

  it("سقف محلي أرق من الرسمي يُرفع إلى الرسمي (مواءمة لا تشدد)", () => {
    const plan = computeSyncPlan(
      [MED({ maxRetailPrice: 700 })],
      [ENTRY({ officialPrice: 600 })]
    );
    expect(plan[0].actions.setMaxRetailPrice).toBe(600);
  });

  it("مواءمة رقم الترخيص المحلي مع الرقم الرسمي عند المطابقة بالباركود", () => {
    const plan = computeSyncPlan(
      [MED({ barcode: "6281001000032", registrationNo: "N-26-0032" })],
      [ENTRY({ barcode: "6281001000032", registrationNo: "H5-0032" })]
    );
    expect(plan[0].actions.setRegistrationNo).toBe("H5-0032");
  });

  it("المطابق بالرقم الرسمي: بلا مواءمة زائدة", () => {
    const plan = computeSyncPlan(
      [MED({ registrationNo: "H5-0032" })],
      [ENTRY({ registrationNo: "H5-0032" })]
    );
    expect(plan[0].actions.setRegistrationNo).toBeUndefined();
  });

  it("غير المدرج: خطة فارغة بلا تغيير بيانات + إنذار unlisted", () => {
    const plan = computeSyncPlan([MED({ name: "منتج دخيل" })], []);
    expect(plan[0].matched).toBe(false);
    expect(plan[0].actions).toEqual({});
    expect(plan[0].alerts[0].kind).toBe("unlisted");
  });

  it("مرخص وطنياً لكن محجوب محلياً: needsManualReview — لا خفض آلي", () => {
    const plan = computeSyncPlan([MED({ registryStatus: "suspended" })], [
      ENTRY({ licenseStatus: "licensed" }),
    ]);
    expect(plan[0].actions.needsManualReview).toBe(true);
    expect(plan[0].actions.escalateToSuspended).toBeUndefined();
    expect(plan[0].effectiveStatus).toBe("suspended");
  });

  it("ملخص الخطة يجمع العدادات بدقة", () => {
    const meds = [
      MED({ id: "m1", name: "زانتاك 150" }), // مسحوب → حجب
      MED({ id: "m2", name: "أدول 500" }), // مرخص → ربط + تسعير
      MED({ id: "m3", name: "منتج دخيل" }), // غير مدرج
    ];
    const entries = [
      ENTRY({ id: "nat-1", licenseStatus: "withdrawn", officialPrice: 500 }),
      ENTRY({ id: "nat-2", registrationNo: "H5-0001", tradeName: "أدول 500", officialPrice: 600 }),
    ];
    const s = summarizeSyncPlan(computeSyncPlan(meds, entries));
    expect(s.total).toBe(3);
    expect(s.matched).toBe(2);
    expect(s.unlisted).toBe(1);
    expect(s.autoBlocked).toBe(1);
    expect(s.priceAligned).toBe(2);
    expect(s.linked).toBe(2);
    expect(s.blockingAlerts).toBe(1);
  });
});
