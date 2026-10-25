"use client";

import { useEffect, useState } from "react";
import { api, fmtDate, fmtMoney, fmtNum, PAYMENT_LABEL } from "@/lib/api-client";
import type { AuthUser } from "@/lib/api-client";
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
  dailySeries: { date: string; revenue: number; count: number }[];
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

      {/* الرسوم */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border bg-card p-4 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-bold">حركة الإيرادات</h3>
              <p className="text-xs text-muted-foreground">آخر 14 يوماً (بالريال)</p>
            </div>
          </div>
          <div className="h-64" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.dailySeries} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0D9488" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0D9488" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5ebeb" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d: string) => d.slice(5)}
                  tick={{ fontSize: 11, fill: "#6b7a7a" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}k` : String(v / 100))}
                  tick={{ fontSize: 11, fill: "#6b7a7a" }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <Tooltip
                  formatter={(v: number | string) => [`${fmtMoney(Number(v))} ر.س`, "الإيراد"]}
                  labelFormatter={(l) => `اليوم ${l}`}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e2e8e8",
                    fontFamily: "inherit",
                    direction: "rtl",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#0D9488"
                  strokeWidth={2.5}
                  fill="url(#revGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
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
                  formatter={(v: number | string, n) => [`${fmtNum(Number(v))} دواء`, String(n)]}
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
