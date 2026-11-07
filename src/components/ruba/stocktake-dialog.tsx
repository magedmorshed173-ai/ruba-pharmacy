"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, fmtDate, fmtMoney } from "@/lib/api-client";
import type { AuthUser } from "@/lib/types";
import {
  computeVariance,
  STOCK_COUNT_MAX_SUBMIT,
  STOCK_COUNT_STATUS_AR,
  STOCK_COUNT_STATUS_CLASS,
  type StockCountStatus,
} from "@/lib/stocktake";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  ArrowRight,
  Check,
  ClipboardList,
  Download,
  Loader2,
  Play,
  Save,
  X,
} from "lucide-react";

/**
 * v5.6 — حوار الجرد الفعلي
 *
 * مكون مستقل يفتح من رأس صفحة المخزون: قائمة آخر 50 جلسة بحالتها وملخصاتها،
 * بدء جلسة (صيدلي+) تُجمّد أرصدة الدفعات، إدخال المعدود على مهل، وتطبيق
 * الفروقات (مدير) أو إلغاؤها — مع تصدير تقرير الفروقات Excel.
 * الدلالة: العدّ هو الحقيقة — والفرق عند التطبيق يقيس مقابل الرصيد الحي.
 */

interface CountRow {
  id: string;
  number: string;
  status: string;
  batchesTotal: number;
  note: string | null;
  countedItems: number;
  matchedItems: number;
  increasedItems: number;
  decreasedItems: number;
  skippedItems: number;
  netQtyDelta: number;
  netCostDelta: number;
  openedAt: string;
  closedAt: string | null;
  openedBy?: { fullName: string } | null;
  closedBy?: { fullName: string } | null;
}

interface CountItemRow {
  id: string;
  batchId: string;
  medicineName: string;
  lotNumber: string;
  expiryDate: string;
  unitCost: number;
  systemQty: number;
  countedQty: number | null;
}

/** سقف عرض البنود في الحوار — الكامل في تقرير Excel */
const RENDER_CAP = 300;

