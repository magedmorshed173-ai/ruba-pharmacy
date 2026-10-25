import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { toInt } from "@/lib/money";

/**
 * GET /api/auth/login-audits?limit=100 — آخر محاولات الدخول (مدير فقط)
 * كل محاولة: المستخدم المُحاول، النجاح/الفشل، IP، وكيل المتصفح.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireRole("admin");
  if (error) return error;

  const limit = Math.min(300, Math.max(10, toInt(request.nextUrl.searchParams.get("limit"), 100)));
  try {
    const [audits, failedLast24h] = await Promise.all([
      db.loginAudit.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      db.loginAudit.count({
        where: { success: false, createdAt: { gte: new Date(Date.now() - 86400000) } },
      }),
    ]);
    return ok({ audits, failedLast24h });
  } catch {
    return fail("تعذر جلب سجل الدخول", 500);
  }
}
