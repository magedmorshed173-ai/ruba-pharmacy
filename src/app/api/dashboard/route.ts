import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";
import { astParts, astDate } from "@/lib/report-periods";
import { buildAnalytics } from "@/lib/analytics";

const DAY_MS = 86_400_000;

// GET /api/dashboard — إحصائيات اللوحة الرئيسية
// v5.5 — «البصيرة التحليلية»: كل حدود اليوم والشهر بتوقيت الرياض (UTC+3)
// لا UTC — إصلاح نفس عائلة علة v5.1.0: كان «إيراد اليوم» يبدأ من منتصف
// ليل UTC (3 فجراً بالرياض على Vercel) ورسم الاتجاه يجمّع بأيام UTC.
export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const now = new Date();
    const p = astParts(now);
    const startToday = astDate(p.y, p.m, p.d); // منتصف ليل الرياض
    const startMonth = astDate(p.y, p.m, 1); // أول الشهر الميلادي بالرياض
    const in30 = new Date(now.getTime() + 30 * DAY_MS);
    const since30 = astDate(p.y, p.m, p.d - 29); // نافذة الاتجاه: 30 يوماً شاملة اليوم

    const [revenueTodayAgg, revenueMonthAgg, salesCountToday, totalMedicines, lowStockCount, expiredCount, expiring30Count, unreadNotifications, recentSales, lowStockList, expiringList, sales30, batches] =
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
        // منتهية الصلاحية: تاريخ الانتهاء قبل فجر اليوم بالرياض — الدفعة ذات
        // تاريخ اليوم تبقى صالحة للعرض ضمن «قاربت» حتى نهاية يومها
        db.medicine.count({ where: { isActive: true, expiryDate: { lt: startToday } } }),
        db.medicine.count({
          where: { isActive: true, expiryDate: { gte: startToday, lte: in30 } },
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
          where: { isActive: true, expiryDate: { gte: startToday, lte: in30 } },
          select: { id: true, name: true, expiryDate: true, quantity: true },
          orderBy: { expiryDate: "asc" },
          take: 6,
        }),
        // نافذة الاتجاه كاملة مع بنودها — أساس الربح والهامش ومزيج الدفع
        db.sale.findMany({
          where: { status: "completed", saleDate: { gte: since30 } },
          select: {
            saleDate: true,
            netAmount: true,
            paymentMethod: true,
            items: {
              select: { medicineName: true, quantity: true, subtotal: true, costHalalas: true },
            },
          },
        }),
        // الدفعات الحية — أساس دلاء انتهاء الصلاحية والقيمة المهددة
        db.batch.findMany({
          where: { isActive: true, isRecalled: false, quantity: { gt: 0 } },
          select: { expiryDate: true, quantity: true, unitCost: true },
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

    // التحليلات التنفيذية النقية — اتجاه 30 يوماً + أعلى الأصناف + مزيج
    // الدفع + دلاء الصلاحية + الملخص (بتوقيت الرياض عبر analytics.ts)
    const analytics = buildAnalytics(sales30, batches, 30, now);

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
      analytics,
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
