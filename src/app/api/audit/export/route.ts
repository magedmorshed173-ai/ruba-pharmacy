import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, requireRole } from "@/lib/api-guard";
import { buildXlsx, XLSX_MIME, type XlsxSheet } from "@/lib/xlsx";
import { auditLabel } from "@/lib/audit";

/**
 * v5.4 — تصدير سجل التدقيق إلى Excel (مدير حصراً)
 *
 * GET /api/audit/export?days=365 — نافذة 1..365 (الافتراضي 365).
 * ورقة «التدقيق»: آخر 5000 سجل ضمن النافذة — التاريخ/الوقت، الإجراء
 * (بالتسمية العربية)، الكيان، الوصف، الفاعل (الاسم الجامد)، الدور، IP.
 * أعمدة محدودة عمداً — الملف سريع التوليد وخفيف الذاكرة.
 */

export const dynamic = "force-dynamic";

const MAX_DAYS = 365;
const TAKE_LOGS = 5000;

export async function GET(request: NextRequest) {
  const { error } = await requireRole("admin");
  if (error) return error;

  try {
    const daysRaw = Number(request.nextUrl.searchParams.get("days") ?? "365");
    const days = Number.isFinite(daysRaw)
      ? Math.min(Math.max(Math.floor(daysRaw), 1), MAX_DAYS)
      : 365;
    const since = new Date(Date.now() - days * 86_400_000);

    const logs = await db.auditLog.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: TAKE_LOGS,
    });
    if (logs.length === 0) return fail("لا سجلات تدقيق ضمن النافذة المحددة", 404);

    // التوقيت بتوقيت الرياض (UTC+3 ثابت) — نفس منهجية تقارير v5.1
    const AST = 3 * 3600_000;
    const stamp = (d: Date) =>
      new Date(d.getTime() + AST).toISOString().slice(0, 16).replace("T", " ");

    const rows: (string | number | null)[][] = [
      ["التاريخ والوقت", "الإجراء", "الكيان", "الوصف", "الفاعل", "الدور", "IP"],
      ...logs.map((l) => [
        stamp(l.createdAt),
        auditLabel(l.action),
        l.entityType,
        l.summary,
        l.userName ?? "—",
        l.userRole ?? "—",
        l.ip ?? "—",
      ]),
    ];

    const sheets: XlsxSheet[] = [{ name: "التدقيق", rows }];
    const bytes = buildXlsx(sheets);

    const today = new Date().toISOString().slice(0, 10);
    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": XLSX_MIME,
        "content-disposition": `attachment; filename="ruba-audit-${days}d-${today}.xlsx"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return fail("تعذر توليد ملف Excel", 500);
  }
}
