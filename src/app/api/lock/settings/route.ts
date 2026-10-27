import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { clientIp } from "@/lib/auth";
import { getLockConfig, setLockConfig } from "@/lib/lock-config";
import { recordLockAdminAudit } from "@/lib/system-lock";

/**
 * GET /api/lock/settings — v5.0 قراءة إعدادات بوابة القفل (مدير حصراً)
 * PUT /api/lock/settings — حفظ { mode?, ttlHours? } مع تدقيق باسم المدير
 *
 * القيم تُطبَّق عند إصدار مفاتيح الفتح الجديدة — المفاتيح القائمة تكمل
 * صلاحيتها (تصميم قياسي: لا يُقصَّر مفتاح قائم بأثر رجعي).
 */
export async function GET() {
  const { user, error } = await requireRole("admin");
  if (error) return error;

  const cfg = await getLockConfig(true);
  return ok({
    mode: cfg.mode,
    ttlHours: cfg.ttlHours,
    epoch: cfg.epoch,
    source: cfg.source,
    limits: { minTtlHours: 1, maxTtlHours: 168, modes: ["admin", "users"] },
  });
}

export async function PUT(request: NextRequest) {
  const { user, error } = await requireRole("admin");
  if (error) return error;

  try {
    const body = await request.json().catch(() => null);
    const mode = (body as { mode?: unknown } | null)?.mode;
    const ttlHours = (body as { ttlHours?: unknown } | null)?.ttlHours;

    const patch: { mode?: "admin" | "users"; ttlHours?: number } = {};
    if (mode !== undefined) {
      const m = String(mode).trim().toLowerCase();
      if (m !== "admin" && m !== "users") return fail("الوضع يجب أن يكون admin أو users");
      patch.mode = m;
    }
    if (ttlHours !== undefined) {
      const v = Number(ttlHours);
      if (!Number.isFinite(v) || v < 1 || v > 168)
        return fail("المدة يجب أن تكون بين 1 و168 ساعة");
      patch.ttlHours = v;
    }
    if (Object.keys(patch).length === 0) return fail("لا تغييرات مطلوبة");

    const cfg = await setLockConfig(patch, user.username);
    const h = await headers();
    await recordLockAdminAudit("system-lock-settings", user.id, user.username, clientIp(h));

    return ok({
      saved: true,
      mode: cfg.mode,
      ttlHours: cfg.ttlHours,
      epoch: cfg.epoch,
      source: cfg.source,
      note: "تُطبَّق على مفاتيح الفتح الجديدة — القائمة تكمل صلاحيتها",
    });
  } catch {
    return fail("تعذر حفظ إعدادات القفل", 500);
  }
}
