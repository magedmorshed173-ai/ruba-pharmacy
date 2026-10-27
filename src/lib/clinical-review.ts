/**
 * المراجعة السريرية المركزية — تُستخدم من مساري /api/interactions/check و /api/sales
 * تجمع: تداخلات السلة، تداخلات أدوية المريض المزمنة، تعارضات الحساسية، العلاج المكرر.
 */
import { db } from "@/lib/db";
import {
  allergyConflicts,
  duplicateTherapyGroups,
  normalizePair,
  parseSeverity,
  SEVERITY_RANK,
  type AllergyHit,
  type DuplicateGroup,
  type InteractionSeverity,
} from "@/lib/clinical";
import {
  buildLicenseAlerts,
  type LicensedMedInput,
  type NationalEntryInput,
} from "@/lib/national-license";
import {
  ageInYears,
  ageRestrictionViolations,
  pregnancyConflicts,
  type GateAlert,
} from "@/lib/patient-gate";
import {
  buildRegistryAlerts,
  hasRegistryBlock,
  type RegistryAlert,
} from "@/lib/registry";
import {
  predictMechanistic,
  type MechanisticPrediction,
} from "@/lib/cyp450";
import {
  scanSyndromePanels,
  type SyndromePanelHit,
} from "@/lib/syndrome-panels";
import {
  beersAlerts,
  type BeersAlert,
} from "@/lib/renal";

export interface ClinicalHit {
  genericA: string;
  genericB: string;
  severity: InteractionSeverity;
  description: string;
  mechanism: string | null;
  clinicalEffect: string | null;
  management: string | null;
  evidenceLevel: string | null;
  source: string | null;
  onset: string | null;
  context: "cart" | "patient";
}

export interface ClinicalReview {
  interactions: ClinicalHit[];
  allergyAlerts: AllergyHit[];
  duplicateTherapies: DuplicateGroup[];
  /** تنبيهات السجل الوطني (تعليق/حظر/غير مسجل/سقف سعر) — v3.7 */
  registryAlerts: RegistryAlert[];
  /** حجب تنظيمي مطلق (معلق/محظور) — لا يقبل تجاوزاً سريرياً */
  registryBlocking: boolean;
  /** بوابة الحمل (v4.3) — X حاجب، D تحذير، رضاعة X تحذير تحققي */
  pregnancyAlerts: GateAlert[];
  /** بوابة العمر (v4.3) — العمر دون الحد الأدنى المعتمد حاجب */
  ageAlerts: GateAlert[];
  /** v5.0 — تنبؤات CYP450 الميكانيكية (نمط Medi-Span) — ثنائيات غير منقّحة */
  mechanisticPredictions: MechanisticPrediction[];
  /** v5.0 — لوحات المخاطر التراكمية (نمط Epocrates) — QT/سيروتونين/نزيف/… */
  syndromePanels: SyndromePanelHit[];
  /** v5.0 — معايير Beers لكبار السن (65+) */
  beersAlerts: BeersAlert[];
  highestSeverity: InteractionSeverity | null;
  /** ممنوع سريرياً أو تعارض حساسية — يستلزم تجاوزاً مسؤولاً للإتمام */
  blocking: boolean;
  checkedGenerics: string[];
  patient: { id: string; name: string; allergies: string | null } | null;
}

export interface ReviewMeds {
  id?: string;
  name: string;
  genericName: string;
  atcClass?: string | null;
  registryStatus?: string | null;
  registrationNo?: string | null;
  sellingPrice?: number | null;
  maxRetailPrice?: number | null;
  // v4.1 — الطبقة الوطنية المرخصة (مفاتيح المطابقة مع السجل المرخص)
  barcode?: string | null;
  dosage?: string | null;
  nationalDrugId?: string | null;
  // v4.3 — بوابة المريض الخاصة (حمل/عمر)
  pregnancyCategory?: string | null;
  minAge?: number | null;
}

function mapHit(
  h: {
    genericA: string;
    genericB: string;
    severity: string;
    description: string;
    mechanism: string | null;
    clinicalEffect: string | null;
    management: string | null;
    evidenceLevel: string | null;
    source: string | null;
    onset: string | null;
  },
  context: "cart" | "patient"
): ClinicalHit {
  return {
    genericA: h.genericA,
    genericB: h.genericB,
    severity: parseSeverity(h.severity),
    description: h.description,
    mechanism: h.mechanism,
    clinicalEffect: h.clinicalEffect,
    management: h.management,
    evidenceLevel: h.evidenceLevel,
    source: h.source,
    onset: h.onset,
    context,
  };
}

/**
 * مراجعة سريرية كاملة لسلة بيع مقابل بيانات مريض (اختياري).
 * @param cartMeds أدوية السلة (مادة فعالة + فئة علاجية)
 * @param patientId معرف المريض إن اختير — يُقرأ من قاعدة البيانات
 */
