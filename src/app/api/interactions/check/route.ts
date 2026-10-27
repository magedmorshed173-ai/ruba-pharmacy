import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";
import { reviewCartClinical } from "@/lib/clinical-review";

interface CheckItem {
  barcodes?: string[];
  medicineIds?: string[];
  patientId?: string;
}

/**
 * POST /api/interactions/check — الفحص السريري الشامل للسلة
 * 1) تداخلات سلة↔سلة وسلة↔أدوية المريض المزمنة (بآلية وإدارة ومصدر علمي)
 * 2) تعارضات حساسية المريض مع عائلات الدواء
 * 3) العلاج المكرر داخل السلة (نفس الفئة العلاجية ATC)
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const body: CheckItem = await request.json();
    const barcodes: string[] = Array.isArray(body.barcodes) ? body.barcodes : [];
    const medicineIds: string[] = Array.isArray(body.medicineIds) ? body.medicineIds : [];
    const patientId = String(body.patientId ?? "").trim();

    if (barcodes.length === 0 && medicineIds.length === 0) {
      return ok({
        interactions: [],
        allergyAlerts: [],
        duplicateTherapies: [],
        highestSeverity: null,
        blocking: false,
        checkedGenerics: [],
        patient: null,
      });
    }

    const meds = await db.medicine.findMany({
      where: {
        OR: [
          ...(barcodes.length ? [{ barcode: { in: barcodes } }] : []),
          ...(medicineIds.length ? [{ id: { in: medicineIds } }] : []),
        ],
      },
      select: {
        id: true,
        name: true,
        genericName: true,
        atcClass: true,
        pregnancyCategory: true,
        minAge: true,
      },
    });

    const review = await reviewCartClinical(meds, patientId || undefined);
    return ok(review);
  } catch {
    return fail("تعذر تنفيذ الفحص السريري", 500);
  }
}
