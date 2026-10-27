import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";
import { findTherapeuticAlternatives } from "@/lib/alternatives";
import { isRegistryHardBlock } from "@/lib/registry";
import { isLicenseHardBlock } from "@/lib/national-license";

/**
 * GET /api/medicines/:id/alternatives — البدائل العلاجية عند النفاد (v4.3)
 * يرشح من نفس الفئة العلاجية (ATC) المتوفر فعلاً: الرصيد − المحجوز،
 * ويستبعد المحجوب تنظيمياً (سجل وطني) وترخيصياً (مسحوب/معلق من الهيئة).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  try {
    const target = await db.medicine.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        genericName: true,
        sellingPrice: true,
        atcClass: true,
      },
    });
    if (!target) return fail("الدواء غير موجود", 404);

    // بلا فئة علاجية محفوظة → لا بدائل موثقة (الطبقة النقية تعيد قائمة فارغة)
    const candidates = await db.medicine.findMany({
      where: {
        isActive: true,
        quantity: { gt: 0 },
        atcClass: target.atcClass ? { equals: target.atcClass } : undefined,
        id: { not: target.id },
      },
      select: {
        id: true,
        name: true,
        genericName: true,
        dosage: true,
        sellingPrice: true,
        quantity: true,
        atcClass: true,
        requiresPrescription: true,
        registryStatus: true,
        nationalDrug: { select: { licenseStatus: true } },
      },
      take: 60,
    });

    // المحجوز لوصفات الطابور — البديل المعروض يجب أن يكون صالحاً فوراً
    const reserved = await db.stockReservation.groupBy({
      by: ["medicineId"],
      where: { status: "active", medicineId: { in: candidates.map((c) => c.id) } },
      _sum: { quantity: true },
    });
    const reservedMap = new Map(reserved.map((r) => [r.medicineId, r._sum.quantity ?? 0]));

    const suggestions = findTherapeuticAlternatives(
      target,
      candidates
        // حجب مزدوج: السجل الوطني المحلي + الترخيص المرخص السحابي
        .filter(
          (c) =>
            !isRegistryHardBlock(c.registryStatus ?? "registered") &&
            !(c.nationalDrug && isLicenseHardBlock(c.nationalDrug.licenseStatus))
        )
        .map((c) => ({
          id: c.id,
          name: c.name,
          genericName: c.genericName,
          dosage: c.dosage,
          sellingPrice: c.sellingPrice,
          availableQuantity: Math.max(0, c.quantity - (reservedMap.get(c.id) ?? 0)),
          atcClass: c.atcClass,
          requiresPrescription: c.requiresPrescription,
        }))
    );

    return ok({
      target: { id: target.id, name: target.name, atcClass: target.atcClass },
      alternatives: suggestions,
    });
  } catch {
    return fail("تعذر جلب البدائل العلاجية", 500);
  }
}
