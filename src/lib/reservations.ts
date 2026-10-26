/**
 * المحجوزات الوقائية للمخزون — ربي فارمسي v3.7
 * نمط Allocated/Reserved Stock المعياري في أنظمة الصيدليات:
 * وصفة تدخل طابور التحقق ⇒ وحداتها تُحجز فوراً حتى لا تبيعها نقطة البيع
 * الحرة، وتُفرج عند الرفض أو تُستهلك عند الصرف.
 *
 * الجزء النقي (computeAvailable/availableAfterReserve) قابل للاختبار الوحدوي،
 * وأجزاء قاعدة البيانات تُمرَّر داخل معاملات صريحة (tx) لضمان الذرية.
 */
import { Prisma } from "@prisma/client";

/** المتاح = الرصيد الفعلي − المحجوز للوصفات الأخرى قيد الطابور */
export function computeAvailable(onHand: number, reservedByOthers: number): number {
  return Math.max(0, Math.floor(onHand) - Math.max(0, Math.floor(reservedByOthers)));
}

/** يرمي رسالة عربية واضحة إن كان المتاح أقل من المطلوب */
export function assertAvailable(
  medName: string,
  requested: number,
  onHand: number,
  reservedByOthers: number
): void {
  const available = computeAvailable(onHand, reservedByOthers);
  if (requested > available) {
    throw new Error(
      available === 0 && reservedByOthers > 0
        ? `لا يوجد مخزون متاح: ${medName} (الرصيد ${onHand} وحدة — منها ${reservedByOthers} محجوزة لوصفات قيد التحقق)`
        : `المخزون المتاح أقل من المطلوب: ${medName} (المتاح ${available} من الرصيد ${onHand} — المحجوز ${reservedByOthers})`
    );
  }
}

/**
 * حجز كميات وصفة داخل معاملة الإنشاء — صف لكل بند.
 * تُستدعى فقط من داخل tx.prescription.create لضمان الذرية.
 */
export async function reserveForPrescription(
  tx: Prisma.TransactionClient,
  prescriptionId: string,
  items: { id: string; medicineId: string; quantity: number }[]
): Promise<void> {
  for (const item of items) {
    if (item.quantity <= 0) continue;
    await tx.stockReservation.create({
      data: {
        prescriptionId,
        prescriptionItemId: item.id,
        medicineId: item.medicineId,
        quantity: item.quantity,
        status: "active",
      },
    });
  }
}

/** إفراج كل حجوزات وصفة (عند الرفض) */
export async function releasePrescriptionReservations(
  tx: Prisma.TransactionClient,
  prescriptionId: string
): Promise<number> {
  const r = await tx.stockReservation.updateMany({
    where: { prescriptionId, status: "active" },
    data: { status: "released", closedAt: new Date() },
  });
  return r.count;
}

/** استهلاك كل حجوزات وصفة (عند الصرف — الحجز تحقق فعلياً) */
export async function consumePrescriptionReservations(
  tx: Prisma.TransactionClient,
  prescriptionId: string
): Promise<number> {
  const r = await tx.stockReservation.updateMany({
    where: { prescriptionId, status: "active" },
    data: { status: "consumed", closedAt: new Date() },
  });
  return r.count;
}

/**
 * المحجوز لكل دواء من الوصفات الأخرى قيد الطابور (يُستدعى داخل معاملة البيع).
 * excludePrescriptionId: وصفة يُصرف منها الآن — حجزها لا يُحسب ضدها.
 */
export async function mapActiveReservations(
  tx: Prisma.TransactionClient,
  medicineIds: string[],
  excludePrescriptionId?: string
): Promise<Map<string, number>> {
  if (medicineIds.length === 0) return new Map();
  const rows = await tx.stockReservation.groupBy({
    by: ["medicineId"],
    where: {
      medicineId: { in: medicineIds },
      status: "active",
      ...(excludePrescriptionId ? { prescriptionId: { not: excludePrescriptionId } } : {}),
    },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.medicineId, r._sum.quantity ?? 0]));
}
