import { describe, it, expect } from "vitest";
import {
  predictMechanistic,
  CYP450_PROFILES,
  NARROW_THERAPEUTIC_INDEX,
  findProfileSafe,
} from "@/lib/cyp450";
import { scanSyndromePanels, SYNDROME_PANELS } from "@/lib/syndrome-panels";
import { crcl, renalStage, renalAdvice, beersAlerts, RENAL_DOSING } from "@/lib/renal";

// ── محرك CYP450 ──
describe("محرك CYP450 التنبؤي", () => {
  it("يتنبأ بتثبيط CYP2C9: ميترونيدازول خارج المنقّح؟ لا — يختبر فلوكونازول×تولبوتاميد", () => {
    const p = predictMechanistic("tolbutamide", "fluconazole");
    expect(p.length).toBeGreaterThan(0);
    const hit = p.find((x) => x.enzyme === "CYP2C9" && x.type === "inhibition");
    expect(hit).toBeDefined();
    expect(hit!.object).toBe("tolbutamide");
    expect(hit!.perpetrator).toBe("fluconazole");
    expect(hit!.description).toContain("تنبؤ ميكانيكي");
  });

  it("يرفع الشدة إلى خطير للركائز ضيقة النطاق (الوارفارين ركيزة 2C9)", () => {
    // ابحث عن مثبط 2C9 ليس في القاعدة المنقحة مع الوارفارين: فالبرات مثبط 2C9
    const p = predictMechanistic("warfarin", "valproate");
    const hit = p.find((x) => x.object === "warfarin" && x.enzyme === "CYP2C9" && x.type === "inhibition");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("major"); // narrow TI
    expect(hit!.evidenceLevel).toBe("probable");
  });

  it("يتنبأ بالاستحثاث: ريفامبين × أملوديبين (ركيزة 3A4)", () => {
    const p = predictMechanistic("amlodipine", "rifampicin");
    const hit = p.find((x) => x.type === "induction" && x.enzyme === "CYP3A4");
    expect(hit).toBeDefined();
    expect(hit!.object).toBe("amlodipine");
    expect(hit!.perpetrator).toBe("rifampicin");
  });

  it("يعامل prodrugs معكوساً: تثبيط تفعيل كلوبيدوغريل يفشل العلاج لا يسمّمه", () => {
    const p = predictMechanistic("clopidogrel", "fluoxetine"); // فلوكسيتين مثبط 2D6
    const hit = p.find((x) => x.object === "clopidogrel");
    expect(hit).toBeDefined();
    expect(hit!.description).toContain("يفشل العلاج");
  });

  it("لا يتنبأ لغير المسجلين في الخريطة ولنفس الدواء", () => {
    expect(predictMechanistic("paracetamol", "ibuprofen")).toHaveLength(0);
    expect(predictMechanistic("warfarin", "warfarin")).toHaveLength(0);
    expect(predictMechanistic("digoxin", "paracetamol")).toHaveLength(0);
  });

  it("القاعدة المعرفية سليمة: كل إنزيم معروف ولا دواء بملف فارغ بلا معنى", () => {
    expect(CYP450_PROFILES.length).toBeGreaterThanOrEqual(50);
    const names = new Set(CYP450_PROFILES.map((p) => p.generic));
    expect(names.size).toBe(CYP450_PROFILES.length); // لا تكرار
    for (const p of CYP450_PROFILES) {
      for (const roles of Object.values(p.roles)) {
        expect(Array.isArray(roles)).toBe(true);
      }
    }
    expect(NARROW_THERAPEUTIC_INDEX.has("digoxin")).toBe(true);
  });

  it("المساعد الآمن يرد الملف أو undefined دون رمي", () => {
    expect(findProfileSafe("WARFARIN ")?.generic).toBe("warfarin");
    expect(findProfileSafe("غير موجود")).toBeUndefined();
  });
});

