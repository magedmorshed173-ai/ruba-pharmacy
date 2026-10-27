import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import {
  LOCK_COOKIE,
  LOCK_PURPOSE,
  DEV_FALLBACK_SECRET,
} from "@/lib/lock-shared";
import { getLockConfig } from "@/lib/lock-config";

/**
 * GET /api/lock/status — v4.8 حالة مفتاح النظام على هذا الجهاز (محدَّث v5.0)
 *
 * مسار عام (ضمن /api/lock) لكنه لا يكشف شيئاً عن بيانات النظام:
 *  - مقفل؟  ⇒ { locked: true } فقط.
 *  - مفتوح؟ ⇒ موعد الانتهاء + متى يبدأ التنبيه + وضع المفاتيح الفعلي
 *             (من الإعدادات الحية v5.0 — قاعدة أولاً مع رجوع للبيئة).
 *
 * ملاحظات أمنية:
 *  - مقارنة epoch عددية (>=) متسقة مع الـ middleware — السحب من اللوحة
 *    أو البيئة يميت المفاتيح الأدنى هنا أيضاً فيلتقطها المراقب خلال دقيقة.
 *  - Cache-Control: no-store.
 */
export const dynamic = "force-dynamic";

const lockSecret = new TextEncoder().encode(
  process.env.AUTH_SECRET || DEV_FALLBACK_SECRET
);

export async function GET(request: NextRequest) {
  const cfg = await getLockConfig();
  const token = request.cookies.get(LOCK_COOKIE)?.value;
  let locked = true;
  let expiresAt: string | null = null;

  if (token) {
    try {
      const { payload } = await jwtVerify(token, lockSecret, {
        // نفس سماحية الـ middleware — دقيقة واحدة للفروق الزمنية
        clockTolerance: 60,
      });
      if (
        payload.purpose === LOCK_PURPOSE &&
        Number(payload.epoch) >= Number(cfg.epoch) &&
        typeof payload.exp === "number"
      ) {
        locked = false;
        expiresAt = new Date(payload.exp * 1000).toISOString();
      }
    } catch {
      /* توكن غائب/منتهٍ/مفبرك ⇒ مقفل */
    }
  }

  return NextResponse.json(
    {
      locked,
      expiresAt,
      warnBeforeSec: Math.max(60, Math.min(10 * 60, Math.floor((cfg.ttlHours * 3600) / 6))),
      mode: cfg.mode,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
