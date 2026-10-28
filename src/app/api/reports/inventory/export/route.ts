import { db } from "@/lib/db";
import { fail, requireRole } from "@/lib/api-guard";
import { buildXlsx, XLSX_MIME, type XlsxSheet } from "@/lib/xlsx";

/**
 * v5.2 — تصدير المخزون إلى Excel (XLSX حقيقي بلا مكتبات)
 *
 * GET /api/reports/inventory/export — صيدلي فما فوق، خلف بوابة القفل.
 * ورقة «المخزون»: كل دواء نشط برصيده المركزي والمخصص للفروع وغير المخصص،
 * والحد الأدنى وأقرب صلاحية والأسعار (بالريال عشرياً).
 * ورقة «توزيع الفروع»: تفكيك مرايا BranchStock لكل دواء/فرع.
 */

export const dynamic = "force-dynamic";

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET() {
  const { error } = await requireRole("pharmacist");
  if (error) return error;

  try {
    const meds = await db.medicine.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: {
        category: { select: { name: true } },
        branchStocks: { include: { branch: { select: { name: true } } } },
      },
    });
    if (meds.length === 0) return fail("لا مخزون لتصديره", 404);

    const sar = (h: unknown) => num(h) / 100;

    // ── ورقة المخزون ──
    const mainRows: (string | number | null)[][] = [
      [
        "الدواء",
        "الباركود",
        "التصنيف",
        "الرصيد المركزي",
        "المخصص للفروع",
        "غير المخصص",
        "الحد الأدنى",
        "أقرب صلاحية",
        "سعر البيع (ر.س)",
        "سعر الشراء (ر.س)",
        "يتطلب وصفة",
      ],
      ...meds.map((m) => {
        const assigned = m.branchStocks.reduce((a, r) => a + r.quantity, 0);
        return [
          m.name,
          m.barcode,
          m.category.name,
          m.quantity,
          assigned,
          m.quantity - assigned,
          m.minQuantity,
          m.expiryDate.toISOString().slice(0, 10),
          sar(m.sellingPrice),
          sar(m.purchasePrice),
          m.requiresPrescription ? "نعم" : "لا",
        ];
      }),
    ];

    // ── ورقة توزيع الفروع ──
    const distRows: (string | number | null)[][] = [
      ["الدواء", "الفرع", "الكمية المخصصة"],
    ];
    for (const m of meds) {
      for (const r of m.branchStocks) {
        if (r.quantity !== 0)
          distRows.push([m.name, r.branch.name, r.quantity]);
      }
    }

    const sheets: XlsxSheet[] = [
      { name: "المخزون", rows: mainRows },
      { name: "توزيع الفروع", rows: distRows },
    ];
    const bytes = buildXlsx(sheets);

    const today = new Date().toISOString().slice(0, 10);
    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": XLSX_MIME,
        "content-disposition": `attachment; filename="ruba-inventory-${today}.xlsx"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return fail("تعذر توليد ملف Excel", 500);
  }
}
