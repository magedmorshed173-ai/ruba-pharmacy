"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PackageOpen } from "lucide-react";
import { fmtMoney, fmtNum } from "@/lib/api-client";
import type { ReactNode } from "react";

// ───── بطاقة إحصائية ─────
export function StatCard({
  title,
  value,
  isMoney = false,
  suffix,
  icon,
  tone = "teal",
  sub,
  loading,
}: {
  title: string;
  value: number;
  isMoney?: boolean;
  suffix?: string; // v5.5 — لاحقة عرض مثل «%» للنِسَب
  icon: ReactNode;
  tone?: "teal" | "amber" | "rose" | "sky" | "violet" | "emerald";
  sub?: string;
  loading?: boolean;
}) {
  const tones: Record<string, string> = {
    teal: "bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400",
    amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
    rose: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400",
    sky: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400",
    violet: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400",
    emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  };
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-24" />
          ) : (
            <p className="num mt-1 truncate text-2xl font-bold tracking-tight text-foreground">
              {isMoney ? fmtMoney(value) : fmtNum(value)}
              {isMoney && (
                <span className="ms-1 text-xs font-medium text-muted-foreground">ر.س</span>
              )}
              {suffix && (
                <span className="ms-1 text-xs font-medium text-muted-foreground">{suffix}</span>
              )}
            </p>
          )}
          {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", tones[tone])}>
          {icon}
        </div>
      </div>
    </div>
  );
}

// ───── شارات الحالة ─────
export function StockBadge({ quantity, minQuantity }: { quantity: number; minQuantity: number }) {
  if (quantity <= 0)
    return <Badge variant="destructive" className="font-medium">نافد</Badge>;
  if (quantity <= minQuantity)
    return (
      <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-400">
        منخفض
      </Badge>
    );
  return (
    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-400">
      متوفر
    </Badge>
  );
}

export function ExpiryBadge({ daysUntilExpiry }: { daysUntilExpiry: number }) {
  if (daysUntilExpiry < 0)
    return <Badge variant="destructive" className="font-medium">منتهي</Badge>;
  if (daysUntilExpiry <= 30)
    return (
      <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-400">
        {daysUntilExpiry} يوم
      </Badge>
    );
  if (daysUntilExpiry <= 90)
    return (
      <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-400">
        {daysUntilExpiry} يوم
      </Badge>
    );
  return (
    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-400">
      ساري
    </Badge>
  );
}

// ───── حالة فراغ ─────
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
        <PackageOpen className="size-7 text-muted-foreground" />
      </div>
      <div>
        <p className="font-semibold">{title}</p>
        {hint && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

// ───── مؤشر تحميل ─────
export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}
