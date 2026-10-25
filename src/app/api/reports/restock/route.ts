import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";

// GET /api/reports/restock — التنبؤ الذكي بإعادة الطلب
// يحسب سرعة البيع اليومية وأيام التغطية واقترح كمية الطلب
export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const WINDOW = 30;
    const since = new Date(Date.now() - WINDOW * 86400000);

    const sold = await db.saleItem.groupBy({
      by: ["medicineId"],
      _sum: { quantity: true },
      where: {
        sale: { saleDate: { gte: since }, status: "completed" },
      },
    });
    const soldMap = new Map(sold.map((s) => [s.medicineId, s._sum.quantity ?? 0]));

    const medicines = await db.medicine.findMany({
      where: { isActive: true },
      select: { id: true, name: true, barcode: true, quantity: true, minQuantity: true },
    });

    const rows = medicines.map((m) => {
      const sold30 = soldMap.get(m.id) ?? 0;
      const dailyVelocity = sold30 / WINDOW;
      const daysOfCover = dailyVelocity > 0 ? m.quantity / dailyVelocity : null;
      // اقتراح الطلب: تغطية 30 يوماً القادمة مطروحاً منها المتوفر (حد أدنى حد التنبيه)
      const target = Math.ceil(dailyVelocity * 30);
      const suggestedOrder =
        dailyVelocity > 0 ? Math.max(0, target - m.quantity) : Math.max(0, m.minQuantity - m.quantity);

      return {
        medicineId: m.id,
        name: m.name,
        barcode: m.barcode,
        quantity: m.quantity,
        minQuantity: m.minQuantity,
        soldLast30: sold30,
        dailyVelocity: Math.round(dailyVelocity * 1000) / 1000,
        daysOfCover: daysOfCover === null ? null : Math.round(daysOfCover * 10) / 10,
        suggestedOrder,
      };
    });

    // الأكثر أولوية: أقل تغطية أولاً (null = بلا مبيعات = آخراً)
    rows.sort((a, b) => {
      if (a.daysOfCover === null && b.daysOfCover === null) return 0;
      if (a.daysOfCover === null) return 1;
      if (b.daysOfCover === null) return -1;
      return a.daysOfCover - b.daysOfCover;
    });

    return ok({ rows, windowDays: WINDOW });
  } catch (e) {
    console.error("restock report error", e);
    return fail("تعذر جلب تقرير إعادة الطلب", 500);
  }
}
