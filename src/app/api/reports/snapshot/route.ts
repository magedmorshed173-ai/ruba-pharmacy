import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth, requireRole } from "@/lib/api-guard";
import { createDbRateLimiter } from "@/lib/rate-limit-db";
import { clientIp } from "@/lib/auth";

/**
 * v5.0 — التقارير المجدولة
 *
 * GET  /api/reports/snapshot — آخر 30 لقطة (خلف بوابة القفل + جلسة)
 * POST /api/reports/snapshot — توليد لقطة أمس (صف واحد لكل يوم — إعادة التشغيل لا تكرر):
 *   • CRON_SECRET مضبوط: كرون Vercel يمرّ برأس Authorization: Bearer (نمط Vercel الموثق)
 *   • جلسة مدير: للتشغيل اليدوي من اللوحة
 *   • CRON_SECRET غير مضبوط: الكرون يمرّ بلا رأس — النقطة تسمح مقيّدةً
 *     بـ 10/دقيقة لكل IP (نكتب اللقطة نفسها المحسوبة من القاعدة — لا تسريب
 *     ولا بيانات، وأسوأ حالة حمل محدود) — ضبط CRON_SECRET يشدّدها تلقائياً.
 */

export const dynamic = "force-dynamic";

/** مقيّد وضع الكرون المفتوح (CRON_SECRET غير مضبوط): 10 محاولات/دقيقة لكل IP */
const snapshotRateLimiter = createDbRateLimiter(10, 60);

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  const snapshots = await db.reportSnapshot.findMany({
    orderBy: { periodStart: "desc" },
    take: 30,
  });
  return ok({ snapshots });
}

export async function POST(request: NextRequest) {
  // 1) مصادقة كرون: إن ضُبط CRON_SECRET فعندها يجب أن يطابق رأس الطلب
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization") ?? "";
    if (auth === `Bearer ${cronSecret}`) return runSnapshot();
    // لا رأس مطابق ⇒ التشغيل اليدوي: جلسة مدير حصراً
    const { error } = await requireRole("admin");
    if (error) return error;
    return runSnapshot();
  }
  // 2) CRON_SECRET غير مضبوط — وضع الكرون المفتوح: مقيّد صارم لكل IP
  const ip = clientIp(request.headers);
  const limit = await snapshotRateLimiter.hit(`snapcron:${ip}`);
  if (!limit.allowed) {
    return fail(
      `طلبات كثيرة — أعد المحاولة بعد ${Math.ceil(limit.retryAfterSec / 60)} دقيقة`,
      429,
      { retryAfterSec: limit.retryAfterSec }
    );
  }
  return runSnapshot();
}

async function runSnapshot() {
  try {
    // نافذة أمس بتوقيت UTC — مستقرة عبر النسخ ولا تتأثر بمنطقة خادم الطلب
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const periodStart = new Date(todayUtc - 24 * 3600 * 1000);
    const periodEnd = new Date(todayUtc);

    const salesAgg = await db.sale.aggregate({
      _sum: { netAmount: true, discount: true },
      where: { saleDate: { gte: periodStart, lt: periodEnd }, status: "completed" },
    });
    const salesCount = await db.sale.count({
      where: { saleDate: { gte: periodStart, lt: periodEnd }, status: "completed" },
    });
    const voided = await db.sale.count({
      where: { saleDate: { gte: periodStart, lt: periodEnd }, status: "void" },
    });

    const topItems = await db.saleItem.groupBy({
      by: ["medicineName"],
      _sum: { quantity: true, subtotal: true },
      where: { sale: { saleDate: { gte: periodStart, lt: periodEnd }, status: "completed" } },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    });

    const expiringBatches = await db.batch.count({
      where: {
        isActive: true,
        isRecalled: false,
        expiryDate: { lte: new Date(todayUtc + 30 * 24 * 3600 * 1000) },
      },
    });
    const lowStock = await db.$queryRaw<{ c: number }[]>`
      SELECT COUNT(*)::int AS c FROM "Medicine"
      WHERE "isActive" = true AND "quantity" <= "minQuantity" AND "minQuantity" > 0
    `;
    const prescriptions = await db.prescription.count({
      where: { createdAt: { gte: periodStart, lt: periodEnd } },
    });

    const data = {
      salesCount,
      netRevenueHalalas: salesAgg._sum.netAmount ?? 0,
      discountHalalas: salesAgg._sum.discount ?? 0,
      voidedCount: voided,
      topItems: topItems.map((t) => ({
        name: t.medicineName,
        qty: t._sum.quantity ?? 0,
        subtotalHalalas: t._sum.subtotal ?? 0,
      })),
      lowStockCount: lowStock[0]?.c ?? 0,
      expiringBatches30: expiringBatches,
      prescriptionsCount: prescriptions,
      generatedAt: new Date().toISOString(),
    };

    const snapshot = await db.reportSnapshot.upsert({
      where: { kind_periodStart: { kind: "daily", periodStart } },
      update: { data, periodEnd },
      create: { kind: "daily", periodStart, periodEnd, data },
    });

    return ok({ created: true, snapshot });
  } catch {
    return fail("تعذر توليد لقطة التقرير", 500);
  }
}
