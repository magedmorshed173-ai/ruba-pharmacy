"use client";

/**
 * v5.4 — سجل التدقيق الشامل (مدير حصراً)
 * جدول مساءلة كامل: الإجراء بتسميته العربية، الفاعل باسمه الجامد، الوصف،
 * IP والوقت. فلاتر: مجموعة الإجراء (شرائح) + نافذة الأيام + ترقيم صفحات.
 * تصدير Excel بنفس كاتب v5.1 الصفري الاعتماديات.
 */

import { useCallback, useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/api-client";
import { auditLabel, auditGroup, AUDIT_GROUPS } from "@/lib/audit";
import { ROLE_LABEL } from "@/lib/role-label";
import { LoadingRows, EmptyState } from "./shared";
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
import { toast } from "sonner";
import {
  ChevronRight,
  ChevronLeft,
  FileSpreadsheet,
  History,
  Loader2,
} from "lucide-react";

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  meta: unknown;
  userName: string | null;
  userRole: string | null;
  ip: string | null;
  createdAt: string;
}

interface AuditResponse {
  logs: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  days: number;
}

const PAGE_SIZE = 50;
const DAY_WINDOWS = [7, 30, 90, 365] as const;

/** لون شارة الإجراء حسب مجموعته — ثابت بصرياً عبر الواجهة */
const GROUP_STYLE: Record<string, string> = {
  sale: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  user: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  batch: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  transfer: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300",
};

export function AuditView() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [days, setDays] = useState<number>(30);
  const [group, setGroup] = useState<string>("");
  const [page, setPage] = useState<number>(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days), page: String(page) });
      if (group) params.set("action", group);
      const r = await api<AuditResponse>(`/api/audit?${params}`);
      setData(r);
    } catch {
      toast.error("تعذر جلب سجل التدقيق");
    } finally {
      setLoading(false);
    }
  }, [days, group, page]);

  // أعِد الجلب عند تغيّر أي فلتر (هوية load تتغير مع الفلاتر — نفس نمط التقارير)
  useEffect(() => {
    load();
  }, [load]);

  async function exportExcel() {
    setExporting(true);
    try {
      const res = await fetch(`/api/audit/export?days=${days}`, { credentials: "include" });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ruba-audit-${days}d-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("تم تنزيل ملف Excel");
    } catch {
      toast.error("تعذر تصدير السجل");
    } finally {
      setExporting(false);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      {/* الرأس: العنوان + نافذة الأيام + التصدير */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <History className="size-5 text-primary" />
            سجل التدقيق
          </h2>
          <p className="text-sm text-muted-foreground">
            كل عملية حساسة موثقة بفاعلها وسياقها — لا تعديل ولا حذف يدوي
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-1">
            {DAY_WINDOWS.map((d) => (
              <button
                key={d}
                onClick={() => {
                  setDays(d);
                  setPage(1);
                }}
                className={`rounded px-2.5 py-1 text-xs transition-colors ${
                  days === d ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                }`}
              >
                {d === 365 ? "سنة" : `${d} يوم`}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting}>
            {exporting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="size-4" />
            )}
            تصدير Excel
          </Button>
        </div>
      </div>

      {/* شرائح مجموعات الإجراءات */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            setGroup("");
            setPage(1);
          }}
          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
            group === "" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
          }`}
        >
          الكل
        </button>
        {Object.entries(AUDIT_GROUPS).map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              setGroup(group === key ? "" : key);
              setPage(1);
            }}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              group === key ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* الجدول */}
      {loading ? (
        <LoadingRows rows={8} />
      ) : !data || data.logs.length === 0 ? (
        <EmptyState
          title="لا سجلات تدقيق"
          hint="لا عمليات حساسة ضمن النافذة المحددة — السجل يتولد تلقائياً مع العمليات"
        />
      ) : (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">الوقت</TableHead>
                  <TableHead className="w-36">الإجراء</TableHead>
                  <TableHead>الوصف</TableHead>
                  <TableHead className="w-36">الفاعل</TableHead>
                  <TableHead className="w-24 hidden md:table-cell">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.logs.map((l) => {
                  const g = auditGroup(l.action);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(l.createdAt, true)}
                      </TableCell>
                      <TableCell>
                        <Badge className={GROUP_STYLE[g] ?? ""} variant="outline">
                          {auditLabel(l.action)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{l.summary}</TableCell>
                      <TableCell className="text-sm">
                        <div>{l.userName ?? "—"}</div>
                        {l.userRole && (
                          <div className="text-xs text-muted-foreground">
                            {ROLE_LABEL[l.userRole] ?? l.userRole}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                        {l.ip ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* الترقيم */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {data.total.toLocaleString("ar-SA")} سجل — صفحة {page} من {totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronRight className="size-4" />
                السابق
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                التالي
                <ChevronLeft className="size-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
