import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";

// GET /api/dashboard — إحصائيات اللوحة الرئيسية
export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const in30 = new Date(now.getTime() + 30 * 86400000);
    const today10 = new Date(now.toISOString().slice(0, 10));

    const [revenueTodayAgg, revenueMonthAgg, salesCountToday, totalMedicines, lowStockCount, expiredCount, expiring30Count, unreadNotifications, recentSales, lowStockList, expiringList] =
      await Promise.all([
        db.sale.aggregate({
          _sum: { netAmount: true },
          where: { saleDate: { gte: startToday }, status: "completed" },
        }),
        db.sale.aggregate({
          _sum: { netAmount: true },
          where: { saleDate: { gte: startMonth }, status: "completed" },
        }),
        db.sale.count({ where: { saleDate: { gte: startToday }, status: "completed" } }),
        db.medicine.count({ where: { isActive: true } }),
        db.medicine.count({ where: { isActive: true, quantity: { lte: db.medicine.fields.minQuantity } } }),
        db.medicine.count({ where: { isActive: true, expiryDate: { lte: today10 } } }),
        db.medicine.count({
          where: { isActive: true, expiryDate: { gt: today10, lte: in30 } },
        }),
        db.notification.count({ where: { isRead: false } }),
        db.sale.findMany({
          where: { status: "completed" },
          include: { user: { select: { fullName: true } }, items: { take: 3 } },
          orderBy: { saleDate: "desc" },
          take: 6,
        }),
        db.medicine.findMany({
          where: { isActive: true, quantity: { lte: db.medicine.fields.minQuantity } },
          select: { id: true, name: true, quantity: true, minQuantity: true, barcode: true },
          orderBy: { quantity: "asc" },
          take: 6,
        }),
        db.medicine.findMany({
          where: { isActive: true, expiryDate: { gt: today10, lte: in30 } },
          select: { id: true, name: true, expiryDate: true, quantity: true },
          orderBy: { expiryDate: "asc" },
          take: 6,
        }),
      ]);

    // قيمة المخزون بسعر التكلفة (بالهللات — حساب صحيح دقيق)
    const costAgg = await db.medicine.findMany({
      where: { isActive: true },
      select: { quantity: true, purchasePrice: true },
    });
    const inventoryCostValue = costAgg.reduce(
      (acc, m) => acc + m.quantity * m.purchasePrice,
      0
    );

    // مبيعات آخر 14 يوماً للرسم البياني
    const since14 = new Date(startToday.getTime() - 13 * 86400000);
    const sales14 = await db.sale.groupBy({
      by: ["saleDate"],
      _sum: { netAmount: true },
      _count: { id: true },
      where: { saleDate: { gte: since14 }, status: "completed" },
    });

    const dayMap = new Map<string, { revenue: number; count: number }>();
    for (let i = 0; i < 14; i++) {
      const d = new Date(since14.getTime() + i * 86400000);
      dayMap.set(d.toISOString().slice(0, 10), { revenue: 0, count: 0 });
    }
    for (const row of sales14) {
      const key = row.saleDate.toISOString().slice(0, 10);
      const cur = dayMap.get(key) ?? { revenue: 0, count: 0 };
      dayMap.set(key, {
        revenue: cur.revenue + (row._sum.netAmount ?? 0),
        count: cur.count + row._count.id,
      });
    }
    const dailySeries = Array.from(dayMap.entries()).map(([date, v]) => ({
      date,
      revenue: v.revenue,
      count: v.count,
    }));

    // توزيع التصنيفات
    const categoryDist = await db.medicine.groupBy({
      by: ["categoryId"],
      _count: { id: true },
      where: { isActive: true },
    });
    const catIds = categoryDist.map((c) => c.categoryId);
    const cats = await db.category.findMany({
      where: { id: { in: catIds } },
      select: { id: true, name: true },
    });
    const catMap = new Map(cats.map((c) => [c.id, c.name]));
    const categorySeries = categoryDist.map((c) => ({
      name: catMap.get(c.categoryId) ?? "أخرى",
      value: c._count.id,
    }));

    return ok({
      stats: {
        revenueToday: revenueTodayAgg._sum.netAmount ?? 0,
        revenueMonth: revenueMonthAgg._sum.netAmount ?? 0,
        salesCountToday,
        totalMedicines,
        lowStockCount,
        expiredCount,
        expiring30Count,
        inventoryCostValue,
        unreadNotifications,
      },
      dailySeries,
      categorySeries,
      recentSales,
      lowStockList,
      expiringList,
    });
  } catch (e) {
    console.error("dashboard error", e);
    return fail("تعذر جلب إحصائيات اللوحة", 500);
  }
}
