import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth, requireRole } from "@/lib/api-guard";
import { createDbRateLimiter } from "@/lib/rate-limit-db";
import { clientIp } from "@/lib/auth";
import { pruneAuditLogs } from "@/lib/audit";
import {
  dueKinds,
  isSnapshotKind,
  periodFor,
  type SnapshotKind,
} from "@/lib/report-periods";
import {
  emailConfigFromEnv,
  sendSnapshotEmail,
  snapshotEmailHtml,
  transfersAlertHtml,
  expiryAlertHtml,
  type PendingTransferInfo,
  type ExpiringBatchInfo,
  type SnapshotEmailData,
} from "@/lib/report-email";

/**
 * v5.1 — التقارير المجدولة (يومي/أسبوعي/شهري بتوقيت الرياض)
 *
 * GET  /api/reports/snapshot[?kind=daily]      — آخر 30 لقطة (بوابة القفل + جلسة)
 * POST /api/reports/snapshot[?kind=...]        — توليد لقطة (صف واحد لكل فترة — إعادة التشغيل لا تكرر):
 *   • CRON_SECRET مضبوط: كرون Vercel يمرّ برأس Authorization: Bearer (نمط Vercel الموثق)
 *   • جلسة مدير: للتشغيل اليدوي من اللوحة
 *   • CRON_SECRET غير مضبوط: الكرون يمرّ بلا رأس — النقطة تسمح مقيّدةً
 *     بـ 10/دقيقة لكل IP (نكتب اللقطة نفسها المحسوبة من القاعدة — لا تسريب
 *     ولا بيانات، وأسوأ حالة حمل محدود) — ضبط CRON_SECRET يشدّدها تلقائياً.
 *
 * سلسلة التواريخ (v5.1): كرون واحد يومي 00:00 الرياض (حد Hobby في Vercel)
 * يولّد اليومية دائماً، والأسبوعية أول الاثنين، والشهرية أول الشهر —
 * عبر dueKinds()، وكلها idempotent بمفتاح فريد [kind, periodStart].
 * الفترات كلها بتوقيت الرياض عبر periodFor() — أُصلحت v5.0 التي كانت
 * تحسب اليوم بمنتصف ليل UTC فتُسقط مبيعات المساء في اليوم الخطأ.
 *
 * البريد (v5.1): بعد نجاح اللقطة اليومية، إن ضُبط RESEND_API_KEY و
 * REPORT_EMAIL_TO يُرسل ملخص عربي عبر Resend — best-effort لا يُسقط التوليد.
 * v5.3: مع الملخص يُفحص التحويلات المعلقة — إن وُجدت يُرسل تنبيه منفصل
 * بقائمة أقدم 10 بانتظار القبول (نفس بوابة البريد، best-effort).
 */

export const dynamic = "force-dynamic";

/** مقيّد وضع الكرون المفتوح (CRON_SECRET غير مضبوط): 10 محاولات/دقيقة لكل IP */
const snapshotRateLimiter = createDbRateLimiter(10, 60);

