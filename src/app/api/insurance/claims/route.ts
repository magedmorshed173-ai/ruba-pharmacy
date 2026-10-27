import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";
import { toInt } from "@/lib/money";

/**
 * GET /api/insurance/claims?status=&providerId=&days=&page= — سجل مطالبات التأمين
 * كل فاتورة تأمين مكتملة = مطالبة — مع ملخص إجمالي بحسب الحالة (قابلية تحصيل)
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const status = sp.get("status")?.trim() ?? "";
  const providerId = sp.get("providerId")?.trim() ?? "";
  const days = Math.min(365, Math.max(1, toInt(sp.get("days"), 90)));
  const page = Math.max(1, toInt(sp.get("page"), 1));
  const pageSize = Math.min(100, Math.max(5, toInt(sp.get("pageSize"), 15)));

  const since = new Date();
  since.setDate(since.getDate() - days);

  const where: Record<string, unknown> = {
    claimStatus: { not: null },
    status: "completed",
    saleDate: { gte: since },
  };
  if (status) where.claimStatus = status;
  if (providerId) where.insuranceProviderId = providerId;

  try {
    const [total, claims, summary] = await Promise.all([
      db.sale.count({ where }),
      db.sale.findMany({
        where,
        include: {
          insuranceProvider: { select: { id: true, name: true, code: true } },
          insurancePolicy: { select: { id: true, policyNumber: true, holderName: true } },
          user: { select: { username: true, fullName: true } },
        },
        orderBy: { saleDate: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.sale.groupBy({
        by: ["claimStatus"],
        where: {
          claimStatus: { not: null },
          status: "completed",
          saleDate: { gte: since },
        },
        _count: { _all: true },
        _sum: { insurerAmount: true, patientAmount: true, netAmount: true },
      }),
    ]);

    return ok({
      total,
      page,
      pageSize,
      days,
      claims,
      summary: summary.map((s) => ({
        status: s.claimStatus,
        count: s._count._all,
        insurerHalalas: s._sum.insurerAmount ?? 0,
        patientHalalas: s._sum.patientAmount ?? 0,
        totalHalalas: s._sum.netAmount ?? 0,
      })),
    });
  } catch {
    return fail("تعذر جلب مطالبات التأمين", 500);
  }
}
