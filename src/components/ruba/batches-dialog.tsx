"use client";

import { useCallback, useEffect, useState } from "react";
import { api, fmtMoney } from "@/lib/api-client";
import type { AuthUser } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Landmark, Layers, Loader2, Plus, ScanSearch, TriangleAlert } from "lucide-react";

interface Batch {
  id: string;
  lotNumber: string;
  expiryDate: string;
  quantity: number;
  unitCost: number;
  supplier?: string | null;
  isRecalled?: boolean;
}

interface AffectedRow {
  saleReference: string;
  saleDate: string;
  customerName: string;
  customerPhone?: string | null;
  patientName?: string | null;
  quantity: number;
}

interface MedicineLite {
  id: string;
  name: string;
  quantity: number;
}

/** حوار إدارة دفعات التشغيلة (LOT) — أساس صرف FEFO ومعايير Odoo/ERPNext */
export function BatchesDialog({
  medicine,
  canManage,
  canRecall,
  onClose,
  onChanged,
}: {
  medicine: MedicineLite | null;
  canManage: boolean;
  canRecall?: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    lotNumber: "",
    expiryDate: "",
    quantity: "",
    unitCost: "",
    supplier: "",
  });
  // سحب دفعة: الدفعة المستهدفة + سبب موثق
  const [recallTarget, setRecallTarget] = useState<Batch | null>(null);
  const [recallReason, setRecallReason] = useState("");
  const [recalling, setRecalling] = useState(false);
  // التتبع الأمامي: من أخذ من هذه الدفعة؟
  const [trace, setTrace] = useState<{
    lotNumber: string;
    affected: AffectedRow[];
    totalUnitsSold: number;
  } | null>(null);
  const [tracing, setTracing] = useState(false);

  const todayIso = new Date().toISOString().slice(0, 10);
  const in90 = (iso: string) => {
    const t = new Date(iso).getTime();
    return t <= Date.now() || t <= Date.now() + 90 * 86400000;
  };

  const load = useCallback(async (medId: string) => {
    try {
      const r = await api<{ batches: Batch[] }>(`/api/batches?medicineId=${medId}`);
      setBatches(r.batches);
    } catch {
      toast.error("تعذر جلب الدفعات");
      setBatches([]);
    }
  }, []);

  useEffect(() => {
    if (medicine) {
      setBatches(null);
      setAdding(false);
      setTrace(null);
      setRecallTarget(null);
      setForm({ lotNumber: "", expiryDate: "", quantity: "", unitCost: "", supplier: "" });
      load(medicine.id);
    }
  }, [medicine, load]);

  async function addBatch() {
    if (!medicine) return;
    if (!form.lotNumber.trim() || !form.expiryDate || !(parseInt(form.quantity, 10) > 0)) {
      toast.error("أكمل: رقم التشغيلة، الصلاحية، والكمية");
      return;
    }
    setSaving(true);
    try {
      await api("/api/batches", {
        method: "POST",
        json: {
          medicineId: medicine.id,
          lotNumber: form.lotNumber.trim(),
          expiryDate: form.expiryDate,
          quantity: parseInt(form.quantity, 10),
          unitCost: form.unitCost ? Math.round(parseFloat(form.unitCost) * 100) : undefined,
          supplier: form.supplier || undefined,
        },
      });
      toast.success("تمت إضافة الدفعة");
      await load(medicine.id);
      setAdding(false);
      setForm({ lotNumber: "", expiryDate: "", quantity: "", unitCost: "", supplier: "" });
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر إضافة الدفعة");
    } finally {
      setSaving(false);
    }
  }

  async function recallBatch() {
    if (!medicine || !recallTarget) return;
    if (!recallReason.trim()) {
      toast.error("سبب السحب إلزامي — لا قرار بلا توثيق");
      return;
    }
    setRecalling(true);
    try {
      await api("/api/registry", {
        method: "POST",
        json: {
          medicineId: medicine.id,
          actionType: "recall",
          scope: "lot",
          lotNumber: recallTarget.lotNumber,
          reason: recallReason.trim(),
          source: "SFDA",
        },
      });
      toast.success(`سُحبت دفعة ${recallTarget.lotNumber} — خرجت من التداول فوراً`);
      setRecallTarget(null);
      setRecallReason("");
      await load(medicine.id);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر سحب الدفعة");
    } finally {
      setRecalling(false);
    }
  }

  async function showTrace(batch: Batch) {
    setTracing(true);
    try {
      const r = await api<{
        affected: AffectedRow[];
        totalUnitsSold: number;
        batch: { lotNumber: string };
      }>(`/api/batches/${batch.id}/recall-affected`);
      setTrace({
        lotNumber: r.batch?.lotNumber ?? batch.lotNumber,
        affected: r.affected ?? [],
        totalUnitsSold: r.totalUnitsSold ?? 0,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر جلب التتبع");
    } finally {
      setTracing(false);
    }
  }

  return (
    <Dialog open={!!medicine} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="size-5 text-teal-600" />
            دفعات التشغيلة — {medicine?.name}
          </DialogTitle>
          <DialogDescription>
            يصرف البيع تلقائياً وفق FEFO: الدفعة الأقرب انتهاءً أولاً، والمنتهية والمسحوبة محجوبة
          </DialogDescription>
        </DialogHeader>

        {batches === null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-6 animate-spin text-teal-600" />
          </div>
        ) : batches.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            لا توجد دفعات مسجلة — أضف دفعة لتصرف منها
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-xs">
                <tr>
                  <th className="p-2 text-start">التشغيلة</th>
                  <th className="p-2 text-start">الصلاحية</th>
                  <th className="p-2 text-center">الكمية</th>
                  <th className="p-2 text-start">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const expired = b.expiryDate.slice(0, 10) <= todayIso;
                  const soon = !expired && in90(b.expiryDate);
                  return (
                    <tr key={b.id} className="border-t">
                      <td className="num p-2 font-bold" dir="ltr">
                        {b.lotNumber}
                        {b.isRecalled && (
                          <Badge variant="destructive" className="ms-1 text-[10px]">
                            مسحوبة
                          </Badge>
                        )}
                      </td>
                      <td className="num p-2">
                        <span className={expired ? "font-bold text-rose-600 dark:text-rose-400" : soon ? "text-amber-600 dark:text-amber-400" : ""}>
                          {b.expiryDate.slice(0, 10)}
                        </span>
                        {expired && (
                          <Badge variant="destructive" className="ms-1 text-[10px]">منتهية</Badge>
                        )}
                        {soon && !expired && (
                          <Badge variant="outline" className="ms-1 border-amber-300 text-[10px] text-amber-600">قريبة</Badge>
                        )}
                      </td>
                      <td className="num p-2 text-center font-bold">{b.quantity}</td>
                      <td className="p-2">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            disabled={tracing}
                            onClick={() => showTrace(b)}
                            title="التتبع الأمامي: من صُرفت له وحدات هذه الدفعة؟"
                          >
                            <ScanSearch className="size-3" /> التتبع
                          </Button>
                          {canRecall && !b.isRecalled && b.quantity > 0 && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-[11px] border-rose-300 text-rose-600 hover:bg-rose-50"
                              onClick={() => {
                                setRecallTarget(b);
                                setRecallReason("");
                              }}
                            >
                              <Landmark className="size-3" /> سحب
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* نتيجة التتبع الأمامي */}
        {trace && (
          <div className="rounded-xl border p-3 space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-bold">
              <ScanSearch className="size-4 text-teal-600" />
              تتبع الدفعة {trace.lotNumber} — {trace.totalUnitsSold} وحدة مصروفة
            </p>
            {trace.affected.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                لا فواتير مصروفة من هذه الدفعة — لا يلزم إبلاغ أي عميل
              </p>
            ) : (
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {trace.affected.map((a, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-2 text-xs"
                  >
                    <span className="num font-bold" dir="ltr">{a.saleReference}</span>
                    <span className="font-medium">{a.patientName ?? a.customerName}</span>
                    {a.customerPhone && (
                      <span className="num text-muted-foreground" dir="ltr">{a.customerPhone}</span>
                    )}
                    <span className="num">{a.quantity} وحدة</span>
                    <span className="num text-muted-foreground" dir="ltr">
                      {a.saleDate?.slice(0, 10)}
                    </span>
                  </div>
                ))}
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  اتصل بكل من ظهر أعلاه وفق بروتوكول السحب — أبلغ الجهة المختصة بالإجراء
                </p>
              </div>
            )}
          </div>
        )}

        {/* نموذج قرار السحب التنظيمي */}
        {recallTarget && (
          <div className="space-y-2 rounded-xl border border-rose-300 bg-rose-50/50 dark:bg-rose-500/10 p-3">
            <p className="text-sm font-bold text-rose-700 dark:text-rose-400">
              قرار سحب دفعة {recallTarget.lotNumber} ({recallTarget.quantity} وحدة) — يخرج من
              التداول فوراً ولا يُصرف منها شيء
            </p>
            <Label className="text-xs">سبب القرار التنظيمي (إلزامي — يوثق في سجل اليقظة)</Label>
            <Input
              placeholder="مثال: انحراف مواصفات في التشغيلة — سحب وقائي بإشعار الهيئة"
              value={recallReason}
              onChange={(e) => setRecallReason(e.target.value)}
            />
            <DialogFooter className="flex-row gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setRecallTarget(null)}>
                إلغاء
              </Button>
              <Button
                className="flex-1 bg-rose-600 hover:bg-rose-700"
                disabled={recalling}
                onClick={recallBatch}
              >
                {recalling ? <Loader2 className="size-4 animate-spin" /> : "تأكيد السحب"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {canManage && !recallTarget && (
          adding ? (
            <div className="space-y-3 rounded-xl border bg-muted/30 p-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">رقم التشغيلة (LOT) *</Label>
                  <Input
                    dir="ltr"
                    placeholder="LOT-2026-001"
                    value={form.lotNumber}
                    onChange={(e) => setForm({ ...form, lotNumber: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">تاريخ الانتهاء *</Label>
                  <Input
                    type="date"
                    min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                    value={form.expiryDate}
                    onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">الكمية *</Label>
                  <Input
                    type="number"
                    min="1"
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">تكلفة الوحدة (ر.س)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.unitCost}
                    onChange={(e) => setForm({ ...form, unitCost: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">المورد</Label>
                <Input
                  value={form.supplier}
                  onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                />
              </div>
              <DialogFooter className="flex-row gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setAdding(false)}>
                  إلغاء
                </Button>
                <Button className="flex-1 bg-teal-600 hover:bg-teal-700" disabled={saving} onClick={addBatch}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : "حفظ الدفعة"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <DialogFooter>
              <Button
                onClick={() => setAdding(true)}
                className="w-full bg-teal-600 hover:bg-teal-700"
              >
                <Plus className="size-4" /> إضافة دفعة جديدة
              </Button>
            </DialogFooter>
          )
        )}

        {batches && batches.some((b) => b.expiryDate.slice(0, 10) <= todayIso) && (
          <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">
            <TriangleAlert className="size-3.5 shrink-0" />
            توجد دفعات منتهية — اسحبها من الرفوف وأبلغ الجهة المختصة بالإتلاف
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
