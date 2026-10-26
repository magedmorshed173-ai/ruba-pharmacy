import { cookies } from "next/headers";
import { db } from "@/lib/db";
import {
  COOKIE_NAME,
  hashToken,
  revokeAllUserSessions,
} from "@/lib/auth";
import { fail, ok, requireAuth } from "@/lib/api-guard";

/**
 * GET /api/auth/sessions — أجهزتي النشطة (v3.9)
 * قائمة جلسات المستخدم الحالي الحية: الجهاز، IP، بداية الجلسة، آخر استخدام،
 * وعلامة current على جهاز هذا الطلب — شفافية كاملة: المستخدم يرى من داخل.
 */
export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const tokenHash = hashToken((await cookies()).get(COOKIE_NAME)?.value ?? "");
  const sessions = await db.session.findMany({
    where: { userId: user.id, revokedAt: null },
    orderBy: { lastUsedAt: "desc" },
    select: {
      id: true,
      ip: true,
      userAgent: true,
      createdAt: true,
      lastUsedAt: true,
      tokenHash: true,
    },
  });

  return ok({
    sessions: sessions.map((s) => ({
      id: s.id,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      current: s.tokenHash === tokenHash,
    })),
  });
}

/**
 * POST /api/auth/sessions — إنهاء كل الأجهزة الأخرى (v3.9)
 * يبقي جهاز الطلب الحالي حياً ويسحب كل جلسات المستخدم الأخرى فوراً —
 * الجهاز المفقود أو المتصفح المنسي يصبح توكنه ورقة بلا قيمة.
 */
export async function POST() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return fail("لا توجد جلسة فعالة", 401);

  const revoked = await revokeAllUserSessions(user.id, hashToken(token));
  return ok({
    revoked,
    message: `تم إنهاء ${revoked} جلسة/جلسات أخرى — جهازك الحالي باقٍ`,
  });
}
