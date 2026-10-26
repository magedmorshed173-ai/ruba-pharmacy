/**
 * المراجعة السريرية المركزية — تُستخدم من مساري /api/interactions/check و /api/sales
 * تجمع: تداخلات السلة، تداخلات أدوية المريض المزمنة، تعارضات الحساسية، العلاج المكرر.
 */
import { db } from "@/lib/db";
import {
  allergyConflicts,
  duplicateTherapyGroups,
  parseSeverity,
  SEVERITY_RANK,
  type AllergyHit,
  type DuplicateGroup,
  type InteractionSeverity,
} from "@/lib/clinical";
import {
  buildRegistryAlerts,
  hasRegistryBlock,
  type RegistryAlert,
} from "@/lib/registry";

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

  let patient = null;
  if (patientId) {
    patient = await db.patient.findUnique({ where: { id: patientId } });
  }
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
  const duplicateTherapies = duplicateTherapyGroups(cartMeds);

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

  const highestSeverity = interactions.reduce<InteractionSeverity | null>(
    (acc, h) =>
      !acc || SEVERITY_RANK[h.severity] > SEVERITY_RANK[acc] ? h.severity : acc,
    null
  );

  return {
    interactions,
    allergyAlerts,
    duplicateTherapies,
    registryAlerts,
    registryBlocking: hasRegistryBlock(registryAlerts),
    highestSeverity,
    blocking: highestSeverity === "contraindicated" || allergyAlerts.length > 0,
    checkedGenerics: [...cartGenerics, ...patientGenerics],
    patient: patient
      ? { id: patient.id, name: patient.name, allergies: patient.allergies }
      : null,
  };
}
