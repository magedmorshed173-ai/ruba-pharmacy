import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { toInt } from "@/lib/money";
import { aggregateProfit, profitPerMedicine, dailyProfitSeries } from "@/lib/profit";

/**
 * GET /api/reports/profit?days=30 — تقرير الأرباح بالتكلفة الفعلية للدفعات
 * صيدلي فما فوق — بيانات مالية حساسة.
 * مبيعات ما قبل v3.3 بلا لقطة تكلفة (costHalalas=0) — يُبلَّغ عنها كنسبة تغطية.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireRole("pharmacist");
  if (error) return error;

  const days = Math.min(180, Math.max(7, toInt(request.nextUrl.searchParams.get("days"), 30)));
  const from = new Date(Date.now() - days * 86400000);

  try {
    const sales = await db.sale.findMany({
      where: { saleDate: { gte: from }, status: "completed" },
      include: { items: { select: { medicineName: true, quantity: true, subtotal: true, costHalalas: true } } },
      orderBy: { saleDate: "asc" },
    });

    const summary = aggregateProfit(sales);
    const byMedicine = profitPerMedicine(sales, 20);
    const series = dailyProfitSeries(sales, days);

    return ok({
      days,
      summary,
      byMedicine,
      series,
      note:
        summary.unknownCostItems > 0
          ? `${summary.unknownCostItems} بنداً من مبيعات ما قبل v3.3 بلا لقطة تكلفة — الربح الفعلي أعلى مما يظهر`
          : null,
    });
  } catch {
    return fail("تعذر حساب تقرير الأرباح", 500);
  }
}
