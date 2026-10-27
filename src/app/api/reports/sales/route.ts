import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";

// GET /api/reports/sales — تقرير المبيعات (اليوم/الأسبوع/الشهر) + الأكثر مبيعاً
export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const days = Math.min(365, Math.max(7, Number(sp.get("days") ?? 30)));
  // v4.6 — فلتر الفرع (اختياري): تقرير مخصص لفرع واحد
  const branchId = sp.get("branchId")?.trim() || "";
  const branchCond = branchId ? { branchId } : {};

  try {
    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const startWeek = new Date(startToday.getTime() - 6 * 86400000);
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const summarize = async (from: Date) => {
      const agg = await db.sale.aggregate({
        _count: { id: true },
        _sum: { netAmount: true, discount: true },
        where: { saleDate: { gte: from }, status: "completed", ...branchCond },
      });
      return {
        count: agg._count.id,
        revenue: agg._sum.netAmount ?? 0,
        discount: agg._sum.discount ?? 0,
      };
    };

    const [today, week, month] = await Promise.all([
      summarize(startToday),
      summarize(startWeek),
      summarize(startMonth),
    ]);

    // الأكثر مبيعاً خلال المدة
    const sincePeriod = new Date(startToday.getTime() - (days - 1) * 86400000);
    const topItems = await db.saleItem.groupBy({
      by: ["medicineName"],
      _sum: { quantity: true, subtotal: true },
      where: { sale: { saleDate: { gte: sincePeriod }, status: "completed", ...branchCond } },
      orderBy: { _sum: { quantity: "desc" } },
      take: 10,
    });

    // سلسلة المبيعات اليومية للمدة
    const sales = await db.sale.findMany({
      where: { saleDate: { gte: sincePeriod }, status: "completed", ...branchCond },
      select: { saleDate: true, netAmount: true },
    });
    const dayMap = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date(sincePeriod.getTime() + i * 86400000);
      dayMap.set(d.toISOString().slice(0, 10), 0);
    }
    for (const s of sales) {
      const key = s.saleDate.toISOString().slice(0, 10);
      if (dayMap.has(key)) dayMap.set(key, (dayMap.get(key) ?? 0) + s.netAmount);
    }
    const series = Array.from(dayMap.entries()).map(([date, revenue]) => ({
      date,
      revenue,
    }));

    // المبيعات حسب طريقة الدفع
    const paymentDist = await db.sale.groupBy({
      by: ["paymentMethod"],
      _count: { id: true },
      _sum: { netAmount: true },
      where: { saleDate: { gte: sincePeriod }, status: "completed", ...branchCond },
    });

    return ok({
      today,
      week,
      month,
      topItems: topItems.map((t) => ({
        name: t.medicineName,
        quantity: t._sum.quantity ?? 0,
        revenue: t._sum.subtotal ?? 0,
      })),
      series,
      paymentDist: paymentDist.map((p) => ({
        method: p.paymentMethod,
        count: p._count.id,
        revenue: p._sum.netAmount ?? 0,
      })),
    });
  } catch (e) {
    console.error("sales report error", e);
    return fail("تعذر جلب تقرير المبيعات", 500);
  }
}