export function StocktakeDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: AuthUser;
}) {
  const isAdmin = user.role === "admin";
  const [view, setView] = useState<"list" | "detail">("list");
  const [rows, setRows] = useState<CountRow[] | null>(null);
  const [detail, setDetail] = useState<{ count: CountRow; items: CountItemRow[] } | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<null | "start" | "save" | "apply" | "cancel" | "export">(null);
  const [startNote, setStartNote] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadList = useCallback(async () => {
    setRows(null);
    try {
      const r = await api<{ counts: CountRow[] }>("/api/stocktake");
      setRows(r.counts);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر جلب جلسات الجرد");
      setRows([]);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    try {
      const r = await api<{ count: CountRow & { items: CountItemRow[] } }>(
        `/api/stocktake/${id}`
      );
      const { items, ...count } = r.count;
      setDetail({ count, items });
      setDraft(
        Object.fromEntries(items.map((i) => [i.id, i.countedQty === null ? "" : String(i.countedQty)]))
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر جلب الجلسة");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setView("list");
    setDetail(null);
    loadList();
  }, [open, loadList]);

  const openSession = rows?.find((c) => c.status === "open") ?? null;

  async function startSession() {
    setBusy("start");
    try {
      const r = await api<{ id: string; number: string; batchesTotal: number }>(
        "/api/stocktake",
        { method: "POST", body: JSON.stringify({ note: startNote.trim() || null }) }
      );
      toast.success(`فُتحت جلسة ${r.number} — جُمّد ${r.batchesTotal} دفعة`);
      setStartNote("");
      await loadList();
      setView("detail");
      await loadDetail(r.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر فتح جلسة الجرد");
    } finally {
      setBusy(null);
    }
  }

  async function saveCounts() {
    if (!detail) return;
    // الفروق فقط عن المحفوظ — وسقف النداء حماية موثقة
    const changed = detail.items
      .filter((i) => {
        const v = draft[i.id] ?? "";
        return v !== (i.countedQty === null ? "" : String(i.countedQty));
      })
      .map((i) => {
        const v = draft[i.id] ?? "";
        return { itemId: i.id, countedQty: v === "" ? null : Number(v) };
      });
    if (changed.length === 0) {
      toast.info("لا تغييرات لحفظها");
      return;
    }
    if (changed.length > STOCK_COUNT_MAX_SUBMIT) {
      toast.error(`التغييرات ${changed.length} — الحد ${STOCK_COUNT_MAX_SUBMIT} بنداً في النداء الواحد`);
      return;
    }
    setBusy("save");
    try {
      const r = await api<{ updated: number }>(`/api/stocktake/${detail.count.id}`, {
        method: "PATCH",
        body: JSON.stringify({ counts: changed }),
      });
      toast.success(`حُفظ ${r.updated} بنداً`);
      await loadDetail(detail.count.id);
      loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر حفظ العدّ");
    } finally {
      setBusy(null);
    }
  }

  async function applySession() {
    if (!detail) return;
    setBusy("apply");
    try {
      const r = await api<{ ok: boolean; summary: { countedItems: number; increasedItems: number; decreasedItems: number; skippedItems: number; netQtyDelta: number } }>(
        `/api/stocktake/${detail.count.id}/apply`,
        { method: "POST" }
      );
      const s = r.summary;
      toast.success(
        `طُبِّقت الفروقات: ${s.countedItems} بنداً (زيادة ${s.increasedItems}، عجز ${s.decreasedItems}) — صافي ${s.netQtyDelta} وحدة`
      );
      setDetail(null);
      setView("list");
      await loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر تطبيق الفروقات", {
        duration: 8000,
      });
    } finally {
      setBusy(null);
    }
  }

  async function cancelSession() {
    if (!detail && !openSession) return;
    const id = detail?.count.id ?? openSession?.id;
    if (!id) return;
    setBusy("cancel");
    try {
      await api(`/api/stocktake/${id}/cancel`, { method: "POST" });
      toast.success("أُلغيت الجلسة — لا تغيير على المخزون");
      if (detail) {
        setDetail(null);
        setView("list");
      }
      await loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر إلغاء الجلسة");
    } finally {
      setBusy(null);
    }
  }

  async function exportExcel() {
    if (!detail) return;
    setBusy("export");
    try {
      const res = await fetch(`/api/stocktake/${detail.count.id}/export`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("فشل التصدير");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ruba-stocktake-${detail.count.number}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التصدير");
    } finally {
      setBusy(null);
    }
  }

  /** الملخص الحي من المسودة — مقابل الرصيد المجمّد (وثيقة العدّ) */
  const live = useMemo(() => {
    if (!detail) return null;
    return computeVariance(
      detail.items.map((i) => {
        const raw = draft[i.id];
        const parsed =
          raw === undefined
            ? i.countedQty
            : raw.trim() === ""
              ? null
              : Number.isInteger(Number(raw)) && Number(raw) >= 0
                ? Number(raw)
                : null;
        return { systemQty: i.systemQty, countedQty: parsed, unitCost: i.unitCost };
      })
    ).totals;
  }, [detail, draft]);

  function statusBadge(status: string) {
    const s = (STOCK_COUNT_STATUS_AR as Record<string, string>)[status] ?? status;
    const cls =
      (STOCK_COUNT_STATUS_CLASS as Record<string, string>)[status] ??
      "border-slate-300 bg-slate-100 text-slate-500";
    return <Badge variant="outline" className={cls}>{s}</Badge>;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-teal-600" />
            الجرد الفعلي
          </DialogTitle>
          <DialogDescription>
            {view === "list"
              ? "جلسة عدّ فيزيائي: تُجمَّد أرصدة النظام لحظة الفتح، ويُطبَّق الفرق بموافقة المدير — العدّ هو الحقيقة."
              : "أدخل الكميات المعدودة (اتركها فارغة لتخطي البند) — الفروق تُعرض مقابل رصيد لحظة الفتح، والتطبيق يقيس مقابل الرصيد الحي."}
          </DialogDescription>
        </DialogHeader>

        {view === "list" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-slate-50 p-3">
              <Input
                value={startNote}
                onChange={(e) => setStartNote(e.target.value)}
                placeholder="ملاحظة الجلسة (اختياري — مثل: جرد نهاية الربع)"
                className="h-9 max-w-xs"
                maxLength={300}
              />
              <Button
                size="sm"
                onClick={startSession}
                disabled={busy !== null || openSession !== null}
                className="gap-1.5"
              >
                {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                بدء جرد جديد
              </Button>
              {openSession && (
                <span className="text-xs text-amber-700">
                  توجد جلسة مفتوحة ({openSession.number}) — أكملها أو ألغِها أولاً
                </span>
              )}
            </div>

            {rows === null ? (
              <div className="py-10 text-center text-sm text-slate-400">جارٍ الجلب…</div>
            ) : rows.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-400">
                لا جلسات جرد بعد — ابدأ أول جلسة من الأعلى
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الجلسة</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>الدفعات</TableHead>
                    <TableHead>العدّ / الصافي</TableHead>
                    <TableHead>الفترة</TableHead>
                    <TableHead className="text-left">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-mono text-xs font-semibold">{c.number}</div>
                        {c.note && <div className="text-xs text-slate-400">{c.note}</div>}
                      </TableCell>
                      <TableCell>{statusBadge(c.status)}</TableCell>
                      <TableCell className="tabular-nums">{c.batchesTotal}</TableCell>
                      <TableCell className="text-xs">
                        {c.status === "closed" ? (
                          <span>
                            زيادة <b className="text-teal-700">{c.increasedItems}</b> · عجز{" "}
                            <b className="text-rose-700">{c.decreasedItems}</b> · متخطى{" "}
                            <b>{c.skippedItems}</b>
                            <br />
                            صافي: <b className={c.netQtyDelta < 0 ? "text-rose-700" : "text-teal-700"}>
                              {c.netQtyDelta > 0 ? "+" : ""}
                              {c.netQtyDelta}
                            </b>{" "}
                            وحدة ({fmtMoney(c.netCostDelta)})
                          </span>
                        ) : c.status === "open" ? (
                          "—"
                        ) : (
                          "أُلغيت"
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {fmtDate(c.openedAt, true)} · {c.openedBy?.fullName ?? "—"}
                        {c.closedAt && (
                          <>
                            <br />→ {fmtDate(c.closedAt, true)} · {c.closedBy?.fullName ?? "—"}
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-left">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant={c.status === "open" ? "default" : "outline"}
                            className="h-8 gap-1 px-2"
                            onClick={() => {
                              setView("detail");
                              loadDetail(c.id);
                            }}
                          >
                            {c.status === "open" ? <Play className="h-3.5 w-3.5" /> : null}
                            {c.status === "open" ? "متابعة" : "عرض"}
                          </Button>
                          {c.status === "open" && isAdmin && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1 px-2 text-rose-600 hover:text-rose-700"
                              disabled={busy !== null}
                              onClick={() => cancelSession()}
                            >
                              {busy === "cancel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                              إلغاء
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}

        {view === "detail" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1"
                onClick={() => {
                  setDetail(null);
                  setView("list");
                }}
              >
                <ArrowRight className="h-4 w-4" /> عودة للقائمة
              </Button>
              {detail && (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold">{detail.count.number}</span>
                  {statusBadge(detail.count.status)}
                </div>
              )}
            </div>

            {!detail || loadingDetail ? (
              <div className="py-10 text-center text-sm text-slate-400">جارٍ التحميل…</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 rounded-lg border bg-slate-50 p-3 text-xs sm:grid-cols-4">
                  <div>
                    <div className="text-slate-400">التقدّم</div>
                    <div className="font-bold tabular-nums">
                      {live ? live.counted : 0} / {detail.items.length}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">مطابق</div>
                    <div className="font-bold tabular-nums text-slate-600">{live?.matched ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">زيادة</div>
                    <div className="font-bold tabular-nums text-teal-700">{live?.increased ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">عجز</div>
                    <div className="font-bold tabular-nums text-rose-700">{live?.decreased ?? 0}</div>
                  </div>
                </div>

                <div className="max-h-[45vh] overflow-y-auto rounded-lg border">
                  <Table>
                    <TableHeader className="sticky top-0 bg-white">
                      <TableRow>
                        <TableHead>الدواء / التشغيلة</TableHead>
                        <TableHead>الانتهاء</TableHead>
                        <TableHead>النظام</TableHead>
                        <TableHead className="w-24">المعدود</TableHead>
                        <TableHead>الفرق</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.items.slice(0, RENDER_CAP).map((i) => {
                        const raw = draft[i.id];
                        const val = raw === undefined ? i.countedQty : raw.trim() === "" ? null : Number(raw);
                        const valid = val !== null && Number.isInteger(val) && val >= 0;
                        const delta = valid ? (val as number) - i.systemQty : null;
                        return (
                          <TableRow key={i.id}>
                            <TableCell>
                              <div className="text-sm font-medium">{i.medicineName}</div>
                              <div className="font-mono text-xs text-slate-400">
                                {i.lotNumber} · {fmtMoney(i.unitCost)}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-slate-500">{fmtDate(i.expiryDate)}</TableCell>
                            <TableCell className="tabular-nums">{i.systemQty}</TableCell>
                            <TableCell>
                              {detail.count.status === "open" ? (
                                <Input
                                  value={draft[i.id] ?? ""}
                                  onChange={(e) =>
                                    setDraft((d) => ({ ...d, [i.id]: e.target.value.replace(/[^0-9]/g, "") }))
                                  }
                                  inputMode="numeric"
                                  className="h-8 text-center tabular-nums"
                                  placeholder="—"
                                />
                              ) : (
                                <span className="tabular-nums">{i.countedQty ?? "—"}</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {delta === null ? (
                                <span className="text-xs text-slate-300">لم يُعدّ</span>
                              ) : delta === 0 ? (
                                <Check className="h-4 w-4 text-slate-400" />
                              ) : (
                                <Badge
                                  variant="outline"
                                  className={
                                    delta > 0
                                      ? "border-teal-300 bg-teal-50 text-teal-700"
                                      : "border-rose-300 bg-rose-50 text-rose-700"
                                  }
                                >
                                  {delta > 0 ? "+" : ""}
                                  {delta}
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  {detail.items.length > RENDER_CAP && (
                    <div className="border-t bg-amber-50 p-2 text-center text-xs text-amber-700">
                      تُعرض أول {RENDER_CAP} بنداً من {detail.items.length} — الكامل في تقرير Excel
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-slate-500">
                    فُتحت: {fmtDate(detail.count.openedAt, true)} ·{" "}
                    {detail.count.openedBy?.fullName ?? "—"}
                    {detail.count.closedAt && (
                      <>
                        {" "}· أُغلقت: {fmtDate(detail.count.closedAt, true)}
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" className="gap-1.5" disabled={busy !== null} onClick={exportExcel}>
                      {busy === "export" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      تصدير Excel
                    </Button>
                    {detail.count.status === "open" && (
                      <>
                        <Button size="sm" variant="outline" className="gap-1.5" disabled={busy !== null} onClick={saveCounts}>
                          {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          حفظ العدّ
                        </Button>
                        {isAdmin && (
                          <Button size="sm" className="gap-1.5" disabled={busy !== null} onClick={applySession}>
                            {busy === "apply" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            تطبيق الفروقات
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
