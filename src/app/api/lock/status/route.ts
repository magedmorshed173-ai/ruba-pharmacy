import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import {
  LOCK_COOKIE,
  LOCK_PURPOSE,
  DEV_FALLBACK_SECRET,
  lockEpoch,
  lockMode,
  lockWarnBeforeSec,
} from "@/lib/lock-shared";
import { lockTtlSec } from "@/lib/system-lock";

/**
 * GET /api/lock/status — v4.8 حالة مفتاح النظام على هذا الجهاز
 *
 * مسار عام (ضمن /api/lock) لكنه لا يكشف شيئاً عن بيانات النظام:
 *  - مقفل؟  ⇒ { locked: true } فقط — لا شيء آخر.
 *  - مفتوح؟ ⇒ موعد الانتهاء (يجيزه صاحب الجهاز نفسه) + متى يبدأ التنبيه
 *             + وضع المفاتيح (admin/users) لتكيّف الشاشات.
 *
 * الاستخدام: مراقب انتهاء الصلاحية في الواجهة (LockExpiryWatcher) يحاورها
 * كل دقيقة — يحذّر قبل الانتهاء بتمديد داخلي بلا خسارة حالة الصفحة،
 * ويعيد التوجيه إلى /lock فور الانتهاء أو السحب (LOCK_EPOCH).
 *
 * ملاحظات أمنية:
 *  - التحقق توقيعي حصراً (jose) — بلا قاعدة بيانات، زمن ثابت تقريباً.
 *  - Cache-Control: no-store — الحالة لا تُخبَّز في أي طبقة (متوافق مع
 *    سياسة الـ SW: مسارات /api لا تُخبَّز أصلاً).
 */
export const dynamic = "force-dynamic";

const lockSecret = new TextEncoder().encode(
  process.env.AUTH_SECRET || DEV_FALLBACK_SECRET
);

export async function GET(request: NextRequest) {
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
        payload.epoch === lockEpoch() &&
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
      warnBeforeSec: lockWarnBeforeSec(lockTtlSec()),
      mode: lockMode(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
