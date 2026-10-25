"use client";

import { useCallback, useEffect, useState } from "react";
import { api, fmtMoney, fmtDate } from "@/lib/api-client";
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
  ClipboardList,
  Loader2,
  PackageCheck,
  Phone,
  Plus,
  Truck,
  Ban,
} from "lucide-react";

// ─────────────── عرض الموردين وأوامر الشراء (v3.2) ───────────────

interface Supplier {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive: boolean;
  _count?: { purchaseOrders: number };
}

interface POItem {
  id: string;
  medicineId: string;
  quantity: number;
  unitCost: number;
  lotNumber?: string | null;
  expiryDate?: string | null;
  receivedQty: number;
  medicine: { name: string; barcode: string };
}

interface PurchaseOrder {
  id: string;
  number: number;
  status: string;
  totalHalalas: number;
  notes?: string | null;
  createdAt: string;
  receivedAt?: string | null;
  supplier: { name: string };
  items: POItem[];
}

interface MedicineLite {
  id: string;
  name: string;
  quantity: number;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "بانتظار الاستلام",
  received: "مُستلم",
  cancelled: "ملغى",
};

function StatusBadge({ status }: { status: string }) {
  if (status === "received")
    return <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">{STATUS_LABEL[status]}</Badge>;
  if (status === "cancelled") return <Badge variant="destructive">{STATUS_LABEL[status]}</Badge>;
  return <Badge variant="outline" className="border-amber-300 text-amber-600">{STATUS_LABEL[status]}</Badge>;
}

