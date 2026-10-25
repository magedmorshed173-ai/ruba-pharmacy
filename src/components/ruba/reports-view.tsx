"use client";

import { useEffect, useState } from "react";
import { api, fmtMoney, fmtNum, fmtDate } from "@/lib/api-client";
import { StatCard, LoadingRows } from "./shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { toast } from "sonner";
import {
  Banknote,
  CalendarDays,
  CalendarRange,
  TrendingUp,
  PackagePlus,
  Download,
  Loader2,
  Trophy,
} from "lucide-react";

interface SalesReport {
  today: { count: number; revenue: number; discount: number };
  week: { count: number; revenue: number; discount: number };
  month: { count: number; revenue: number; discount: number };
  topItems: { name: string; quantity: number; revenue: number }[];
  series: { date: string; revenue: number }[];
  paymentDist: { method: string; count: number; revenue: number }[];
}

interface RestockRow {
  medicineId: string;
  name: string;
  barcode: string;
  quantity: number;
  minQuantity: number;
  soldLast30: number;
  dailyVelocity: number;
  daysOfCover: number | null;
  suggestedOrder: number;
}

export function ReportsView() {
  const [report, setReport] = useState<SalesReport | null>(null);
  const [restock, setRestock] = useState<RestockRow[] | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api<SalesReport>("/api/reports/sales?days=14")
      .then(setReport)
      .catch((e) => toast.error(e.message));
    api<{ rows: RestockRow[] }>("/api/reports/restock")
      .then((r) => setRestock(r.rows))
      .catch(() => setRestock([]));
  }, []);

  async function exportCsv() {
    setExporting(true);
    try {
      const r = await api<{ rows: RestockRow[] }>("/api/reports/restock");
      const header = "الدواء,الباركود,المخزون,مبيعات 30 يوم,سرعة يومية,أيام التغطية,كمية مقترحة\n";
      const rows = r.rows
        .map(
          (x) =>
            `"${x.name}",${x.barcode},${x.quantity},${x.soldLast30},${x.dailyVelocity},${
              x.daysOfCover ?? "∞"
            },${x.suggestedOrder}`
        )
        .join("\n");
      const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ruba-restock-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("تم تصدير الملف");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التصدير");
    } finally {
      setExporting(false);
    }
  }

  if (!report)
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
        <LoadingRows rows={8} />
      </div>
    );

  return (
    <div className="space-y-6">
      <Tabs defaultValue="sales" dir="rtl">
        <TabsList className="h-10">
          <TabsTrigger value="sales" className="px-4">
            <TrendingUp className="size-4" /> المبيعات
          </TabsTrigger>
          <TabsTrigger value="restock" className="px-4">
            <PackagePlus className="size-4" /> إعادة الطلب الذكية
          </TabsTrigger>
        </TabsList>

        {/* تبويب المبيعات */}
        <TabsContent value="sales" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
            <StatCard
              title="إيراد اليوم"
              value={report.today.revenue}
              isMoney
              icon={<Banknote className="size-5" />}
              tone="teal"
              sub={`${fmtNum(report.today.count)} فاتورة`}
            />
            <StatCard
              title="إيراد الأسبوع"
              value={report.week.revenue}
              isMoney
              icon={<CalendarDays className="size-5" />}
              tone="sky"
              sub={`${fmtNum(report.week.count)} فاتورة`}
            />
            <StatCard
              title="إيراد الشهر"
              value={report.month.revenue}
              isMoney
              icon={<CalendarRange className="size-5" />}
              tone="violet"
              sub={`${fmtNum(report.month.count)} فاتورة`}
            />
            <StatCard
              title="خصومات الشهر"
              value={report.month.discount}
              isMoney
              icon={<TrendingUp className="size-5" />}
              tone="amber"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* أعلى الأدوية مبيعاً */}
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Trophy className="size-4 text-amber-500" />
                <h3 className="font-bold">الأكثر مبيعاً (14 يوماً)</h3>
              </div>
              {report.topItems.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">لا مبيعات بعد</p>
              ) : (
                <div className="h-72" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[...report.topItems].reverse()}
                      layout="vertical"
                      margin={{ left: 8, right: 16 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5ebeb" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "#6b7a7a" }} axisLine={false} tickLine={false} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={110}
                        tick={{ fontSize: 11, fill: "#374151", fontFamily: "inherit" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        formatter={(v: number | string, n) => [
                          n === "quantity" ? `${fmtNum(Number(v))} وحدة` : `${fmtMoney(Number(v))} ر.س`,
                          n === "quantity" ? "الكمية" : "الإيراد",
                        ]}
                        contentStyle={{ borderRadius: 12, fontFamily: "inherit", direction: "rtl" }}
                      />
                      <Bar dataKey="quantity" fill="#0D9488" radius={[0, 6, 6, 0]} barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* طرق الدفع */}
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <h3 className="mb-4 font-bold">توزيع طرق الدفع (14 يوماً)</h3>
              {report.paymentDist.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">لا بيانات</p>
              ) : (
                <div className="space-y-3">
                  {report.paymentDist.map((p) => {
                    const maxRevenue = Math.max(...report.paymentDist.map((x) => x.revenue), 1);
                    return (
                      <div key={p.method}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span className="font-medium">
                            {p.method === "cash" ? "نقدي" : p.method === "card" ? "بطاقة" : "تأمين"}
                          </span>
                          <span className="num text-muted-foreground">
                            {fmtMoney(p.revenue)} ر.س · {fmtNum(p.count)} فاتورة
                          </span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-teal-500 transition-all"
                            style={{ width: `${(p.revenue / maxRevenue) * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* تبويب إعادة الطلب */}
        <TabsContent value="restock" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold">التنبؤ الذكي بإعادة الطلب</h3>
              <p className="text-sm text-muted-foreground">
                مبني على سرعة بيع آخر 30 يوماً — الأقل تغطية أولاً
              </p>
            </div>
            <Button variant="outline" onClick={exportCsv} disabled={exporting}>
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              تصدير CSV
            </Button>
          </div>

          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            {restock === null ? (
              <LoadingRows rows={8} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الدواء</TableHead>
                    <TableHead className="text-center">المخزون</TableHead>
                    <TableHead className="hidden text-center sm:table-cell">مبيعات 30ي</TableHead>
                    <TableHead className="hidden text-center md:table-cell">سرعة/يوم</TableHead>
                    <TableHead className="text-center">التغطية</TableHead>
                    <TableHead className="text-center">مقترح الطلب</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {restock.slice(0, 25).map((r) => (
                    <TableRow key={r.medicineId}>
                      <TableCell>
                        <p className="text-sm font-bold">{r.name}</p>
                        <p className="num text-xs text-muted-foreground" dir="ltr">{r.barcode}</p>
                      </TableCell>
                      <TableCell className="num text-center font-bold">{r.quantity}</TableCell>
                      <TableCell className="num hidden text-center sm:table-cell">
                        {fmtNum(r.soldLast30)}
                      </TableCell>
                      <TableCell className="num hidden text-center text-muted-foreground md:table-cell">
                        {r.dailyVelocity.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-center">
                        {r.daysOfCover === null ? (
                          <Badge variant="secondary" className="text-xs">بلا مبيعات</Badge>
                        ) : r.daysOfCover < 7 ? (
                          <Badge variant="destructive" className="num text-xs">
                            {r.daysOfCover} يوم
                          </Badge>
                        ) : r.daysOfCover < 15 ? (
                          <Badge className="num bg-amber-100 text-xs text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                            {r.daysOfCover} يوم
                          </Badge>
                        ) : (
                          <Badge className="num bg-emerald-100 text-xs text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                            {r.daysOfCover} يوم
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {r.suggestedOrder > 0 ? (
                          <span className="num inline-flex items-center rounded-full bg-teal-50 px-3 py-1 text-sm font-extrabold text-teal-700 dark:bg-teal-500/15 dark:text-teal-400">
                            +{fmtNum(r.suggestedOrder)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">كافٍ ✓</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