export async function reviewCartClinical(
  cartMeds: ReviewMeds[],
  patientId?: string
): Promise<ClinicalReview> {
  const cartGenerics = Array.from(
    new Set(cartMeds.map((m) => m.genericName.toLowerCase()).filter(Boolean))
  );

  // v4.4.1 (P0): تعبير شرطي واحد — النوع يستنتج Patient | null بدل null المعلنة
  const patient = patientId
    ? await db.patient.findUnique({ where: { id: patientId } })
    : null;

  const patientGenerics = String(patient?.chronicMedications ?? "")
    .split(/[,،;؛]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const interactions: ClinicalHit[] = [];

  if (cartGenerics.length > 0) {
    const cartHits = await db.drugInteraction.findMany({
      where: {
        isActive: true,
        genericA: { in: cartGenerics },
        genericB: { in: cartGenerics },
      },
    });
    for (const h of cartHits) {
      if (h.genericA.toLowerCase() === h.genericB.toLowerCase()) continue;
      interactions.push(mapHit(h, "cart"));
    }

    if (patientGenerics.length > 0) {
      const patientHits = await db.drugInteraction.findMany({
        where: {
          isActive: true,
          AND: [
            {
              OR: [
                { genericA: { in: cartGenerics } },
                { genericB: { in: cartGenerics } },
              ],
            },
            {
              OR: [
                { genericA: { in: patientGenerics } },
                { genericB: { in: patientGenerics } },
              ],
            },
          ],
        },
      });
      for (const h of patientHits) {
        if (h.genericA.toLowerCase() === h.genericB.toLowerCase()) continue;
        interactions.push(mapHit(h, "patient"));
      }
    }
  }

  const allergyAlerts = patient ? allergyConflicts(patient.allergies, cartMeds) : [];
  // أدوية بلا id تحصل على مفتاح احتياطي حتى لا تنهار تجميعات العلاج المكرر
  const duplicateTherapies = duplicateTherapyGroups(
    cartMeds.map((m, i) => ({
      id: m.id ?? `anon-${i}`,
      name: m.name,
      atcClass: m.atcClass,
    }))
  );

  // الطبقة التنظيمية الوطنية — v3.7 (فوق الطبقة السريرية)
  const registryAlerts = buildRegistryAlerts(
    cartMeds.map((m) => ({
      id: m.id,
      name: m.name,
      registryStatus: m.registryStatus ?? undefined,
      registrationNo: m.registrationNo,
      sellingPrice: m.sellingPrice ?? 0,
      maxRetailPrice: m.maxRetailPrice,
    }))
  );

  // الطبقة الوطنية المرخصة — v4.1: ترخيص SFDA + سحب تلقائي للمسحوب من السوق
  // (المطابقة ضد السجل المرخص — المسحوب/المعلق يحجب بلا تجاوز)
  const nationalEntries: NationalEntryInput[] = await db.nationalDrug.findMany({
    select: {
      id: true,
      registrationNo: true,
      tradeName: true,
      genericName: true,
      dosage: true,
      manufacturer: true,
      barcode: true,
      licenseStatus: true,
      officialPrice: true,
    },
  });
  const licenseAlerts = buildLicenseAlerts(
    cartMeds.map((m): LicensedMedInput => ({
      id: m.id ?? "",
      name: m.name,
      dosage: m.dosage ?? null,
      barcode: m.barcode ?? null,
      registrationNo: m.registrationNo ?? null,
      registryStatus: m.registryStatus ?? null,
      nationalDrugId: m.nationalDrugId ?? null,
      sellingPrice: m.sellingPrice ?? null,
    })),
    nationalEntries
  );
  const allRegistryAlerts: RegistryAlert[] = [...registryAlerts, ...licenseAlerts];

  // بوابة المريض الخاصة — v4.3: حمل/رضاعة + الحد الأدنى للعمر
  // (تقبل تجاوز صيدلي مسؤول موثقاً — الفني محجوب، متسق مع البوابة السريرية)
  const pregnancyAlerts = patient
    ? pregnancyConflicts(cartMeds, patient.pregnancyStatus)
    : [];
  const patientAge = patient ? ageInYears(patient.dateOfBirth) : null;
  const ageAlerts = ageRestrictionViolations(cartMeds, patientAge);

  const highestSeverity = interactions.reduce<InteractionSeverity | null>(
    (acc, h) =>
      !acc || SEVERITY_RANK[h.severity] > SEVERITY_RANK[acc] ? h.severity : acc,
    null
  );

  // ── v5.0 — الطبقة التنبؤية الميكانيكية (CYP450) ──
  // التنبؤ فقط للثنائيات التي لا تغطيها القاعدة المنقّحة — والمنقّح مرجعه الأعلى.
  const curatedPairs = new Set(
    interactions.map((h) => normalizePair(h.genericA, h.genericB).join("|"))
  );
  const allGenerics = [...cartGenerics, ...patientGenerics];
  const mechanisticPredictions: MechanisticPrediction[] = [];
  for (let i = 0; i < allGenerics.length; i++) {
    for (let j = i + 1; j < allGenerics.length; j++) {
      const [ga, gb] = normalizePair(allGenerics[i], allGenerics[j]);
      if (curatedPairs.has(`${ga}|${gb}`)) continue;
      for (const p of predictMechanistic(ga, gb)) {
        mechanisticPredictions.push(p);
      }
    }
  }

  // ── v5.0 — لوحات المخاطر التراكمية + معايير Beers ──
  const syndromePanels = scanSyndromePanels(allGenerics);
  const beers = beersAlerts(allGenerics, patientAge);

  const gateBlocking =
    pregnancyAlerts.some((a) => a.severity === "blocking") ||
    ageAlerts.some((a) => a.severity === "blocking");

  return {
    interactions,
    allergyAlerts,
    duplicateTherapies,
    registryAlerts: allRegistryAlerts,
    registryBlocking: hasRegistryBlock(allRegistryAlerts),
    pregnancyAlerts,
    ageAlerts,
    mechanisticPredictions,
    syndromePanels,
    beersAlerts: beers,
    highestSeverity,
    blocking:
      highestSeverity === "contraindicated" ||
      allergyAlerts.length > 0 ||
      gateBlocking,
    checkedGenerics: [...cartGenerics, ...patientGenerics],
    patient: patient
      ? { id: patient.id, name: patient.name, allergies: patient.allergies }
      : null,
  };
}
