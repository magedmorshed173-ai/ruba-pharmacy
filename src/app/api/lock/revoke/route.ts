import { headers } from "next/headers";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { clientIp } from "@/lib/auth";
import { bumpLockEpoch } from "@/lib/lock-config";
import { recordLockAdminAudit } from "@/lib/system-lock";

/**
 * POST /api/lock/revoke — v5.0 سحب كل مفاتيح فتح النظام فوراً (مدير حصراً)
 *
 * يرفع epoch القاعدة فوق أي قيمة قائمة ⇒ المفاتيح الصادرة سلفاً تفشل
 * في /api/lock/status وفحوص الحالة العددية، ويلتقطها المراقب خلال دقيقة
 * (تمحيص خبز الصفحات + توجيه إلى /lock) — ورافعة LOCK_EPOCH البيئية
 * تبقى الأعلى دائماً للطوارئ الكبرى.
 */
export async function POST() {
  const { user, error } = await requireRole("admin");
  if (error) return error;

  try {
    const epoch = await bumpLockEpoch(user.username);
    const h = await headers();
    await recordLockAdminAudit("system-lock-revoke", user.id, user.username, clientIp(h));
    return ok({ revoked: true, epoch });
  } catch {
    return fail("تعذر سحب المفاتيح — أعد المحاولة", 500);
  }
}
