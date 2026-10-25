import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";

interface CheckItem {
  barcodes?: string[];
  medicineIds?: string[];
  patientGenericNames?: string[];
}

// POST /api/interactions/check — فحص تداخلات (سلة ↔ سلة) و(سلة ↔ أدوية المريض)
export async function POST(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const body: CheckItem = await request.json();
    const barcodes: string[] = Array.isArray(body.barcodes) ? body.barcodes : [];
    const medicineIds: string[] = Array.isArray(body.medicineIds) ? body.medicineIds : [];
    const patientGenerics: string[] = Array.isArray(body.patientGenericNames)
      ? body.patientGenericNames.map((g) => g.toLowerCase().trim()).filter(Boolean)
      : [];

    const meds = await db.medicine.findMany({
      where: {
        OR: [
          ...(barcodes.length ? [{ barcode: { in: barcodes } }] : []),
          ...(medicineIds.length ? [{ id: { in: medicineIds } }] : []),
        ],
      },
      select: { name: true, genericName: true },
    });

    const cartGenerics = Array.from(
      new Set(meds.map((m) => m.genericName.toLowerCase()).filter(Boolean))
    );

    if (cartGenerics.length === 0) {
      return ok({ interactions: [], checkedGenerics: [] });
    }

    // 1) تداخلات داخل السلة
    const cartHits = await db.drugInteraction.findMany({
      where: {
        isActive: true,
        genericA: { in: cartGenerics },
        genericB: { in: cartGenerics },
      },
    });

    // 2) تداخلات السلة مع الأدوية المزمنة للمريض
    let patientHits: typeof cartHits = [];
    if (patientGenerics.length > 0) {
      patientHits = await db.drugInteraction.findMany({
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
    }

    const mapHit = (h: (typeof cartHits)[number]) => ({
      genericA: h.genericA,
      genericB: h.genericB,
      severity: h.severity,
      description: h.description,
      management: h.management,
    });

    return ok({
      interactions: [
        ...cartHits.filter((h) => h.genericA !== h.genericB).map(mapHit),
        ...patientHits.map(mapHit),
      ],
      checkedGenerics: [...cartGenerics, ...patientGenerics],
    });
  } catch {
    return fail("تعذر فحص التداخلات", 500);
  }
}
