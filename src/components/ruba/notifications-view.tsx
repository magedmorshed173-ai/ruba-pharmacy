"use client";

import { useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/api-client";
import type { AppNotification } from "@/lib/types";
import { EmptyState, LoadingRows } from "./shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Bell,
  Clock3,
  PackageMinus,
  Info,
  CheckCheck,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function NotificationsView({ onRead }: { onRead?: () => void }) {
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [generating, setGenerating] = useState(false);

  async function load() {
    try {
      const r = await api<{ notifications: AppNotification[] }>("/api/notifications");
      setItems(r.notifications);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطأ في جلب الإشعارات");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function markRead(n: AppNotification) {
    if (n.isRead) return;
    try {
      await api("/api/notifications", { method: "POST", json: { id: n.id } });
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)) ?? null);
      onRead?.();
    } catch {
      /* ignore */
    }
  }

  async function markAll() {
    try {
      await api("/api/notifications", { method: "POST", json: { all: true } });
      setItems((prev) => prev?.map((x) => ({ ...x, isRead: true })) ?? null);
      onRead?.();
      toast.success("تم تعليم الكل كمقروء");
    } catch {
      /* ignore */
    }
  }

  async function generate() {
    setGenerating(true);
    try {
      const r = await api<{ created: number; message: string }>("/api/notifications", {
        method: "PUT",
      });
      toast.success(r.message);
      load();
      onRead?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر توليد الإشعارات");
    } finally {
      setGenerating(false);
    }
  }

  const unread = items?.filter((x) => !x.isRead).length ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-bold">الإشعارات</h3>
          {unread > 0 && (
            <Badge className="num bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400">
              {unread} غير مقروء
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="size-4" /> تحديث
          </Button>
          <Button variant="outline" size="sm" onClick={generate} disabled={generating}>
            {generating ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}
            فحص المخزون الآن
          </Button>
          {unread > 0 && (
            <Button variant="outline" size="sm" onClick={markAll}>
              <CheckCheck className="size-4" /> تعليم الكل
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {items === null ? (
          <LoadingRows rows={5} />
        ) : items.length === 0 ? (
          <EmptyState
            title="لا إشعارات حالياً"
            hint="اضغط «فحص المخزون الآن» لمسح الأصناف قاربت الانتهاء أو النفاد"
          />
        ) : (
          <div className="divide-y">
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => markRead(n)}
                className={cn(
                  "flex w-full items-start gap-3 px-4 py-3 text-start transition hover:bg-muted/50",
                  !n.isRead && "bg-teal-50/60 dark:bg-teal-500/5"
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
                    n.kind === "expiry" && "bg-rose-100 text-rose-600 dark:bg-rose-500/15",
                    n.kind === "low_stock" && "bg-amber-100 text-amber-600 dark:bg-amber-500/15",
                    n.kind === "info" && "bg-sky-100 text-sky-600 dark:bg-sky-500/15"
                  )}
                >
                  {n.kind === "expiry" ? (
                    <Clock3 className="size-4" />
                  ) : n.kind === "low_stock" ? (
                    <PackageMinus className="size-4" />
                  ) : (
                    <Info className="size-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn("text-sm", n.isRead ? "font-medium" : "font-bold")}>
                      {n.title}
                      {!n.isRead && (
                        <span className="ms-2 inline-block size-2 rounded-full bg-teal-500 align-middle" />
                      )}
                    </p>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {fmtDate(n.createdAt, true)}
                    </span>
                  </div>
                  {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