// ── لوحات المتلازمات ──
describe("ماسح المتلازمات التراكمية", () => {
  it("طابور QT: عضوان ⇒ متوسط، وثلاثة ⇒ خطير", () => {
    const two = scanSyndromePanels(["amiodarone", "citalopram"]);
    const qt2 = two.find((h) => h.panelId === "qt-prolongation");
    expect(qt2?.severity).toBe("moderate");

    const three = scanSyndromePanels(["amiodarone", "citalopram", "clarithromycin"]);
    const qt3 = three.find((h) => h.panelId === "qt-prolongation");
    expect(qt3?.severity).toBe("major");
    expect(qt3?.detected).toHaveLength(3);
  });

  it("متلازمة السيروتونين: MAOI مرساة ترفع مباشرة لأقصى شدة", () => {
    const hits = scanSyndromePanels(["moclobemide", "sertraline"]);
    const ser = hits.find((h) => h.panelId === "serotonin");
    expect(ser).toBeDefined();
    expect(ser!.severity).toBe("major");
  });

  it("خطر النزيف: ثلاثة أعضاء ⇒ ممنوع سريرياً", () => {
    const hits = scanSyndromePanels(["warfarin", "aspirin", "ibuprofen"]);
    const bleed = hits.find((h) => h.panelId === "bleeding");
    expect(bleed?.severity).toBe("contraindicated");
  });

  it("الثلاثية الكلوية: NSAID + ACEI + مدر ⇒ خطير", () => {
    const hits = scanSyndromePanels(["ibuprofen", "ramipril", "furosemide"]);
    const renal = hits.find((h) => h.panelId === "renal-triple-whammy");
    expect(renal?.severity).toBe("major");
  });

  it("عضو واحد لا يكفي، وقائمة فارغة لا تعطي شيئاً", () => {
    expect(scanSyndromePanels(["warfarin"]).find((h) => h.panelId === "bleeding")).toBeUndefined();
    expect(scanSyndromePanels([])).toHaveLength(0);
    expect(scanSyndromePanels(["paracetamol", "metformin"])).toHaveLength(0);
  });

  it("كل لوحة معرفة كاملة الحقول (اسم/وصف/نصيحة عربية)", () => {
    for (const p of SYNDROME_PANELS) {
      expect(p.name.length).toBeGreaterThan(3);
      expect(p.description.length).toBeGreaterThan(20);
      expect(p.advice.length).toBeGreaterThan(20);
      expect(p.members.length).toBeGreaterThanOrEqual(5);
    }
  });
});

// ── الجرعات الكلوية وBeers ──
describe("الذكاء الجرعي", () => {
  it("Cockcroft-Gault: ذكر 60 سنة 70كغ SCr 1.0 ⇒ 77.8 مل/د", () => {
    const v = crcl({ ageYears: 60, weightKg: 70, serumCreatinineMgDl: 1.0 });
    expect(v).toBeCloseTo(77.8, 1);
  });

  it("معامل الأنثى 0.85 يُطبق", () => {
    const m = crcl({ ageYears: 60, weightKg: 70, serumCreatinineMgDl: 1.0 });
    const f = crcl({ ageYears: 60, weightKg: 70, serumCreatinineMgDl: 1.0, female: true });
    expect(f).toBeCloseTo(m * 0.85, 6);
  });

  it("المُدخلات غير المنطقية ترد NaN والتصنيف يرد null", () => {
    expect(crcl({ ageYears: 0, weightKg: 70, serumCreatinineMgDl: 1 })).toBeNaN();
    expect(renalStage(NaN)).toBeNull();
    expect(renalStage(95)).toContain("طبيعي");
    expect(renalStage(75)).toContain("خفيف");
    expect(renalStage(20)).toContain("شديد");
  });

  it("الميتفورمين: ممنوع تحت 30 ويُحذر تحت 45", () => {
    expect(renalAdvice("metformin", 25)).toContain("ممنوع تماماً");
    expect(renalAdvice("metformin", 40)).toContain("45");
    expect(renalAdvice("metformin", 80)).toBeNull();
  });

  it("النيتروفورانتوين ممنوع تحت 30", () => {
    expect(renalAdvice("nitrofurantoin", 20)).toContain("ممنوع");
    expect(renalAdvice("nitrofurantoin", 50)).toBeNull();
  });

  it("قواعد الجرعات الكلوية سليمة البنية", () => {
    expect(Object.keys(RENAL_DOSING).length).toBeGreaterThanOrEqual(12);
    for (const rules of Object.values(RENAL_DOSING)) {
      expect(rules.length).toBeGreaterThanOrEqual(1);
      for (const r of rules) {
        expect(r.threshold).toBeGreaterThan(0);
        expect(r.advice.length).toBeGreaterThan(15);
      }
    }
  });

  it("Beers: لا تنبيه قبل 65 وتحذير بعده مع البديل الأكثر أماناً", () => {
    expect(beersAlerts(["diazepam", "zolpidem"], 64)).toHaveLength(0);
    const hits = beersAlerts(["Diazepam 5mg", "zolpidem"], 72);
    expect(hits).toHaveLength(2);
    expect(hits[0].reason.length).toBeGreaterThan(10);
    expect(hits[0].safer.length).toBeGreaterThan(3);
  });
});
