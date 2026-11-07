import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, requireRole } from "@/lib/api-guard";
import { buildXlsx, XLSX_MIME, type XlsxSheet } from "@/lib/xlsx";
import { computeVariance, STOCK_COUNT_STATUS_AR } from "@/lib/stocktake";

/**
 * v5.6 — تصدير تقرير فروقات الجرد إلى Excel (صيدلي+)
 *
 * GET /api/stocktake/:id/export — ورقة «فروقات الجرد»: ترويسة الجلسة
 * (الرقم، الحالة، الفتح/التطبيق بالمسؤول بتوقيت الرياض) ثم بند لكل دفعة
 * مجمّدة: الدواء، التشغيلة، الانتهاء، تكلفة الوحدة، رصيد النظام لحظة
 * الفتح، المعدود، الفرق، قيمة الفرق بالريال، الحالة.
 * الفروق في التقرير مقابل الرصيد المجمّد (وثيقة العدّ) — التطبيق الفعلي
 * يقيس مقابل الحي ويُوثَّق في سجل التدقيق.
 */

export const dynamic = "force-dynamic";

const AST = 3 * 3600_000;
const stamp = (d: Date | null) =>
  d ? new Date(d.getTime() + AST).toISOString().slice(0, 16).replace("T", " ") : "—";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireRole("pharmacist");
  if (error) return error;

  const { id } = await params;
  const count = await db.stockCount.findUnique({
    where: { id },
    include: {
      openedBy: { select: { fullName: true } },
      closedBy: { select: { fullName: true } },
      items: { orderBy: [{ medicineName: "asc" }, { lotNumber: "asc" }] },
    },
  });
  if (!count) return fail("جلسة الجرد غير موجودة", 404);
  if (count.items.length === 0) return fail("لا بنود في هذه الجلسة", 404);

  const { rows: classified } = computeVariance(
    count.items.map((i) => ({
      systemQty: i.systemQty,
      countedQty: i.countedQty,
      unitCost: i.unitCost,
    }))
  );

  const statusAr =
    STOCK_COUNT_STATUS_AR[count.status as keyof typeof STOCK_COUNT_STATUS_AR] ??
    count.status;

  const rows: (string | number | null)[][] = [
    ["تقرير فروقات الجرد الفعلي — ربي فارمسي"],
    [`الجلسة: ${count.number}`, "الحالة:", statusAr],
    ["الفتح:", stamp(count.openedAt), "بواسطة:", count.openedBy?.fullName ?? "—"],
    ["الإغلاق:", stamp(count.closedAt), "بواسطة:", count.closedBy?.fullName ?? "—"],
    ["عدد الدفعات المجمَّدة:", count.batchesTotal, "ملاحظة:", count.note ?? "—"],
    [],
    [
      "الدواء",
      "التشغيلة",
      "الانتهاء",
      "تكلفة الوحدة (ر.س)",
      "رصيد النظام",
      "المعدود",
      "الفرق",
      "قيمة الفرق (ر.س)",
      "الحالة",
    ],
    ...count.items.map((item, i) => {
      const c = classified[i];
      return [
        item.medicineName,
        item.lotNumber,
        new Date(item.expiryDate.getTime() + AST).toISOString().slice(0, 10),
        item.unitCost / 100,
        item.systemQty,
        item.countedQty ?? "—",
        c.kind === "skipped" ? "—" : c.delta,
        c.kind === "skipped" ? "—" : c.costDelta / 100,
        c.kind === "match" ? "مطابق" : c.kind === "increase" ? "زيادة" : c.kind === "decrease" ? "عجز" : "لم يُعدّ",
      ];
    }),
    [],
    ["الملخص (مقابل رصيد لحظة الفتح):"],
    [
      "مطابق:",
      count.status === "closed" ? count.matchedItems : "—",
      "زيادة:",
      count.status === "closed" ? count.increasedItems : "—",
      "عجز:",
      count.status === "closed" ? count.decreasedItems : "—",
      "لم يُعدّ:",
      count.status === "closed" ? count.skippedItems : "—",
    ],
    [
      "صافي فرق الكميات:",
      count.status === "closed" ? count.netQtyDelta : "—",
      "صافي فرق القيمة (ر.س):",
      count.status === "closed" ? count.netCostDelta / 100 : "—",
    ],
  ];

  const sheets: XlsxSheet[] = [{ name: "فروقات الجرد", rows }];
  const bytes = buildXlsx(sheets);
  const today = new Date().toISOString().slice(0, 10);

  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "content-type": XLSX_MIME,
      "content-disposition": `attachment; filename="ruba-stocktake-${count.number}-${today}.xlsx"`,
      "x-content-type-options": "nosniff",
    },
  });
}
