import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, requireAuth } from "@/lib/api-guard";
import { buildXlsx, XLSX_MIME, type XlsxSheet } from "@/lib/xlsx";
import { KIND_LABEL_AR, fmtAstDate, isSnapshotKind, type SnapshotKind } from "@/lib/report-periods";

/**
 * v5.1 — تصدير اللقطات إلى Excel (XLSX حقيقي، صفري الاعتماد)
 *
 * GET /api/reports/snapshot/export[?kind=daily|weekly|monthly]
 *   — خلف بوابة القفل + جلسة (نمط GET الموحد).
 *   — ورقة «اللقطات»: آخر 90 لقطة بمؤشراتها (الإيراد بالريال عشرياً).
 *   — ورقة «أعلى الأصناف»: تفكيك topItems لآخر 30 لقطة.
 *   — الأوراق RTL والنصوص العربية inline — تُفتح سليمة في Excel/LibreOffice.
 */

export const dynamic = "force-dynamic";

const KIND_ALL = "all";
const TAKE_MAIN = 90;
const TAKE_TOP = 30;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

interface SnapLike {
  id: string;
  kind: string;
  periodStart: Date;
  periodEnd: Date;
  data: unknown;
}

export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const kindParam = request.nextUrl.searchParams.get("kind") ?? KIND_ALL;
    const where =
      kindParam !== KIND_ALL && isSnapshotKind(kindParam) ? { kind: kindParam } : undefined;

    const snaps: SnapLike[] = await db.reportSnapshot.findMany({
      where,
      orderBy: { periodStart: "desc" },
      take: TAKE_MAIN,
    });
    if (snaps.length === 0) return fail("لا لقطات لتصديرها بعد", 404);

    const kindAr = (k: string) =>
      isSnapshotKind(k) ? KIND_LABEL_AR[k as SnapshotKind] : k;

    // ── ورقة اللقطات ──
    const mainRows: (string | number | null)[][] = [
      [
        "النوع",
        "الفترة من",
        "الفترة إلى",
        "الفواتير",
        "صافي الإيراد (ر.س)",
        "الخصومات (ر.س)",
        "فواتير ملغاة",
        "وصفات",
        "أصناف تحت الحد",
        "دفعات ≤30 يوم",
        "وُلّدت",
      ],
      ...snaps.map((s) => {
        const d = (s.data ?? {}) as Record<string, unknown>;
        return [
          kindAr(s.kind),
          fmtAstDate(new Date(s.periodStart)),
          fmtAstDate(new Date(s.periodEnd)),
          num(d.salesCount),
          num(d.netRevenueHalalas) / 100,
          num(d.discountHalalas) / 100,
          num(d.voidedCount),
          num(d.prescriptionsCount),
          num(d.lowStockCount),
          num(d.expiringBatches30),
          d.generatedAt ? String(d.generatedAt).slice(0, 16).replace("T", " ") : "",
        ];
      }),
    ];

    // ── ورقة أعلى الأصناف (آخر 30 لقطة) ──
    const topRows: (string | number | null)[][] = [
      ["الفترة", "النوع", "الصنف", "الكمية", "الإيراد (ر.س)"],
    ];
    for (const s of snaps.slice(0, TAKE_TOP)) {
      const d = (s.data ?? {}) as Record<string, unknown>;
      const items = Array.isArray(d.topItems) ? d.topItems : [];
      for (const it of items as Record<string, unknown>[]) {
        topRows.push([
          fmtAstDate(new Date(s.periodStart)),
          kindAr(s.kind),
          String(it.name ?? "—"),
          num(it.qty),
          num(it.subtotalHalalas) / 100,
        ]);
      }
    }

    const sheets: XlsxSheet[] = [
      { name: "اللقطات", rows: mainRows },
      { name: "أعلى الأصناف", rows: topRows },
    ];
    const bytes = buildXlsx(sheets);

    const today = new Date().toISOString().slice(0, 10);
    const suffix = kindParam !== KIND_ALL ? `-${kindParam}` : "";
    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": XLSX_MIME,
        "content-disposition": `attachment; filename="ruba-snapshots${suffix}-${today}.xlsx"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return fail("تعذر توليد ملف Excel", 500);
  }
}
