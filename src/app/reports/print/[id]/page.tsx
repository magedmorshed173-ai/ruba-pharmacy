import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/api-guard";
import { db } from "@/lib/db";
import { PrintButton } from "./print-button";

/**
 * v5.0 — صفحة طباعة لقطة تقرير يومي (/reports/print/[id])
 *
 * PDF عربي مثالي عبر محرك الطباعة في المتصفح (RTL أصيل بلا مكتبات PDF
 * التي تكسر تشكيل الحروف) — الصفحة مستقلة بلا قوائم، CSS طباعة نظيف،
 * ومحمية بجلسة صيدلي فما فوق بوابة القفل.
 */

interface SnapshotData {
  salesCount?: number;
  netRevenueHalalas?: number;
  discountHalalas?: number;
  voidedCount?: number;
  topItems?: { name: string; qty: number; subtotalHalalas: number }[];
  lowStockCount?: number;
  expiringBatches30?: number;
  prescriptionsCount?: number;
  generatedAt?: string;
}

export default async function PrintReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/");

  const { id } = await params;
  const { auto } = await searchParams;

  const snapshot = await db.reportSnapshot.findUnique({ where: { id } });
  if (!snapshot) {
    return (
      <div dir="rtl" className="p-10 text-center text-sm text-muted-foreground">
        اللقطة المطلوبة غير موجودة.
      </div>
    );
  }
  const d = (snapshot.data ?? {}) as SnapshotData;
  const sar = (halalas: number) => (halalas / 100).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const day = snapshot.periodStart.toLocaleDateString("ar-SA-u-ca-islamic", { timeZone: "UTC" });
  const dayGreg = snapshot.periodStart.toLocaleDateString("ar", { timeZone: "UTC", dateStyle: "long" });

  return (
    <div dir="rtl" className="mx-auto max-w-3xl bg-white p-8 text-slate-900 print:p-4">
      <style>{`@media print { .no-print { display: none !important; } body { background: white; } }`}</style>

      <header className="mb-6 flex items-start justify-between border-b-2 border-teal-600 pb-4">
        <div>
          <h1 className="text-2xl font-extrabold">التقرير اليومي — ربي فارمسي</h1>
          <p className="mt-1 text-sm text-slate-600">
            {dayGreg} · {day} — لقطة آلية (v5.0)
          </p>
        </div>
        <PrintButton auto={auto === "1"} />
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="عدد الفواتير" value={String(d.salesCount ?? 0)} />
        <Stat label="صافي المبيعات (ر.س)" value={sar(d.netRevenueHalalas ?? 0)} />
        <Stat label="الخصومات (ر.س)" value={sar(d.discountHalalas ?? 0)} />
        <Stat label="فواتير ملغاة" value={String(d.voidedCount ?? 0)} />
      </section>

      <section className="mb-6">
        <h2 className="mb-2 border-b pb-1 text-lg font-bold">أعلى 5 أصناف مباعة</h2>
        {(d.topItems?.length ?? 0) === 0 ? (
          <p className="text-sm text-slate-500">لا مبيعات في هذا اليوم.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-start text-slate-600">
                <th className="py-1.5 text-start">الصنف</th>
                <th className="py-1.5 text-start">الكمية</th>
                <th className="py-1.5 text-start">القيمة (ر.س)</th>
              </tr>
            </thead>
            <tbody>
              {(d.topItems ?? []).map((t, i) => (
                <tr key={i} className="border-b">
                  <td className="py-1.5">{t.name}</td>
                  <td className="py-1.5">{t.qty}</td>
                  <td className="py-1.5">{sar(t.subtotalHalalas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="أصناف تحت الحد الأدنى" value={String(d.lowStockCount ?? 0)} />
        <Stat label="دفعات تنتهي خلال 30 يوماً" value={String(d.expiringBatches30 ?? 0)} />
        <Stat label="وصفات اليوم" value={String(d.prescriptionsCount ?? 0)} />
      </section>

      <footer className="border-t pt-3 text-[11px] text-slate-500">
        وُلّدت اللقطة آلياً بتاريخ {d.generatedAt ? new Date(d.generatedAt).toLocaleString("ar") : "—"} ·
        المستند تثقيفي إداري ولا يغني عن سجلات النظام · ربي فارمسي v5.0
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-extrabold text-teal-700">{value}</p>
    </div>
  );
}
