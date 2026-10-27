"use client";

import { useEffect, useState, useCallback } from "react";
import { api, fmtMoney, fmtNum, fmtDate } from "@/lib/api-client";
import type { AuthUser } from "@/lib/types";
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
  AreaChart,
  Area,
  Legend,
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
  PiggyBank,
  Percent,
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

interface ProfitReport {
  days: number;
  summary: {
    revenue: number;
    cogs: number;
    profit: number;
    marginPct: number;
    knownCostItems: number;
    unknownCostItems: number;
  };
  byMedicine: {
    name: string;
    quantity: number;
    revenue: number;
    cost: number;
    profit: number;
    marginPct: number;
  }[];
  series: { date: string; revenue: number; profit: number }[];
  note?: string | null;
}

export function ReportsView({ user }: { user: AuthUser }) {
  const [report, setReport] = useState<SalesReport | null>(null);
  const [restock, setRestock] = useState<RestockRow[] | null>(null);
  const [exporting, setExporting] = useState(false);
  const canSeeProfit = user.role === "admin" || user.role === "pharmacist";
  const [profit, setProfit] = useState<ProfitReport | null>(null);
  const [profitDays, setProfitDays] = useState(30);

  const loadProfit = useCallback(async (days: number) => {
    try {
      const r = await api<ProfitReport>(`/api/reports/profit?days=${days}`);
      setProfit(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر حساب الأرباح");
    }
  }, []);

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
      <Tabs defaultValue="sales" dir="rtl" onValueChange={(v) => {
        if (v === "profit" && profit === null) loadProfit(profitDays);
      }}>
        <TabsList className="h-10">
          <TabsTrigger value="sales" className="px-4">
            <TrendingUp className="size-4" /> المبيعات
          </TabsTrigger>
          {canSeeProfit && (
            <TabsTrigger value="profit" className="px-4">
              <PiggyBank className="size-4" /> الأرباح
            </TabsTrigger>
          )}
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
                        formatter={(v, n) =>
                          [
                            n === "quantity" ? `${fmtNum(Number(v))} وحدة` : `${fmtMoney(Number(v))} ر.س`,
                            n === "quantity" ? "الكمية" : "الإيراد",
                          ] as [string, string]
                        }
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

        {/* تبويب الأرباح (v3.3) — بالتكلفة الفعلية للدفعات */}
        <TabsContent value="profit" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">الفترة:</span>
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => {
                  setProfitDays(d);
                  loadProfit(d);
                }}
                className={`num rounded-lg px-3 py-1.5 text-sm font-bold transition ${
                  profitDays === d
                    ? "bg-teal-600 text-white"
                    : "border bg-card text-muted-foreground hover:bg-accent"
                }`}
              >
                {d} يوم
              </button>
            ))}
          </div>

          {profit === null ? (
            <div className="flex justify-center py-16">
              <Loader2 className="size-7 animate-spin text-teal-600" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
                <StatCard
                  title="صافي الإيراد"
                  value={profit.summary.revenue}
                  isMoney
                  icon={<Banknote className="size-5" />}
                  tone="teal"
                  sub={`${profit.days} يوماً`}
                />
                <StatCard
                  title="تكلفة المبيعات"
                  value={profit.summary.cogs}
                  isMoney
                  icon={<PackagePlus className="size-5" />}
                  tone="amber"
                  sub="تكلفة الدفعات الفعلية"
                />
                <StatCard
                  title="الربح الإجمالي"
                  value={profit.summary.profit}
                  isMoney
                  icon={<PiggyBank className="size-5" />}
                  tone={profit.summary.profit >= 0 ? "emerald" : "rose"}
                  sub="إيراد − تكلفة"
                />
                <StatCard
                  title="هامش الربح"
                  value={profit.summary.marginPct}
                  icon={<Percent className="size-5" />}
                  tone="violet"
                  sub="من كل 100 ر.س إيراد"
                />
              </div>

              {profit.note && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                  {profit.note}
                </p>
              )}

              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <h3 className="mb-4 font-bold">الإيراد والربح يومياً</h3>
                <div className="h-64" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={profit.series} margin={{ left: 8, right: 8 }}>
                      <defs>
                        <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0D9488" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#0D9488" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gPro" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5ebeb" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7a7a" }} tickFormatter={(v: string) => v.slice(5)} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "#6b7a7a" }} tickFormatter={(v: number) => `${Math.round(v / 100)}`} axisLine={false} tickLine={false} width={40} />
                      <Tooltip
                        formatter={(v, n) =>
                          [
                            `${fmtMoney(Number(v))} ر.س`,
                            n === "revenue" ? "الإيراد" : "الربح",
                          ] as [string, string]
                        }
                        contentStyle={{ borderRadius: 12, fontFamily: "inherit", direction: "rtl" }}
                      />
                      <Legend formatter={(v) => (v === "revenue" ? "الإيراد" : "الربح")} />
                      <Area type="monotone" dataKey="revenue" stroke="#0D9488" strokeWidth={2} fill="url(#gRev)" />
                      <Area type="monotone" dataKey="profit" stroke="#8b5cf6" strokeWidth={2} fill="url(#gPro)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
                <div className="border-b p-3">
                  <h3 className="font-bold">ربحية الأدوية — الأعلى ربحاً</h3>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الدواء</TableHead>
                      <TableHead className="text-center">الكمية</TableHead>
                      <TableHead>الإيراد</TableHead>
                      <TableHead>التكلفة</TableHead>
                      <TableHead>الربح</TableHead>
                      <TableHead className="text-center">الهامش</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {profit.byMedicine.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                          لا مبيعات في هذه الفترة
                        </TableCell>
                      </TableRow>
                    ) : (
                      profit.byMedicine.map((m) => (
                        <TableRow key={m.name}>
                          <TableCell className="text-sm font-medium">{m.name}</TableCell>
                          <TableCell className="num text-center">{fmtNum(m.quantity)}</TableCell>
                          <TableCell className="num text-sm">{fmtMoney(m.revenue)}</TableCell>
                          <TableCell className="num text-sm text-muted-foreground">{fmtMoney(m.cost)}</TableCell>
                          <TableCell className={`num text-sm font-bold ${m.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600"}`}>
                            {fmtMoney(m.profit)}
                          </TableCell>
                          <TableCell className="num text-center text-xs">{m.marginPct}%</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
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
