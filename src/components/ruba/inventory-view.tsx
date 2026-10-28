"use client";

import { useCallback, useEffect, useState } from "react";
import { api, fmtDate, fmtMoney, MOVEMENT_LABEL } from "@/lib/api-client";
import type { AuthUser, Medicine, Category, StockMovement } from "@/lib/types";
import { StockBadge, ExpiryBadge, EmptyState, LoadingRows } from "./shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { TransfersDialog } from "./transfers-dialog"; // v5.2 — التحويلات بين الفروع
import {
  Search,
  Plus,
  MoreHorizontal,
  Pencil,
  PackagePlus,
  History,
  Trash2,
  Loader2,
  Tags,
  X,
  ArrowLeftRight,
  FileSpreadsheet,
  ArrowDownUp,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BatchesDialog } from "./batches-dialog";

const RANK: Record<string, number> = { technician: 1, pharmacist: 2, admin: 3 };

const EMPTY_FORM = {
  name: "",
  genericName: "",
  barcode: "",
  categoryId: "",
  manufacturer: "",
  dosage: "",
  purchasePrice: "",
  sellingPrice: "",
  quantity: "0",
  minQuantity: "5",
  expiryDate: "",
  requiresPrescription: false,
};

export function InventoryView({ user }: { user: AuthUser }) {
  const canManage = (RANK[user.role] ?? 0) >= 2;

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [categoryId, setCategoryId] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; results: Medicine[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Medicine | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const [restockTarget, setRestockTarget] = useState<Medicine | null>(null);
  const [restockQty, setRestockQty] = useState("");
  // ── v5.2 — التحويلات بين الفروع + تصدير Excel ──
  const [transfersOpen, setTransfersOpen] = useState(false);
  const [exportingInv, setExportingInv] = useState(false);
  const [restockRef, setRestockRef] = useState("");
  const [restocking, setRestocking] = useState(false);

  const [movementsTarget, setMovementsTarget] = useState<Medicine | null>(null);
  const [movements, setMovements] = useState<StockMovement[] | null>(null);
  const [batchesTarget, setBatchesTarget] = useState<Medicine | null>(null);

  const [catsOpen, setCatsOpen] = useState(false);
  const [newCat, setNewCat] = useState("");

  const pageSize = 12;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        filter,
      });
      if (q.trim()) params.set("q", q.trim());
      if (categoryId !== "all") params.set("categoryId", categoryId);
      const r = await api<{ total: number; results: Medicine[] }>(`/api/medicines?${params}`);
      setData(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطأ في جلب المخزون");
    } finally {
      setLoading(false);
    }
  }, [q, filter, categoryId, page]);

  useEffect(() => {
    const t = setTimeout(load, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function loadCategories() {
    try {
      const r = await api<{ categories: Category[] }>("/api/categories");
      setCategories(r.categories);
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    loadCategories();
  }, []);

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, categoryId: categories[0]?.id ?? "" });
    setFormOpen(true);
  }

  function openEdit(m: Medicine) {
    setEditing(m);
    setForm({
      name: m.name,
      genericName: m.genericName,
      barcode: m.barcode,
      categoryId: m.categoryId,
      manufacturer: m.manufacturer ?? "",
      dosage: m.dosage ?? "",
      purchasePrice: (m.purchasePrice / 100).toString(),
      sellingPrice: (m.sellingPrice / 100).toString(),
      quantity: String(m.quantity),
      minQuantity: String(m.minQuantity),
      expiryDate: m.expiryDate.slice(0, 10),
      requiresPrescription: m.requiresPrescription,
    });
    setFormOpen(true);
  }

  async function save() {
    if (!form.name.trim() || !form.genericName.trim() || !form.barcode.trim() || !form.categoryId || !form.expiryDate) {
      toast.error("أكمل الحقول: الاسم، المادة الفعالة، الباركود، التصنيف، الصلاحية");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api(`/api/medicines/${editing.id}`, { method: "PUT", json: form });
        toast.success("تم تحديث الدواء");
      } else {
        await api("/api/medicines", { method: "POST", json: form });
        toast.success("تمت إضافة الدواء");
      }
      setFormOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر الحفظ");
    } finally {
      setSaving(false);
    }
  }

  async function doRestock() {
    if (!restockTarget) return;
    const qty = parseInt(restockQty, 10);
    if (!qty || qty <= 0) {
      toast.error("أدخل كمية صحيحة");
      return;
    }
    setRestocking(true);
    try {
      await api("/api/medicines/restock", {
        method: "POST",
        json: { medicineId: restockTarget.id, quantity: qty, reference: restockRef },
      });
      toast.success(`تمت إضافة ${qty} وحدة إلى ${restockTarget.name}`);
      setRestockTarget(null);
      setRestockQty("");
      setRestockRef("");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشلت التعبئة");
    } finally {
      setRestocking(false);
    }
  }

  async function openMovements(m: Medicine) {
    setMovementsTarget(m);
    setMovements(null);
    try {
      const r = await api<{ movements: StockMovement[] }>(
        `/api/medicines/movements?medicineId=${m.id}&limit=30`
      );
      setMovements(r.movements);
    } catch {
      setMovements([]);
    }
  }

  async function removeMedicine(m: Medicine) {
    if (!confirm(`تأكيد حذف "${m.name}"؟ إذا كان مرتبطاً بمبيعات سيُؤرشف فقط.`)) return;
    try {
      const r = await api<{ message: string }>(`/api/medicines/${m.id}`, { method: "DELETE" });
      toast.success(r.message);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر الحذف");
    }
  }

  async function addCategory() {
    if (!newCat.trim()) return;
    try {
      await api("/api/categories", { method: "POST", json: { name: newCat.trim() } });
      setNewCat("");
      loadCategories();
      toast.success("تمت إضافة التصنيف");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذرت الإضافة");
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div className="space-y-4">
      {/* شريط الأدوات */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="ابحث بالاسم أو الباركود…"
            className="ps-9"
          />
        </div>
        <Select
          value={filter}
          onValueChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">الكل</SelectItem>
            <SelectItem value="low">قرب النفاد</SelectItem>
            <SelectItem value="expiring">قرب الانتهاء (90ي)</SelectItem>
            <SelectItem value="expired">منتهية</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={categoryId}
          onValueChange={(v) => {
            setCategoryId(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="التصنيف" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل التصنيفات</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          onClick={() => setTransfersOpen(true)}
        >
          <ArrowLeftRight className="size-4" />
          التحويلات
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            setExportingInv(true);
            try {
              const res = await fetch("/api/reports/inventory/export", { credentials: "include" });
              if (!res.ok) throw new Error("فشل التصدير");
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `ruba-inventory-${new Date().toISOString().slice(0, 10)}.xlsx`;
              a.click();
              URL.revokeObjectURL(url);
              toast.success("تم تصدير المخزون إلى Excel");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "فشل التصدير");
            } finally {
              setExportingInv(false);
            }
          }}
          disabled={exportingInv}
        >
          {exportingInv ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
          تصدير Excel
        </Button>
        {canManage && (
          <>
            <Button variant="outline" onClick={() => setCatsOpen(true)}>
              <Tags className="size-4" />
              التصنيفات
            </Button>
            <Button onClick={openAdd} className="bg-teal-600 hover:bg-teal-700">
              <Plus className="size-4" />
              دواء جديد
            </Button>
          </>
        )}
      </div>

      {/* v5.2 — حوار التحويلات بين الفروع */}
      <TransfersDialog open={transfersOpen} onOpenChange={setTransfersOpen} user={user} />

      {/* الجدول */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {loading && !data ? (
          <LoadingRows rows={8} />
        ) : !data || data.results.length === 0 ? (
          <EmptyState
            title="لا توجد أدوية مطابقة"
            hint="جرّب تغيير كلمة البحث أو الفلاتر، أو أضف دواءً جديداً"
            action={
              canManage ? (
                <Button onClick={openAdd} variant="outline" className="mt-2">
                  <Plus className="size-4" /> إضافة دواء
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الدواء</TableHead>
                  <TableHead className="hidden md:table-cell">التصنيف</TableHead>
                  <TableHead className="text-center">المخزون</TableHead>
                  <TableHead className="hidden text-center sm:table-cell">الصلاحية</TableHead>
                  <TableHead className="text-end">السعر</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.results.map((m) => {
                  const days = Math.ceil((new Date(m.expiryDate).getTime() - Date.now()) / 86400000);
                  return (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold">{m.name}</p>
                            <p className="num truncate text-xs text-muted-foreground" dir="ltr">
                              {m.barcode} · {m.genericName}
                              {m.dosage ? ` · ${m.dosage}` : ""}
                            </p>
                          </div>
                          {m.requiresPrescription && (
                            <Badge variant="outline" className="hidden shrink-0 text-[10px] lg:inline-flex">
                              وصفة
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="secondary" className="font-medium">
                          {m.category.name}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className="num text-sm font-bold">{m.quantity}</span>
                          {m.reservedQty ? (
                            <span
                              className="text-[10px] text-violet-600 dark:text-violet-400"
                              title={`المتاح للبيع: ${m.availableQuantity ?? 0}`}
                            >
                              محجوز {m.reservedQty}
                            </span>
                          ) : null}
                          <StockBadge quantity={m.quantity} minQuantity={m.minQuantity} />
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-center sm:table-cell">
                        <div className="flex flex-col items-center gap-1">
                          <span className="num text-xs text-muted-foreground">
                            {m.expiryDate.slice(0, 10)}
                          </span>
                          <ExpiryBadge daysUntilExpiry={days} />
                        </div>
                      </TableCell>
                      <TableCell className="num text-end font-bold text-teal-700 dark:text-teal-400">
                        {fmtMoney(m.sellingPrice)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-44">
                            {canManage && (
                              <>
                                <DropdownMenuItem onClick={() => openEdit(m)}>
                                  <Pencil className="size-4" /> تعديل
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setRestockTarget(m)}>
                                  <PackagePlus className="size-4" /> تعبئة مخزون
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setBatchesTarget(m)}>
                                  <Layers className="size-4" /> دفعات التشغيلة (LOT)
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                              </>
                            )}
                            <DropdownMenuItem onClick={() => openMovements(m)}>
                              <History className="size-4" /> سجل الحركات
                            </DropdownMenuItem>
                            {canManage && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => removeMedicine(m)}
                                  className="text-rose-600 focus:text-rose-600"
                                >
                                  <Trash2 className="size-4" /> حذف / أرشفة
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* ترقيم الصفحات */}
            <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
              <span className="text-muted-foreground">
                المجموع: <span className="num font-bold">{data.total}</span> صنف
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  السابق
                </Button>
                <span className="num px-2 text-xs text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  التالي
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* نافذة إضافة/تعديل */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing ? `تعديل: ${editing.name}` : "إضافة دواء جديد"}</DialogTitle>
            <DialogDescription>
              {editing ? "حدّث بيانات الدواء ثم احفظ" : "أدخل بيانات الدواء — الحقول المميزة بـ * إلزامية"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>الاسم التجاري *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>المادة الفعالة (Generic) *</Label>
              <Input
                value={form.genericName}
                onChange={(e) => setForm({ ...form, genericName: e.target.value })}
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label>الباركود *</Label>
              <Input
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label>التصنيف *</Label>
              <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر التصنيف" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>الشركة المصنعة</Label>
              <Input
                value={form.manufacturer}
                onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>الجرعة (مثل 500mg)</Label>
              <Input value={form.dosage} onChange={(e) => setForm({ ...form, dosage: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>سعر الشراء (ر.س)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.purchasePrice}
                onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>سعر البيع (ر.س) *</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.sellingPrice}
                onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
              />
            </div>
            {!editing && (
              <div className="space-y-1.5">
                <Label>الكمية الافتتاحية</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>حد التنبيه (أدنى كمية)</Label>
              <Input
                type="number"
                min="0"
                value={form.minQuantity}
                onChange={(e) => setForm({ ...form, minQuantity: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>تاريخ انتهاء الصلاحية *</Label>
              <Input
                type="date"
                value={form.expiryDate}
                onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-3 rounded-lg border p-3 sm:col-span-2">
              <Switch
                checked={form.requiresPrescription}
                onCheckedChange={(v) => setForm({ ...form, requiresPrescription: v })}
              />
              <div>
                <p className="text-sm font-medium">يتطلب وصفة طبية</p>
                <p className="text-xs text-muted-foreground">
                  سيظهر تنبيه عند البيع داخل نقطة البيع
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={save} disabled={saving} className="bg-teal-600 hover:bg-teal-700">
              {saving ? <Loader2 className="size-4 animate-spin" /> : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* نافذة التعبئة */}
      <Dialog open={!!restockTarget} onOpenChange={(o) => !o && setRestockTarget(null)}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>تعبئة المخزون</DialogTitle>
            <DialogDescription>
              {restockTarget?.name} — الرصيد الحالي:{" "}
              <span className="num font-bold">{restockTarget?.quantity}</span> وحدة
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>الكمية المضافة *</Label>
              <Input
                type="number"
                min="1"
                value={restockQty}
                onChange={(e) => setRestockQty(e.target.value)}
                placeholder="مثال: 50"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>مرجع التوريد (اختياري)</Label>
              <Input
                value={restockRef}
                onChange={(e) => setRestockRef(e.target.value)}
                placeholder="رقم فاتورة المورد"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestockTarget(null)}>
              إلغاء
            </Button>
            <Button onClick={doRestock} disabled={restocking} className="bg-teal-600 hover:bg-teal-700">
              {restocking ? <Loader2 className="size-4 animate-spin" /> : "تعبئة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* نافذة سجل الحركات */}
      <Dialog open={!!movementsTarget} onOpenChange={(o) => !o && setMovementsTarget(null)}>
        <DialogContent className="sm:max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>سجل حركات: {movementsTarget?.name}</DialogTitle>
            <DialogDescription>سجل التدقيق الكامل لآخر 30 حركة</DialogDescription>
          </DialogHeader>
          {movements === null ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : movements.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">لا حركات مسجلة بعد</p>
          ) : (
            <div className="max-h-80 space-y-1.5 overflow-y-auto pe-1">
              {movements.map((mv) => (
                <div key={mv.id} className="flex items-center justify-between rounded-lg border p-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge
                      className={cn(
                        "min-w-16 justify-center",
                        mv.type === "sale" && "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
                        mv.type === "restock" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
                        mv.type === "return" && "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400",
                        mv.type === "adjust" && "bg-muted text-muted-foreground"
                      )}
                    >
                      {MOVEMENT_LABEL[mv.type] ?? mv.type}
                    </Badge>
                    <span className="num text-xs text-muted-foreground">
                      {fmtDate(mv.createdAt, true)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={cn("num text-sm font-bold", mv.delta >= 0 ? "text-emerald-600" : "text-rose-600")}>
                      {mv.delta >= 0 ? "+" : ""}
                      {mv.delta}
                    </span>
                    <span className="num text-xs text-muted-foreground">
                      → {mv.balanceAfter}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* نافذة التصنيفات */}
      <Dialog open={catsOpen} onOpenChange={setCatsOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>إدارة التصنيفات</DialogTitle>
            <DialogDescription>أضف تصنيفات دوائية جديدة</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              placeholder="اسم التصنيف الجديد"
              onKeyDown={(e) => e.key === "Enter" && addCategory()}
            />
            <Button onClick={addCategory} className="shrink-0 bg-teal-600 hover:bg-teal-700">
              <Plus className="size-4" />
            </Button>
          </div>
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="num text-xs text-muted-foreground">
                  {c._count?.medicines ?? 0} دواء
                </span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* حوار دفعات التشغيلة (LOT) */}
      <BatchesDialog
        medicine={batchesTarget ? { id: batchesTarget.id, name: batchesTarget.name, quantity: batchesTarget.quantity } : null}
        canManage={canManage}
        canRecall={user.role === "admin"}
        onClose={() => setBatchesTarget(null)}
        onChanged={() => load()}
      />
    </div>
  );
}
