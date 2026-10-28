"use client";

import { useEffect, useState } from "react";
import { api, fmtDate, fmtMoney, fmtNum } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { AuthUser } from "@/lib/types";
import { StatCard, EmptyState, LoadingRows } from "./shared";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar,
} from "recharts";
import {
  Banknote,
  CalendarDays,
  Pill,
  TriangleAlert,
  Timer,
  ShoppingCart,
  ArrowLeft,
  PackageMinus,
  Clock3,
  View,
  TrendingUp,
  Percent,
  Receipt,
  Hourglass,
} from "lucide-react";

interface DashData {
  stats: {
    revenueToday: number;
    revenueMonth: number;
    salesCountToday: number;
    totalMedicines: number;
    lowStockCount: number;
    expiredCount: number;
    expiring30Count: number;
    inventoryCostValue: number;
    unreadNotifications: number;
  };
  analytics: {
    trend: { date: string; label: string; revenue: number; profit: number; count: number }[];
    topMedicines: { name: string; quantity: number; revenue: number; profit: number; marginPct: number }[];
    paymentMix: { method: string; label: string; count: number; revenue: number; pct: number }[];
    expiry: {
      key: "expired" | "d30" | "d60" | "d90" | "d180" | "later";
      label: string;
      count: number;
      quantity: number;
      costValue: number;
    }[];
    summary: { revenue: number; profit: number; marginPct: number; avgBasket: number; count: number };
  };
  categorySeries: { name: string; value: number }[];
  recentSales: {
    id: string;
    reference: string;
    customerName: string;
    netAmount: number;
    saleDate: string;
    user?: { fullName: string };
    items: { medicineName: string; quantity: number }[];
  }[];
  lowStockList: { id: string; name: string; barcode: string; quantity: number; minQuantity: number }[];
  expiringList: { id: string; name: string; expiryDate: string; quantity: number }[];
}

const PIE_COLORS = ["#0D9488", "#14B8A6", "#F59E0B", "#0EA5E9", "#8B5CF6", "#F43F5E", "#22C55E"];

/** v5.5 — تدرّج ألوان دلاء انتهاء الصلاحية (أحمر ← عنبري ← سماوي ← بنفسجي ← teal) */
const EXPIRY_TONES: Record<string, string> = {
  expired:
    "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200",
  d30: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
  d60: "border-yellow-100 bg-yellow-50 text-yellow-900 dark:border-yellow-500/25 dark:bg-yellow-500/10 dark:text-yellow-200",
  d90: "border-sky-100 bg-sky-50 text-sky-900 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-200",
  d180: "border-violet-100 bg-violet-50 text-violet-900 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-200",
  later: "border-teal-100 bg-teal-50 text-teal-900 dark:border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-200",
};