export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const kindParam = request.nextUrl.searchParams.get("kind") ?? "";
  const kindFilter = kindParam && isSnapshotKind(kindParam) ? kindParam : undefined;

  const snapshots = await db.reportSnapshot.findMany({
    where: kindFilter ? { kind: kindFilter } : undefined,
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
    if (auth === `Bearer ${cronSecret}`) return runCadence(request);
    // لا رأس مطابق ⇒ التشغيل اليدوي: جلسة مدير حصراً
    const { error } = await requireRole("admin");
    if (error) return error;
    return runCadence(request);
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
  return runCadence(request);
}

/** حلّ النوع المطلوب من الاستعلام (الافتراضي يومي) */
function requestedKind(request: NextRequest): SnapshotKind {
  const k = request.nextUrl.searchParams.get("kind") ?? "daily";
  return isSnapshotKind(k) ? k : "daily";
}

/** يبني بيانات الفترة ويكتبها (upsert idempotent) — يُرجع بياناتها للبريد */
async function writeSnapshot(kind: SnapshotKind, now: Date) {
  const { periodStart, periodEnd } = periodFor(kind, now);
  const start = periodStart;
  const end = periodEnd;
  const todayUtc = end.getTime();

  const salesAgg = await db.sale.aggregate({
    _sum: { netAmount: true, discount: true },
    where: { saleDate: { gte: start, lt: end }, status: "completed" },
  });
  const salesCount = await db.sale.count({
    where: { saleDate: { gte: start, lt: end }, status: "completed" },
  });
  const voided = await db.sale.count({
    where: { saleDate: { gte: start, lt: end }, status: "void" },
  });

  const topItems = await db.saleItem.groupBy({
    by: ["medicineName"],
    _sum: { quantity: true, subtotal: true },
    where: { sale: { saleDate: { gte: start, lt: end }, status: "completed" } },
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
    where: { createdAt: { gte: start, lt: end } },
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
    where: { kind_periodStart: { kind, periodStart } },
    update: { data, periodEnd },
    create: { kind, periodStart, periodEnd, data },
  });
  return snapshot;
}

/** التنفيذ الفعلي: اللقطة المطلوبة + سلسلة التواريخ + بريد اليومية */
async function runCadence(request: NextRequest) {
  try {
    const kind = requestedKind(request);
    const now = new Date();
    const done: string[] = [];

    // التشغيل اليدوي بنوع محدد يولّده حصراً؛ الكرون (بلا kind أو kind=daily)
    // يمرّ عبر سلسلة dueKinds ليلتقط الأسبوعية/الشهرية في موعدهما.
    const manualKind = request.nextUrl.searchParams.get("kind");
    const kinds = manualKind && isSnapshotKind(manualKind) ? [kind] : dueKinds(now);

    let dailyData: SnapshotEmailData | null = null;
    for (const k of kinds) {
      const snap = await writeSnapshot(k, now);
      done.push(k);
      if (k === "daily") dailyData = snap.data as SnapshotEmailData;
    }

    // بريد ملخص اليومية — best-effort لا يُسقط الاستجابة
    let emailed = false;
    let transfersAlerted = false;
    let expiryAlerted = false;
    // v5.4 — تقليم سجل التدقيق مع الدورة اليومية (الاحتفاظ سنة — صيانة بلا تدخل)
    const auditPruned = await pruneAuditLogs(db, now);
    if (dailyData) {
      const cfg = emailConfigFromEnv();
      if (cfg) {
        const period = periodFor("daily", now);
        const res = await sendSnapshotEmail(
          cfg,
          `تقرير يومي — صيدلية رُبى (${period.label})`,
          snapshotEmailHtml(period, dailyData)
        );
        emailed = res.ok;

        // v5.3 — تنبيه التحويلات المعلقة مع التقرير اليومي (best-effort)
        try {
          const pendingCount = await db.stockTransfer.count({ where: { status: "pending" } });
          if (pendingCount > 0) {
            const pending = await db.stockTransfer.findMany({
              where: { status: "pending" },
              orderBy: { createdAt: "asc" },
              take: 10,
              select: {
                quantity: true,
                createdAt: true,
                medicine: { select: { name: true } },
                fromBranch: { select: { name: true } },
                toBranch: { select: { name: true } },
                createdBy: { select: { username: true } },
              },
            });
            const info: PendingTransferInfo[] = pending.map((t) => ({
              medicineName: t.medicine.name,
              fromName: t.fromBranch?.name ?? null,
              toName: t.toBranch.name,
              quantity: t.quantity,
              createdAt: t.createdAt,
              creator: t.createdBy?.username ?? null,
            }));
            const alert = await sendSnapshotEmail(
              cfg,
              `تنبيه: ${pendingCount} تحويل مخزون معلق — صيدلية رُبى`,
              transfersAlertHtml(info, pendingCount)
            );
            transfersAlerted = alert.ok;
          }
        } catch {
          // التنبيه best-effort — فشله لا يمس التقرير
        }

        // v5.5 — تنبيه انتهاء الصلاحية (منتهية + خلال 60 يوماً) مع التقرير اليومي
        try {
          const in60 = new Date(now.getTime() + 60 * 24 * 3600 * 1000);
          const expiring = await db.batch.findMany({
            where: {
              isActive: true,
              isRecalled: false,
              quantity: { gt: 0 },
              expiryDate: { lte: in60 },
            },
            orderBy: { expiryDate: "asc" },
            take: 40,
            select: {
              lotNumber: true,
              quantity: true,
              unitCost: true,
              expiryDate: true,
              medicine: { select: { name: true } },
            },
          });
          if (expiring.length > 0) {
            const info: ExpiringBatchInfo[] = expiring.map((b) => ({
              medicineName: b.medicine.name,
              lotNumber: b.lotNumber,
              quantity: b.quantity,
              unitCost: b.unitCost,
              expiryDate: b.expiryDate,
            }));
            const alert = await sendSnapshotEmail(
              cfg,
              `تنبيه صلاحية: ${info.length} دفعة خلال 60 يوماً — صيدلية رُبى`,
              expiryAlertHtml(info, now)
            );
            expiryAlerted = alert.ok;
          }
        } catch {
          // التنبيه best-effort — فشله لا يمس التقرير
        }
      }
    }

    return ok({ created: true, kinds: done, emailed, transfersAlerted, expiryAlerted, auditPruned });
  } catch {
    return fail("تعذر توليد لقطة التقرير", 500);
  }
}
