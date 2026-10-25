import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth, requireRole } from "@/lib/api-guard";
import { toInt } from "@/lib/money";

// GET /api/notifications?unread=1 — قائمة الإشعارات
export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const unreadOnly = request.nextUrl.searchParams.get("unread") === "1";
  try {
    const [notifications, unreadCount] = await Promise.all([
      db.notification.findMany({
        where: unreadOnly ? { isRead: false } : undefined,
        orderBy: { createdAt: "desc" },
        take: 60,
      }),
      db.notification.count({ where: { isRead: false } }),
    ]);
    return ok({ notifications, unreadCount });
  } catch {
    return fail("تعذر جلب الإشعارات", 500);
  }
}

// POST /api/notifications — تعليم كمقروء { id? , all? }
export async function POST(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const body = await request.json();
    if (body.all) {
      await db.notification.updateMany({ where: { isRead: false }, data: { isRead: true } });
      return ok({ message: "تم تعليم الكل كمقروء" });
    }
    const id = String(body.id ?? "");
    if (!id) return fail("معرّف الإشعار مطلوب");
    await db.notification.update({ where: { id }, data: { isRead: true } });
    return ok({ message: "تم التعليم كمقروء" });
  } catch {
    return fail("تعذر تحديث الإشعار", 500);
  }
}

// PUT /api/notifications — توليد إشعارات ذكية (صيدلي فما فوق) مع dedupeKey فريد
export async function PUT() {
  const { error } = await requireRole("pharmacist");
  if (error) return error;

  try {
    const now = new Date();
    const in90 = new Date(now.getTime() + 90 * 86400000);
    const today = new Date(now.toISOString().slice(0, 10));
    const dayKey = now.toISOString().slice(0, 10);
    let created = 0;

    // قرب انتهاء الصلاحية (خلال 90 يوماً)
    const expiring = await db.medicine.findMany({
      where: { isActive: true, expiryDate: { gt: today, lte: in90 } },
      select: { id: true, name: true, barcode: true, expiryDate: true, quantity: true },
    });

    // نقص المخزون
    const low = await db.medicine.findMany({
      where: { isActive: true, quantity: { lte: db.medicine.fields.minQuantity } },
      select: { id: true, name: true, barcode: true, quantity: true, minQuantity: true },
    });

    const ops = [
      ...expiring.map((m) => ({
        kind: "expiry",
        title: `قرب انتهاء الصلاحية: ${m.name}`,
        body: `ينتهي بتاريخ ${m.expiryDate.toISOString().slice(0, 10)} — الكمية المتبقية ${m.quantity}`,
        dedupeKey: `expiry:${m.id}:${dayKey}`,
      })),
      ...low.map((m) => ({
        kind: "low_stock",
        title: `نقص مخزون: ${m.name}`,
        body: `الكمية ${m.quantity} ≤ الحد الأدنى ${m.minQuantity}`,
        dedupeKey: `low:${m.id}:${dayKey}`,
      })),
    ];

    for (const op of ops) {
      try {
        await db.notification.create({ data: op });
        created++;
      } catch {
        // مكرر اليوم — تجاهل (dedupeKey unique)
      }
    }

    return ok({ created, message: `تم إنشاء ${created} إشعار جديد` });
  } catch {
    return fail("تعذر توليد الإشعارات", 500);
  }
}