export function DashboardView({
  user,
  onNavigate,
}: {
  user: AuthUser;
  onNavigate: (v: "pos" | "inventory" | "reports" | "notifications") => void;
}) {
  const [data, setData] = useState<DashData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<DashData>("/api/dashboard")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "صباح الخير" : hour < 17 ? "طاب يومك" : "مساء الخير";

  if (error)
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="font-bold text-destructive">{error}</p>
        <Button variant="outline" className="mt-3" onClick={() => location.reload()}>
          إعادة المحاولة
        </Button>
      </div>
    );

  if (!data)
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 rounded-xl lg:col-span-2" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );

  const s = data.stats;
  const a = data.analytics;
  // القيمة المهددة بالتكلفة: دفعات تنتهي خلال 90 يوماً (بدون المنتهية المحجوبة)
  const risk90 = a.expiry
    .filter((b) => b.key === "d30" || b.key === "d60" || b.key === "d90")
    .reduce((acc, b) => acc + b.costValue, 0);

  return (
    <div className="space-y-6">
      {/* الترحيب */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold lg:text-2xl">
            {greeting}، {user.fullName.split(" ")[0]} 👋
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            إليك نظرة عامة على صيدليتك اليوم — {fmtDate(new Date())}
          </p>
        </div>
        <Button
          onClick={() => onNavigate("pos")}
          className="bg-teal-600 font-bold hover:bg-teal-700"
        >
          <ShoppingCart className="size-4" />
          فتح نقطة البيع
        </Button>
      </div>

      {/* البطاقات */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <StatCard
          title="إيراد اليوم"
          value={s.revenueToday}
          isMoney
          icon={<Banknote className="size-5" />}
          tone="teal"
          sub={`${fmtNum(s.salesCountToday)} فاتورة اليوم`}
          loading={false}
        />
        <StatCard
          title="إيراد الشهر"
          value={s.revenueMonth}
          isMoney
          icon={<CalendarDays className="size-5" />}
          tone="sky"
          loading={false}
        />
        <StatCard
          title="قيمة المخزون (تكلفة)"
          value={s.inventoryCostValue}
          isMoney
          icon={<Pill className="size-5" />}
          tone="violet"
          sub={`${fmtNum(s.totalMedicines)} صنف دوائي`}
          loading={false}
        />
        <StatCard
          title="تنبيهات تحتاج إجراء"
          value={s.lowStockCount + s.expiredCount + s.expiring30Count}
          icon={<TriangleAlert className="size-5" />}
          tone="amber"
          sub={`${fmtNum(s.lowStockCount)} نقص · ${fmtNum(s.expiring30Count)} صلاحية`}
          loading={false}
        />
      </div>

      {/* v5.5 — شريط البصيرة التنفيذية (آخر 30 يوماً) */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <StatCard
          title="ربح 30 يوماً"
          value={a.summary.profit}
          isMoney
          icon={<TrendingUp className="size-5" />}
          tone="emerald"
          sub="الإيراد ناقص تكلفة البنود (FEFO)"
          loading={false}
        />
        <StatCard
          title="هامش الربح"
          value={a.summary.marginPct}
          suffix="%"
          icon={<Percent className="size-5" />}
          tone="violet"
          sub="من إيراد آخر 30 يوماً"
          loading={false}
        />
        <StatCard
          title="متوسط الفاتورة"
          value={a.summary.avgBasket}
          isMoney
          icon={<Receipt className="size-5" />}
          tone="sky"
          sub={`${fmtNum(a.summary.count)} فاتورة في النافذة`}
          loading={false}
        />
        <StatCard
          title="قيمة مهددة بالانتهاء"
          value={risk90}
          isMoney
          icon={<Hourglass className="size-5" />}
          tone="rose"
          sub="دفعات تنتهي خلال 90 يوماً (تكلفة)"
          loading={false}
        />
      </div>

      {/* الرسوم — v5.5 الاتجاه المزدوج (إيراد + ربح) + مزيج الدفع */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border bg-card p-4 shadow-sm lg:col-span-2">
          <div className="mb-4">
            <h3 className="font-bold">حركة الإيرادات والأرباح</h3>
            <p className="text-xs text-muted-foreground">آخر 30 يوماً (بالريال) — بأيام توقيت الرياض</p>
          </div>
          <div className="h-64" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={a.trend} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0D9488" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0D9488" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="profGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5ebeb" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#6b7a7a" }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={22}
                />
                <YAxis
                  tickFormatter={(v: number) => {
                    const sar = Math.round(v / 100);
                    return sar >= 1000
                      ? `${(sar / 1000).toFixed(sar >= 100000 ? 0 : 1)}k`
                      : String(sar);
                  }}
                  tick={{ fontSize: 11, fill: "#6b7a7a" }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <Tooltip
                  formatter={(v, name) => [`${fmtMoney(Number(v))} ر.س`, String(name)] as [string, string]}
                  labelFormatter={(l) => `اليوم ${l}`}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e2e8e8",
                    fontFamily: "inherit",
                    direction: "rtl",
                  }}
                />
                <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} height={24} />
                <Area
                  name="الإيراد"
                  type="monotone"
                  dataKey="revenue"
                  stroke="#0D9488"
                  strokeWidth={2.5}
                  fill="url(#revGrad)"
                />
                <Area
                  name="الربح"
                  type="monotone"
                  dataKey="profit"
                  stroke="#8B5CF6"
                  strokeWidth={2}
                  fill="url(#profGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <h3 className="font-bold">مزيج طرق الدفع</h3>
          <p className="text-xs text-muted-foreground">حصة كل وسيلة من إيراد 30 يوماً</p>
          {a.paymentMix.length === 0 ? (
            <p className="mt-16 text-center text-sm text-muted-foreground">لا مبيعات في النافذة بعد</p>
          ) : (
            <>
              <div className="h-48" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={a.paymentMix}
                      dataKey="revenue"
                      nameKey="label"
                      innerRadius="55%"
                      outerRadius="85%"
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {a.paymentMix.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v, n) => [`${fmtMoney(Number(v))} ر.س`, String(n)] as [string, string]}
                      contentStyle={{ borderRadius: 12, fontFamily: "inherit", direction: "rtl" }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      iconType="circle"
                      iconSize={8}
                      formatter={(v) => (
                        <span style={{ fontSize: 11, fontFamily: "inherit" }}>{v}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {a.paymentMix.map((m) => (
                  <Badge key={m.method} variant="outline" className="num text-[11px]">
                    {m.label} {m.pct}%
                  </Badge>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* أعلى الأصناف إيراداً + توزيع التصنيفات */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border bg-card p-4 shadow-sm lg:col-span-2">
          <h3 className="font-bold">أعلى الأصناف إيراداً</h3>
          <p className="text-xs text-muted-foreground">آخر 30 يوماً — بالريال مع الهامش لكل صنف</p>
          {a.topMedicines.length === 0 ? (
            <p className="mt-16 text-center text-sm text-muted-foreground">
              لا مبيعات بعد — أول فاتورة ستظهر هنا
            </p>
          ) : (
            <div className="h-64" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={a.topMedicines}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5ebeb" horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={130}
                    tick={{ fontSize: 11, fill: "#374151" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(v) => [`${fmtMoney(Number(v))} ر.س`, "الإيراد"] as [string, string]}
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid #e2e8e8",
                      fontFamily: "inherit",
                      direction: "rtl",
                    }}
                    cursor={{ fill: "rgba(13,148,136,0.06)" }}
                  />
                  <Bar dataKey="revenue" fill="#0D9488" radius={[0, 6, 6, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <h3 className="font-bold">توزيع التصنيفات</h3>
          <p className="text-xs text-muted-foreground">عدد الأدوية حسب التصنيف</p>
          <div className="h-56" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.categorySeries}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="85%"
                  paddingAngle={3}
                  strokeWidth={0}
                >
                  {data.categorySeries.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v, n) => [`${fmtNum(Number(v))} دواء`, String(n)] as [string, string]}
                  contentStyle={{ borderRadius: 12, fontFamily: "inherit", direction: "rtl" }}
                />
                <Legend
                  verticalAlign="bottom"
                  iconType="circle"
                  iconSize={8}
                  formatter={(v) => (
                    <span style={{ fontSize: 11, fontFamily: "inherit" }}>{v}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* v5.5 — خط زمن الصلاحية */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Hourglass className="size-4 text-rose-600" />
            <h3 className="font-bold">خط زمن الصلاحية</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            قيمة الدفعات الحية بالتكلفة — المنتهية محجوبة عن الصرف آلياً
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {a.expiry.map((b) => (
            <div key={b.key} className={cn("rounded-lg border p-3", EXPIRY_TONES[b.key])}>
              <p className="text-[11px] font-bold">{b.label}</p>
              <p className="num mt-1 text-base font-extrabold">{fmtMoney(b.costValue)}</p>
              <p className="num text-[11px] opacity-80">
                {fmtNum(b.count)} دفعة · {fmtNum(b.quantity)} وحدة
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* القوائم */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* أحدث المبيعات */}
        <div className="rounded-xl border bg-card shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="font-bold">أحدث المبيعات</h3>
            <Button variant="ghost" size="sm" className="text-teal-700" onClick={() => onNavigate("reports")}>
              عرض الكل
              <ArrowLeft className="size-4" />
            </Button>
          </div>
          {data.recentSales.length === 0 ? (
            <EmptyState title="لا توجد مبيعات بعد" hint="ابدأ أول عملية بيع من نقطة البيع" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المرجع</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead className="hidden md:table-cell">البنود</TableHead>
                  <TableHead className="text-end">المبلغ</TableHead>
                  <TableHead className="hidden text-end sm:table-cell">الوقت</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentSales.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell className="num text-xs" dir="ltr">{sale.reference.slice(0, 14)}</TableCell>
                    <TableCell className="font-medium">{sale.customerName}</TableCell>
                    <TableCell className="hidden max-w-48 truncate text-muted-foreground md:table-cell">
                      {sale.items.map((i) => `${i.medicineName} ×${i.quantity}`).join("، ")}
                    </TableCell>
                    <TableCell className="num text-end font-bold text-teal-700 dark:text-teal-400">
                      {fmtMoney(sale.netAmount)}
                    </TableCell>
                    <TableCell className="hidden text-end text-xs text-muted-foreground sm:table-cell">
                      {fmtDate(sale.saleDate, true)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* تنبيهات المخزون */}
        <div className="space-y-4">
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <PackageMinus className="size-4 text-amber-600" />
                <h3 className="font-bold">قرب النفاد</h3>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-teal-700" onClick={() => onNavigate("inventory")}>
                <View className="size-4" />
              </Button>
            </div>
            {data.lowStockList.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">كل المخزون بحالة جيدة ✓</p>
            ) : (
              <div className="divide-y">
                {data.lowStockList.slice(0, 5).map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{m.name}</p>
                      <p className="num text-xs text-muted-foreground" dir="ltr">{m.barcode}</p>
                    </div>
                    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                      {m.quantity} / {m.minQuantity}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <Clock3 className="size-4 text-rose-600" />
                <h3 className="font-bold">قرب انتهاء الصلاحية</h3>
              </div>
            </div>
            {data.expiringList.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">لا أصناف قاربت خلال 30 يوماً ✓</p>
            ) : (
              <div className="divide-y">
                {data.expiringList.slice(0, 5).map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-4 py-2.5">
                    <p className="truncate text-sm font-medium">{m.name}</p>
                    <span className="num text-xs font-bold text-rose-600">
                      {m.expiryDate.slice(0, 10)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
