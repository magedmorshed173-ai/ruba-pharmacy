"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import type { AuthUser } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { ArrowLeftRight, Check, Loader2, Plus, X } from "lucide-react";

/**
 * v5.2 — حوار التحويلات بين الفروع
 *
 * مكون مستقل يفتح من رأس صفحة المخزون: قائمة آخر 50 تحويلاً بحالتها،
 * وإنشاء تحويل جديد (مدير) بمنتقي دواء مفلتر حياً، وقبول/إلغاء المعلّق.
 * الدلالة: «من: المستودع» = الكمية من غير المخصص فوق الرصيد المركزي.
 */

interface BranchLite {
  id: string;
  name: string;
  isActive: boolean;
}

interface TransferRow {
  id: string;
  quantity: number;
  status: string;
  note: string | null;
  createdAt: string;
  acceptedAt: string | null;
  medicine: { name: string; barcode: string };
  fromBranch: { name: string } | null;
  toBranch: { name: string };
  createdBy?: { username: string } | null;
  acceptedBy?: { username: string } | null;
}

interface MedicineLite {
  id: string;
  name: string;
  barcode: string;
  quantity: number;
}

const STATUS_AR: Record<string, { label: string; className: string }> = {
  pending: { label: "معلّق", className: "border-amber-300 bg-amber-50 text-amber-700" },
  accepted: { label: "مقبول", className: "border-teal-300 bg-teal-50 text-teal-700" },
  cancelled: { label: "ملغى", className: "border-slate-300 bg-slate-100 text-slate-500" },
};

