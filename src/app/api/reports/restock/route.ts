import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";
import { computeReorderMetrics, groupReorderRowsBySupplier } from "@/lib/reorder";

/**
 * GET /api/reports/restock — إعادة الطلب الذكية القابلة للتنفيذ (v4.3)
 * v3.3 كانت تحسب «الفرق حتى 30 يوماً» دوماً؛ الآن نموذج نقطة إعادة الطلب:
 * لا طلب إلا عند نزول التغطية تحت (زمن التوريد + الأمان)، وبلا مبيعات
 * نسقط محافظين إلى حد التنبيه اليدوي. الاستجابة تحتفظ بحقول v3.3
 * (توافق كامل مع التقارير) وتضيف: reorderPoint، المورد الأخير، سعر الشراء.
 */
export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const WINDOW = 30;
    const LEAD_DAYS = 7;
    const SAFETY_DAYS = 7;
    const since = new Date(Date.now() - WINDOW * 86400000);

    const [sold, medicines, lastPOItems] = await Promise.all([
      db.saleItem.groupBy({
        by: ["medicineId"],
        _sum: { quantity: true },
        where: {
          sale: { saleDate: { gte: since }, status: "completed" },
        },
      }),
      db.medicine.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          barcode: true,
          quantity: true,
          minQuantity: true,
          purchasePrice: true,
        },
      }),
      // المورد الأخير لكل دواء — من أحدث أمر شراء غير ملغى (أساس تجميع الأوامر)
      db.purchaseOrderItem.findMany({
        where: { po: { status: { not: "cancelled" } } },
        select: {
          medicineId: true,
          unitCost: true,
          po: { select: { supplierId: true, createdAt: true } },
        },
        orderBy: { po: { createdAt: "desc" } },
        take: 500,
      }),
    ]);

    const soldMap = new Map(sold.map((s) => [s.medicineId, s._sum.quantity ?? 0]));
    const supplierMap = new Map<string, string>(); // أول ظهور = الأحدث زمنياً
    for (const item of lastPOItems) {
      if (!supplierMap.has(item.medicineId) && item.po.supplierId)
        supplierMap.set(item.medicineId, item.po.supplierId);
    }

    const rows = medicines.map((m) => {
      const metrics = computeReorderMetrics({
        quantity: m.quantity,
        minQuantity: m.minQuantity,
        soldQty: soldMap.get(m.id) ?? 0,
        windowDays: WINDOW,
        leadDays: LEAD_DAYS,
        safetyDays: SAFETY_DAYS,
      });
      const supplierId = supplierMap.get(m.id) ?? null;
      return {
        medicineId: m.id,
        name: m.name,
        barcode: m.barcode,
        quantity: m.quantity,
        minQuantity: m.minQuantity,
        purchasePrice: m.purchasePrice,
        soldLast30: soldMap.get(m.id) ?? 0,
        dailyVelocity: metrics.dailyVelocity,
        daysOfCover: metrics.daysOfCover,
        reorderPoint: metrics.reorderPoint,
        targetStock: metrics.targetStock,
        suggestedOrder: metrics.suggestedOrder,
        velocityBased: metrics.velocityBased,
        lastSupplierId: supplierId,
      };
    });

    // الأكثر أولوية: أقل تغطية أولاً (null = بلا مبيعات = آخراً)
    rows.sort((a, b) => {
      if (a.daysOfCover === null && b.daysOfCover === null) return 0;
      if (a.daysOfCover === null) return 1;
      if (b.daysOfCover === null) return -1;
      return a.daysOfCover - b.daysOfCover;
    });

    // تجميع جاهز للمورد — بند الطبقة النقية نفسها المستخدمة في الواجهة
    const groups = groupReorderRowsBySupplier(
      rows.filter((r) => r.suggestedOrder > 0)
    ).map((g) => ({ supplierId: g.supplierId, count: g.rows.length }));

    return ok({
      rows,
      groups,
      windowDays: WINDOW,
      leadDays: LEAD_DAYS,
      safetyDays: SAFETY_DAYS,
    });
  } catch (e) {
    console.error("restock report error", e);
    return fail("تعذر جلب تقرير إعادة الطلب", 500);
  }
}