export function SuppliersView({ user }: { user: AuthUser }) {
  const [tab, setTab] = useState<"suppliers" | "orders">("orders");
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const canManage = user.role === "admin" || user.role === "pharmacist";

  const [supplierDialog, setSupplierDialog] = useState(false);
  const [supplierForm, setSupplierForm] = useState({ name: "", phone: "", email: "", address: "", notes: "" });
  const [savingSupplier, setSavingSupplier] = useState(false);

  const [poDialog, setPoDialog] = useState(false);
  const [medicines, setMedicines] = useState<MedicineLite[]>([]);
  const [medSearch, setMedSearch] = useState("");
  const [poSupplierId, setPoSupplierId] = useState("");
  const [poNotes, setPoNotes] = useState("");
  const [lines, setLines] = useState<
    { medicineId: string; name: string; quantity: string; unitCost: string; lotNumber: string; expiryDate: string }[]
  >([]);
  const [savingPO, setSavingPO] = useState(false);
  const [receiving, setReceiving] = useState<string | null>(null);

  const loadSuppliers = useCallback(async () => {
    try {
      const r = await api<{ suppliers: Supplier[] }>("/api/suppliers");
      setSuppliers(r.suppliers);
    } catch {
      toast.error("تعذر جلب الموردين");
      setSuppliers([]);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const r = await api<{ orders: PurchaseOrder[] }>("/api/purchase-orders");
      setOrders(r.orders);
    } catch {
      toast.error("تعذر جلب أوامر الشراء");
      setOrders([]);
    }
  }, []);

  useEffect(() => {
    loadSuppliers();
    loadOrders();
  }, [loadSuppliers, loadOrders]);

  useEffect(() => {
    if (!poDialog) return;
    const t = setTimeout(async () => {
      try {
        const q = medSearch.trim();
        const r = await api<{ medicines: MedicineLite[] }>(
          `/api/medicines?q=${encodeURIComponent(q)}&pageSize=8`
        );
        setMedicines(r.medicines);
      } catch {
        /* تجاهل */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [medSearch, poDialog]);

  async function saveSupplier() {
    if (!supplierForm.name.trim()) {
      toast.error("اسم المورد مطلوب");
      return;
    }
    setSavingSupplier(true);
    try {
      await api("/api/suppliers", { method: "POST", json: supplierForm });
      toast.success("تمت إضافة المورد");
      setSupplierDialog(false);
      setSupplierForm({ name: "", phone: "", email: "", address: "", notes: "" });
      loadSuppliers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر الحفظ");
    } finally {
      setSavingSupplier(false);
    }
  }

  async function toggleSupplier(s: Supplier) {
    try {
      await api(`/api/suppliers/${s.id}`, {
        method: "PATCH",
        json: { isActive: !s.isActive },
      });
      toast.success(s.isActive ? "تم تعطيل المورد" : "تم تفعيل المورد");
      loadSuppliers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر التحديث");
    }
  }

  function addLine(m: MedicineLite) {
    if (lines.some((l) => l.medicineId === m.id)) {
      toast.error("الدواء مضاف بالفعل — عدّل كميته");
      return;
    }
    setLines([
      ...lines,
      { medicineId: m.id, name: m.name, quantity: "", unitCost: "", lotNumber: "", expiryDate: "" },
    ]);
    setMedSearch("");
  }

  const poTotal = lines.reduce(
    (s, l) => s + (parseInt(l.quantity, 10) || 0) * Math.round((parseFloat(l.unitCost) || 0) * 100),
    0
  );

  async function savePO() {
    if (!poSupplierId) {
      toast.error("اختر المورد");
      return;
    }
    const items = lines
      .filter((l) => parseInt(l.quantity, 10) > 0)
      .map((l) => ({
        medicineId: l.medicineId,
        quantity: parseInt(l.quantity, 10),
        unitCost: Math.round((parseFloat(l.unitCost) || 0) * 100),
        lotNumber: l.lotNumber || undefined,
        expiryDate: l.expiryDate || undefined,
      }));
    if (items.length === 0) {
      toast.error("أضف بنداً واحداً على الأقل بكمية صحيحة");
      return;
    }
    setSavingPO(true);
    try {
      await api("/api/purchase-orders", {
        method: "POST",
        json: { supplierId: poSupplierId, items, notes: poNotes || undefined },
      });
      toast.success("أُنشئ أمر الشراء");
      setPoDialog(false);
      setLines([]);
      setPoNotes("");
      setPoSupplierId("");
      loadOrders();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر الإنشاء");
    } finally {
      setSavingPO(false);
    }
  }

  async function receivePO(po: PurchaseOrder) {
    if (
      !confirm(
        `استلام أمر الشراء رقم ${po.number}؟\nسيُنشئ دفعات التشغيل ويحدّث الأرصدة — لا يمكن التراجع.`
      )
    )
      return;
    setReceiving(po.id);
    try {
      await api(`/api/purchase-orders/${po.id}/receive`, { method: "POST" });
      toast.success("تم الاستلام — أُنشئت الدفعات وسُجّلت الحركات");
      loadOrders();
      loadSuppliers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر الاستلام");
    } finally {
      setReceiving(null);
    }
  }

  const activeSuppliers = suppliers?.filter((s) => s.isActive) ?? [];

  return (
    <div className="space-y-4">
      {/* التبويبات */}
      <div className="flex items-center gap-2">
        {(
          [
            { k: "orders", label: "أوامر الشراء", icon: ClipboardList },
            { k: "suppliers", label: "الموردون", icon: Truck },
          ] as const
        ).map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${
              tab === t.k
                ? "bg-teal-600 text-white shadow-md shadow-teal-600/20"
                : "border bg-card text-muted-foreground hover:bg-accent"
            }`}
          >
            <t.icon className="size-4" />
            {t.label}
          </button>
        ))}
        <div className="ms-auto">
          {canManage && tab === "suppliers" && (
            <Button onClick={() => setSupplierDialog(true)} className="bg-teal-600 hover:bg-teal-700">
              <Plus className="size-4" /> مورد جديد
            </Button>
          )}
          {canManage && tab === "orders" && (
            <Button
              onClick={() => setPoDialog(true)}
              className="bg-teal-600 hover:bg-teal-700"
              disabled={activeSuppliers.length === 0}
              title={activeSuppliers.length === 0 ? "أضف مورداً أولاً" : undefined}
            >
              <Plus className="size-4" /> أمر شراء
            </Button>
          )}
        </div>
      </div>

      {/* أوامر الشراء */}
      {tab === "orders" &&
        (orders === null ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-7 animate-spin text-teal-600" />
          </div>
        ) : orders.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <ClipboardList className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              لا توجد أوامر شراء — أنشئ أولاً أمراً لموردك
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((po) => (
              <div key={po.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="num rounded-lg bg-muted px-2 py-0.5 text-xs font-bold" dir="ltr">
                    PO-{po.number}
                  </span>
                  <span className="text-sm font-bold">{po.supplier.name}</span>
                  <StatusBadge status={po.status} />
                  <span className="num ms-auto text-sm font-bold text-teal-600 dark:text-teal-400">
                    {fmtMoney(po.totalHalalas)} ر.س
                  </span>
                  {canManage && po.status === "draft" && (
                    <Button
                      size="sm"
                      className="bg-teal-600 hover:bg-teal-700"
                      disabled={receiving === po.id}
                      onClick={() => receivePO(po)}
                    >
                      {receiving === po.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <PackageCheck className="size-4" />
                      )}
                      استلام
                    </Button>
                  )}
                </div>
                <div className="mt-3 overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">الدواء</TableHead>
                        <TableHead className="text-center text-xs">الكمية</TableHead>
                        <TableHead className="text-xs">تكلفة الوحدة</TableHead>
                        <TableHead className="text-xs">التشغيلة</TableHead>
                        <TableHead className="text-xs">الصلاحية</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {po.items.map((it) => (
                        <TableRow key={it.id}>
                          <TableCell className="text-sm font-medium">{it.medicine.name}</TableCell>
                          <TableCell className="num text-center text-sm">
                            {it.quantity}
                            {it.receivedQty > 0 && (
                              <span className="ms-1 text-[10px] text-emerald-600">(استلم {it.receivedQty})</span>
                            )}
                          </TableCell>
                          <TableCell className="num text-sm">{fmtMoney(it.unitCost)}</TableCell>
                          <TableCell className="num text-xs" dir="ltr">
                            {it.lotNumber ?? "تلقائي"}
                          </TableCell>
                          <TableCell className="num text-xs">
                            {it.expiryDate ? it.expiryDate.slice(0, 10) : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  أُنشئ {fmtDate(po.createdAt)}
                  {po.receivedAt ? ` · استُلم ${fmtDate(po.receivedAt)}` : ""}
                  {po.notes ? ` · ${po.notes}` : ""}
                </p>
              </div>
            ))}
          </div>
        ))}

      {/* الموردون */}
      {tab === "suppliers" &&
        (suppliers === null ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-7 animate-spin text-teal-600" />
          </div>
        ) : suppliers.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <Truck className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">لا يوجد موردون — أضف أول مورد</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {suppliers.map((s) => (
              <div
                key={s.id}
                className={`rounded-xl border bg-card p-4 ${!s.isActive ? "opacity-55" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400">
                    <Truck className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{s.name}</p>
                    <p className="num mt-0.5 text-xs text-muted-foreground" dir="ltr">
                      {s.phone ? (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="size-3" /> {s.phone}
                        </span>
                      ) : (
                        "—"
                      )}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="num text-xs text-muted-foreground">
                    {s._count?.purchaseOrders ?? 0} أمر شراء
                  </span>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => toggleSupplier(s)}
                    >
                      <Ban className="size-3.5" /> {s.isActive ? "تعطيل" : "تفعيل"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}

      {/* حوار مورد جديد */}
      <Dialog open={supplierDialog} onOpenChange={(o) => !o && setSupplierDialog(false)}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="size-5 text-teal-600" /> مورد جديد
            </DialogTitle>
            <DialogDescription>بيانات شركة التوريد الدوائي</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">اسم المورد *</Label>
              <Input
                placeholder="شركة الأدوية المتحدة"
                value={supplierForm.name}
                onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">الجوال</Label>
              <Input
                dir="ltr"
                placeholder="05xxxxxxxx"
                value={supplierForm.phone}
                onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">البريد</Label>
              <Input
                dir="ltr"
                type="email"
                value={supplierForm.email}
                onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })}
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">العنوان</Label>
              <Input
                value={supplierForm.address}
                onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })}
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">ملاحظات</Label>
              <Input
                value={supplierForm.notes}
                onChange={(e) => setSupplierForm({ ...supplierForm, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter className="flex-row gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setSupplierDialog(false)}>
              إلغاء
            </Button>
            <Button
              className="flex-1 bg-teal-600 hover:bg-teal-700"
              disabled={savingSupplier}
              onClick={saveSupplier}
            >
              {savingSupplier ? <Loader2 className="size-4 animate-spin" /> : "حفظ المورد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* حوار أمر شراء جديد */}
      <Dialog open={poDialog} onOpenChange={(o) => !o && setPoDialog(false)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="size-5 text-teal-600" /> أمر شراء جديد
            </DialogTitle>
            <DialogDescription>
              عند الاستلام تُنشأ دفعات التشغيل تلقائياً بالتكلفة الفعلية (FEFO جاهز)
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">المورد *</Label>
              <select
                className="h-9 w-full rounded-md border bg-card px-3 text-sm"
                value={poSupplierId}
                onChange={(e) => setPoSupplierId(e.target.value)}
              >
                <option value="">— اختر —</option>
                {activeSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">بحث دواء لإضافته</Label>
              <Input
                placeholder="اكتب اسم الدواء…"
                value={medSearch}
                onChange={(e) => setMedSearch(e.target.value)}
              />
              {medSearch.trim() && medicines.length > 0 && (
                <div className="max-h-36 overflow-y-auto rounded-md border bg-card">
                  {medicines.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => addLine(m)}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-start text-xs hover:bg-accent"
                    >
                      <span className="truncate">{m.name}</span>
                      <span className="num text-muted-foreground">رصيد {m.quantity}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {lines.length > 0 && (
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={l.medicineId} className="rounded-lg border bg-muted/30 p-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold">{l.name}</p>
                    <button
                      className="text-xs text-rose-600 hover:underline"
                      onClick={() => setLines(lines.filter((_, j) => j !== i))}
                    >
                      إزالة
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Input
                      type="number"
                      min="1"
                      placeholder="الكمية"
                      className="h-8 text-xs"
                      value={l.quantity}
                      onChange={(e) =>
                        setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))
                      }
                    />
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="تكلفة الوحدة ر.س"
                      className="h-8 text-xs"
                      value={l.unitCost}
                      onChange={(e) =>
                        setLines(lines.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)))
                      }
                    />
                    <Input
                      dir="ltr"
                      placeholder="التشغيلة (اختياري)"
                      className="h-8 text-xs"
                      value={l.lotNumber}
                      onChange={(e) =>
                        setLines(lines.map((x, j) => (j === i ? { ...x, lotNumber: e.target.value } : x)))
                      }
                    />
                    <Input
                      type="date"
                      className="h-8 text-xs"
                      title="الصلاحية (تُطلب عند الاستلام)"
                      value={l.expiryDate}
                      onChange={(e) =>
                        setLines(lines.map((x, j) => (j === i ? { ...x, expiryDate: e.target.value } : x)))
                      }
                    />
                  </div>
                </div>
              ))}
              <p className="num text-sm font-bold text-teal-600 dark:text-teal-400">
                الإجمالي: {fmtMoney(poTotal)} ر.س
              </p>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">ملاحظات</Label>
            <Input value={poNotes} onChange={(e) => setPoNotes(e.target.value)} />
          </div>

          <DialogFooter className="flex-row gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setPoDialog(false)}>
              إلغاء
            </Button>
            <Button
              className="flex-1 bg-teal-600 hover:bg-teal-700"
              disabled={savingPO}
              onClick={savePO}
            >
              {savingPO ? <Loader2 className="size-4 animate-spin" /> : "إنشاء الأمر"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
