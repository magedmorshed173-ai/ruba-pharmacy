import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { toInt } from "@/lib/money";
import { rankAlternatives } from "@/lib/drug-guide";
import {
  parseSeverity,
  SEVERITY_LABEL,
  SEVERITY_RANK,
  EVIDENCE_LABEL,
  ONSET_LABEL,
} from "@/lib/clinical";

/**
 * GET /api/drugs/[id] — نشرة الدواء الكاملة للعميل (v4.0) — عام بلا جلسة
 * تعيد: النشرة المرخصة + التوفر الحي (عبر الباركود المربوط) + البدائل العلاجية
 * لنفس المادة الفعالة (الأرخص أولاً مع الوفر) + التداخلات الموثقة للمادة الفعالة.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const drug = await db.drug.findUnique({ where: { id } });
    if (!drug || !drug.isActive) return fail("بطاقة الدواء غير موجودة", 404);

    const sci = drug.scientificName.toLowerCase();

    // 1) التوفر الحي — المنتج المخزون المربوط بباركود البطاقة
    let availability: Record<string, unknown> = { linked: false, inStock: false };
    if (drug.linkedBarcode) {
      const med = await db.medicine.findUnique({
        where: { barcode: drug.linkedBarcode },
        include: {
          _count: { select: { batches: { where: { isActive: true, isRecalled: false } } } },
        },
      });
      if (med && med.isActive) {
        availability = {
          linked: true,
          inStock: med.quantity > 0,
          quantity: med.quantity,
          medicineName: med.name,
          storePriceHalalas: med.sellingPrice,
          activeBatches: med._count.batches,
        };
      }
    }

    // 2) البدائل العلاجية — نفس المادة الفعالة، الأرخص أولاً مع حساب الوفر
    const alts = await db.drug.findMany({
      where: { scientificName: sci, isActive: true, id: { not: drug.id } },
      select: {
        id: true,
        tradeName: true,
        form: true,
        strength: true,
        manufacturer: true,
        priceHalalas: true,
        requiresRx: true,
        linkedBarcode: true,
      },
    });
    const altBarcodes = alts.map((a) => a.linkedBarcode).filter((x): x is string => !!x);
    const altMeds = altBarcodes.length
      ? await db.medicine.findMany({
          where: { barcode: { in: altBarcodes }, isActive: true },
          select: { barcode: true, quantity: true },
        })
      : [];
    const altStock = new Map(altMeds.map((m) => [m.barcode, m.quantity]));
    const alternatives = rankAlternatives(drug.priceHalalas, alts).map((a) => ({
      id: a.id,
      tradeName: a.tradeName,
      form: a.drug.form,
      strength: a.drug.strength,
      manufacturer: a.drug.manufacturer,
      priceHalalas: a.priceHalalas,
      requiresRx: a.drug.requiresRx,
      savingsHalalas: a.savingsHalalas,
      cheaperByPct: a.cheaperByPct,
      inStock: (a.drug.linkedBarcode ? altStock.get(a.drug.linkedBarcode) ?? 0 : 0) > 0,
    }));

    // 3) التداخلات الموثقة — محرك clinical نفسه المستخدم عند نقطة البيع
    const rows = await db.drugInteraction.findMany({
      where: { isActive: true, OR: [{ genericA: sci }, { genericB: sci }] },
    });
    const otherGenerics = Array.from(
      new Set(rows.map((r) => (r.genericA.toLowerCase() === sci ? r.genericB : r.genericA).toLowerCase()))
    );
    const partners = otherGenerics.length
      ? await db.drug.findMany({
          where: { scientificName: { in: otherGenerics }, isActive: true },
          select: { scientificName: true, tradeName: true },
        })
      : [];
    const partnerMap = new Map(partners.map((p) => [p.scientificName.toLowerCase(), p.tradeName]));

    const interactions = rows
      .map((r) => {
        const other = (r.genericA.toLowerCase() === sci ? r.genericB : r.genericA).toLowerCase();
        const sev = parseSeverity(r.severity);
        return {
          otherGeneric: other,
          otherTradeName: partnerMap.get(other) ?? null,
          severity: sev,
          severityLabel: SEVERITY_LABEL[sev],
          description: r.description,
          mechanism: r.mechanism,
          clinicalEffect: r.clinicalEffect,
          management: r.management,
          evidenceLevel: r.evidenceLevel,
          evidenceLabel: r.evidenceLevel ? EVIDENCE_LABEL[r.evidenceLevel] ?? null : null,
          source: r.source,
          onset: r.onset,
          onsetLabel: r.onset ? ONSET_LABEL[r.onset] ?? null : null,
        };
      })
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

    return ok({ drug, availability, alternatives, interactions });
  } catch {
    return fail("تعذر جلب نشرة الدواء", 500);
  }
}

/**
 * PUT /api/drugs/[id] — تحديث محتوى النشرة (صيدلي فما فوق)
 * الحقول القابلة للتحديث: النصوص السريرية، السعر، الوصفة، فئة الحمل، التخزين، الربط بالباركود، التفعيل.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireRole("pharmacist");
  if (error) return error;

  try {
    const { id } = await params;
    const existing = await db.drug.findUnique({ where: { id } });
    if (!existing) return fail("بطاقة الدواء غير موجودة", 404);

    const b = await request.json();
    const data: Record<string, unknown> = {};

    const textFields = [
      "indications",
      "dosageGuide",
      "sideEffects",
      "contraindications",
      "storage",
      "pregnancyCategory",
      "scientificNameAr",
      "atcCode",
      "atcClass",
      "country",
    ] as const;
    for (const k of textFields) {
      if (b[k] !== undefined) data[k] = String(b[k] ?? "").trim() || null;
    }
    if (b.priceHalalas !== undefined) {
      const price = toInt(b.priceHalalas, -1);
      if (price < 0) return fail("السعر غير صالح");
      data.priceHalalas = price;
    }
    if (b.requiresRx !== undefined) data.requiresRx = !!b.requiresRx;
    if (b.isActive !== undefined) data.isActive = !!b.isActive;
    if (b.linkedBarcode !== undefined) {
      const bc = String(b.linkedBarcode ?? "").trim() || null;
      if (bc) {
        const med = await db.medicine.findUnique({ where: { barcode: bc } });
        if (!med) return fail("باركود المنتج المخزن غير موجود", 400);
      }
      data.linkedBarcode = bc;
    }

    const drug = await db.drug.update({ where: { id }, data });
    return ok({ drug });
  } catch {
    return fail("تعذر تحديث بطاقة الدواء", 500);
  }
}