export function TransfersDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: AuthUser;
}) {
  const isAdmin = user.role === "admin";
  const [rows, setRows] = useState<TransferRow[] | null>(null);
  const [branches, setBranches] = useState<BranchLite[]>([]);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // صيغة الإنشاء
  const [medQ, setMedQ] = useState("");
  const [picked, setPicked] = useState<MedicineLite | null>(null);
  const [medOptions, setMedOptions] = useState<MedicineLite[]>([]);
  const [medSearching, setMedSearching] = useState(false);
  const [fromBranchId, setFromBranchId] = useState("warehouse");
  const [toBranchId, setToBranchId] = useState("");
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");

  const loadTransfers = useCallback(async () => {
    try {
      const r = await api<{ transfers: TransferRow[] }>("/api/inventory/transfers");
      setRows(r.transfers);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    loadTransfers();
    api<{ branches: BranchLite[] }>("/api/branches")
      .then((r) =>
        setBranches((r.branches ?? []).filter((b) => b.isActive))
      )
      .catch(() => setBranches([]));
  }, [open, loadTransfers]);

  // بحث الدواء المؤجل — lite من نفس نقطة الأدوية
  useEffect(() => {
    if (!open || !isAdmin) return;
    if (!picked && medQ.trim().length < 2) {
      setMedOptions([]);
      return;
    }
    if (picked) return;
    const t = setTimeout(async () => {
      setMedSearching(true);
      try {
        const r = await api<{ results: MedicineLite[] }>(
          `/api/medicines?q=${encodeURIComponent(medQ.trim())}&pageSize=8`
        );
        setMedOptions(r.results ?? []);
      } catch {
        setMedOptions([]);
      } finally {
        setMedSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [medQ, picked, open, isAdmin]);

  const activeBranches = useMemo(
    () => branches.filter((b) => b.isActive),
    [branches]
  );

  function resetForm() {
    setMedQ("");
    setPicked(null);
    setFromBranchId("warehouse");
    setToBranchId("");
    setQty("1");
    setNote("");
  }

  async function createTransfer() {
    if (!picked) return toast.error("اختر الدواء المطلوب تحويله");
    if (!toBranchId) return toast.error("اختر الفرع المستلم");
    setCreating(true);
    try {
      await api("/api/inventory/transfers", {
        method: "POST",
        json: {
          medicineId: picked.id,
          fromBranchId: fromBranchId === "warehouse" ? null : fromBranchId,
          toBranchId,
          quantity: Number(qty),
          note: note || null,
        },
      });
      toast.success("أُنشئ التحويل معلّقاً — تُطبَّق الكميات عند القبول");
      resetForm();
      await loadTransfers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر إنشاء التحويل");
    } finally {
      setCreating(false);
    }
  }

  async function act(id: string, action: "accept" | "cancel") {
    setBusyId(id);
    try {
      await api(`/api/inventory/transfers/${id}/${action}`, { method: "POST" });
      toast.success(action === "accept" ? "قُبل التحويل وطُبِّقت الكميات" : "أُلغي التحويل");
      await loadTransfers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر تنفيذ الإجراء");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="size-5 text-teal-600" /> التحويلات بين الفروع
          </DialogTitle>
          <DialogDescription>
            «من: المستودع» تسحب من غير المخصص فوق الرصيد المركزي — تُطبَّق الكميات عند
            القبول فقط، والبيع من فرع مُوزَّع يخصم من رصيده.
          </DialogDescription>
        </DialogHeader>

        {isAdmin && (
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <Plus className="size-4 text-teal-600" /> تحويل جديد
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>الدواء</Label>
                {picked ? (
                  <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
                    <span>
                      <b>{picked.name}</b>{" "}
                      <span className="text-xs text-muted-foreground">
                        ({picked.barcode}) — المركزي: {picked.quantity}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setPicked(null);
                        setMedQ("");
                      }}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="relative">
                    <Input
                      value={medQ}
                      onChange={(e) => setMedQ(e.target.value)}
                      placeholder="ابحث بالاسم أو الباركود…"
                    />
                    {medSearching && (
                      <Loader2 className="absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                    )}
                    {medOptions.length > 0 && (
                      <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md">
                        {medOptions.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            className="flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-muted"
                            onClick={() => {
                              setPicked(m);
                              setMedOptions([]);
                            }}
                          >
                            <span>{m.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {m.barcode} · المركزي {m.quantity}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>من</Label>
                <Select value={fromBranchId} onValueChange={setFromBranchId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warehouse">المستودع (غير المخصص)</SelectItem>
                    {activeBranches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>إلى</Label>
                <Select value={toBranchId} onValueChange={setToBranchId}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر الفرع المستلم" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeBranches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>الكمية</Label>
                <Input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>ملاحظة (اختياري)</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
            <Button onClick={createTransfer} disabled={creating} className="bg-teal-600 hover:bg-teal-700">
              {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              إنشاء التحويل
            </Button>
          </div>
        )}

        <div className="rounded-xl border bg-card">
          {rows === null ? (
            <div className="p-6 text-center text-sm text-muted-foreground">جارٍ الجلب…</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              لا تحويلات بعد — أنشئ أول تحويل لتوزيع المخزون على الفروع.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الحالة</TableHead>
                  <TableHead className="text-start">الدواء</TableHead>
                  <TableHead className="text-start">المسار</TableHead>
                  <TableHead className="text-start">الكمية</TableHead>
                  <TableHead className="text-start">بواسطة</TableHead>
                  {isAdmin && <TableHead className="text-start">إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => {
                  const st = STATUS_AR[t.status] ?? {
                    label: t.status,
                    className: "",
                  };
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="text-start">
                        <Badge variant="outline" className={st.className}>
                          {st.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-start">
                        {t.medicine.name}
                        {t.note ? (
                          <div className="text-xs text-muted-foreground">{t.note}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-start text-xs">
                        {t.fromBranch?.name ?? "المستودع"} ← {t.toBranch.name}
                      </TableCell>
                      <TableCell className="text-start font-bold">{t.quantity}</TableCell>
                      <TableCell className="text-start text-xs">
                        {t.createdBy?.username ?? "—"}
                        {t.acceptedBy?.username ? ` · قبلها ${t.acceptedBy.username}` : ""}
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-start">
                          {t.status === "pending" ? (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-teal-600"
                                disabled={busyId === t.id}
                                onClick={() => act(t.id, "accept")}
                              >
                                {busyId === t.id ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  <Check className="size-3" />
                                )}
                                قبول
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-red-500"
                                disabled={busyId === t.id}
                                onClick={() => act(t.id, "cancel")}
                              >
                                <X className="size-3" /> إلغاء
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
