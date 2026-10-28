import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, requireRole } from "@/lib/api-guard";
import { buildXlsx, XLSX_MIME, type XlsxSheet } from "@/lib/xlsx";

/**
 * v5.3 — تصدير الفواتير إلى Excel (XLSX حقيقي بلا مكتبات)
 *
 * GET /api/reports/sales/export?days=30 — صيدلي فما فوق، خلف بوابة القفل.
 *   • days: نافذة الأيام (1..365، الافتراضي 30).
 * ورقة «الفواتير»: آخر 2000 فاتورة ضمن النافذة (مكتملة وملغاة) بمرجعها
 * والتاريخ والفرع والصيدلي والعميل وطريقة الدفع والمبالغ (بالريال عشرياً)
 * والضريبة وحصة المؤمن وحالة المطالبة.
 * ورقة «البنود»: تفكيك بنود الفواتير المكتملة (دواء/كمية/سعر/إجمالي/تكلفة).
 * الأعمدة محدودة العدد عمداً لإبقاء التنزيل سريعاً ضمن حدود الذاكرة.
 */

export const dynamic = "force-dynamic";

const MAX_DAYS = 365;
const TAKE_SALES = 2000;
const TAKE_ITEMS = 10000;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const PAY_AR: Record<string, string> = {
  cash: "نقدي",
  card: "شبكة",
  insurance: "تأمين",
};

export async function GET(request: NextRequest) {
  const { error } = await requireRole("pharmacist");
  if (error) return error;

  try {
    const daysRaw = Number(request.nextUrl.searchParams.get("days") ?? "30");
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.floor(daysRaw), 1), MAX_DAYS) : 30;
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);

    const sales = await db.sale.findMany({
      where: { saleDate: { gte: since } },
      orderBy: { saleDate: "desc" },
      take: TAKE_SALES,
      select: {
        reference: true,
        saleDate: true,
        status: true,
        customerName: true,
        paymentMethod: true,
        totalAmount: true,
        discount: true,
        netAmount: true,
        vatTotal: true,
        invoiceNumber: true,
        insurerAmount: true,
        patientAmount: true,
        claimStatus: true,
        user: { select: { username: true } },
        branch: { select: { name: true } },
        items: {
          take: TAKE_ITEMS,
          select: {
            medicineName: true,
            quantity: true,
            unitPrice: true,
            subtotal: true,
            costHalalas: true,
          },
        },
      },
    });
    if (sales.length === 0) return fail("لا فواتير ضمن النافذة المحددة", 404);

    const sar = (h: unknown) => num(h) / 100;
    const day = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

    // ── ورقة الفواتير ──
    const salesRows: (string | number | null)[][] = [
      [
        "المرجع",
        "رقم الفاتورة",
        "التاريخ",
        "الفرع",
        "الصيدلي",
        "العميل",
        "الدفع",
        "الحالة",
        "الإجمالي (ر.س)",
        "الخصم (ر.س)",
        "الصافي (ر.س)",
        "الضريبة (ر.س)",
        "حصة المؤمن (ر.س)",
        "حصة المريض (ر.س)",
        "المطالبة",
      ],
      ...sales.map((s) => [
        s.reference,
        s.invoiceNumber ?? "",
        day(s.saleDate),
        s.branch?.name ?? "—",
        s.user.username,
        s.customerName,
        PAY_AR[s.paymentMethod] ?? s.paymentMethod,
        s.status === "completed" ? "مكتملة" : "ملغاة",
        sar(s.totalAmount),
        sar(s.discount),
        sar(s.netAmount),
        sar(s.vatTotal),
        sar(s.insurerAmount),
        sar(s.patientAmount),
        s.claimStatus ?? "",
      ]),
    ];

    // ── ورقة البنود (المكتملة فقط — الملغاة لا تُحتسب بنداً فعلياً) ──
    const itemRows: (string | number | null)[][] = [
      ["المرجع", "التاريخ", "الدواء", "الكمية", "سعر الوحدة (ر.س)", "الإجمالي (ر.س)", "التكلفة (ر.س)", "هامش (ر.س)"],
    ];
    for (const s of sales) {
      if (s.status !== "completed") continue;
      for (const it of s.items) {
        itemRows.push([
          s.reference,
          day(s.saleDate),
          it.medicineName,
          it.quantity,
          sar(it.unitPrice),
          sar(it.subtotal),
          sar(it.costHalalas),
          sar(it.subtotal - it.costHalalas),
        ]);
      }
    }

    const sheets: XlsxSheet[] = [
      { name: "الفواتير", rows: salesRows },
      { name: "البنود", rows: itemRows },
    ];
    const bytes = buildXlsx(sheets);

    const today = new Date().toISOString().slice(0, 10);
    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": XLSX_MIME,
        "content-disposition": `attachment; filename="ruba-sales-${days}d-${today}.xlsx"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return fail("تعذر توليد ملف Excel", 500);
  }
}
