import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { parseAuditQuery } from "@/lib/audit";

/**
 * v5.4 — سجل التدقيق الشامل (مدير حصراً)
 *
 * GET /api/audit?days=30&action=sale&page=1&pageSize=50
 *   • days: نافذة الأيام (1..365، الافتراضي 30).
 *   • action: مجموعة (بادئة قبل النقطة، مثل sale) أو إجراء كامل (sale.void).
 *   • page/pageSize: ترقيم (سقف الصفحة 100).
 * الأحدث أولاً — الإجمالي يعود لشرائح الترقيم في الواجهة.
 * meta يُعاد خاماً (JSON) — الواجهة تعرضه بتفصيل قابل للتوسيع.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { error } = await requireRole("admin");
  if (error) return error;

  try {
    const q = parseAuditQuery(request.nextUrl.searchParams);
    const since = new Date(Date.now() - q.days * 86_400_000);

    const where = {
      createdAt: { gte: since },
      ...(q.action
        ? q.action.includes(".")
          ? { action: q.action }
          : { action: { startsWith: `${q.action}.` } }
        : {}),
    };

    const [logs, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.auditLog.count({ where }),
    ]);

    return ok({ logs, total, page: q.page, pageSize: q.pageSize, days: q.days, action: q.action });
  } catch {
    return fail("تعذر جلب سجل التدقيق", 500);
  }
}
