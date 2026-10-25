"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, fmtMoney } from "@/lib/api-client";
import type { AuthUser, Medicine, InteractionHit } from "@/lib/types";
import { StockBadge, ExpiryBadge } from "./shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { toast } from "sonner";
import {
  Search,
  ScanBarcode,
  Minus,
  Plus,
  Trash2,
  ShoppingCart,
  Banknote,
  CreditCard,
  ShieldCheck,
  Loader2,
  CheckCircle2,
  TriangleAlert,
  PillBottle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CartLine {
  medicine: Medicine;
  quantity: number;
}

interface CheckoutResult {
  saleId: string;
  reference: string;
  netAmount: number;
  duplicated?: boolean;
  interactionWarnings?: InteractionHit[];
}

export function PosView({ user, onDone }: { user: AuthUser; onDone?: () => void }) {
  const [q, setQ] = useState("");
  const [medicines, setMedicines] = useState<Medicine[] | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountSar, setDiscountSar] = useState("");
  const [payment, setPayment] = useState("cash");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [checking, setChecking] = useState(false);
  const [warnings, setWarnings] = useState<InteractionHit[]>([]);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  async function loadMeds(query = "") {
    try {
      const r = await api<{ results: Medicine[] }>(
        `/api/medicines?pageSize=60&q=${encodeURIComponent(query)}`
      );
      setMedicines(r.results);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطأ في جلب الأدوية");
    }
  }

  useEffect(() => {
    const t = setTimeout(() => loadMeds(q), q ? 350 : 0);
    return () => clearTimeout(t);
  }, [q]);

  const totals = useMemo(() => {
    const total = cart.reduce((acc, l) => acc + l.medicine.sellingPrice * l.quantity, 0);
    const discount = Math.min(
      Math.max(0, Math.round(parseFloat(discountSar || "0") * 100) || 0),
      total
    );
    return { total, discount, net: total - discount };
  }, [cart, discountSar]);

  function addToCart(m: Medicine) {
    setCart((prev) => {
      const found = prev.find((l) => l.medicine.id === m.id);
      if (found) {
        if (found.quantity + 1 > m.quantity) {
          toast.warning(`المتوفر من ${m.name} هو ${m.quantity} فقط`);
          return prev;
        }
        return prev.map((l) => (l.medicine.id === m.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      if (m.quantity < 1) {
        toast.warning(`${m.name} غير متوفر في المخزون`);
        return prev;
      }
      return [...prev, { medicine: m, quantity: 1 }];
    });
  }

  function setQty(medicineId: string, qty: number) {
    setCart((prev) =>
      prev.map((l) => {
        if (l.medicine.id !== medicineId) return l;
        const max = l.medicine.quantity;
        if (qty > max) {
          toast.warning(`المتوفر ${max} فقط`);
          return l;
        }
        return { ...l, quantity: Math.max(1, qty) };
      })
    );
  }

  async function checkInteractions() {
    try {
      const r = await api<{ interactions: InteractionHit[] }>("/api/interactions/check", {
        method: "POST",
        json: { medicineIds: cart.map((l) => l.medicine.id) },
      });
      setWarnings(r.interactions);
    } catch {
      /* الفحص تحذيري فقط */
    }
  }

  useEffect(() => {
    if (cart.length >= 2) checkInteractions();
    else setWarnings([]);
  }, [cart.map((l) => l.medicine.id).join(",")]);

  async function checkout() {
    if (cart.length === 0) {
      toast.error("السلة فارغة");
      return;
    }
    setChecking(true);
    try {
      const r = await api<CheckoutResult>("/api/sales", {
        method: "POST",
        json: {
          items: cart.map((l) => ({ medicineId: l.medicine.id, quantity: l.quantity })),
          discount: totals.discount,
          paymentMethod: payment,
          customerName: customerName.trim() || "عميل نقدي",
          customerPhone: customerPhone.trim(),
          transactionId: `POS-${Date.now()}-${user.username}`,
        },
      });
      setResult(r);
      setCart([]);
      setDiscountSar("");
      setCustomerName("");
      setCustomerPhone("");
      setWarnings([]);
      toast.success(r.duplicated ? "عملية مكررة — تم استرجاع الفاتورة الأصلية" : "تم البيع بنجاح");
      loadMeds(q);
      onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل إتمام البيع");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
      {/* شبكة الأدوية */}
      <div className="min-w-0">
        <div className="relative mb-4">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث بالاسم أو الباركود أو المادة الفعالة…"
            className="h-11 ps-9 text-base"
            autoFocus
          />
        </div>

        {medicines === null ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        ) : medicines.length === 0 ? (
          <div className="rounded-xl border bg-card p-10 text-center text-muted-foreground">
            لا نتائج مطابقة للبحث
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
            {medicines.map((m) => {
              const inCart = cart.find((l) => l.medicine.id === m.id)?.quantity ?? 0;
              const out = m.quantity <= 0;
              return (
                <button
                  key={m.id}
                  disabled={out}
                  onClick={() => addToCart(m)}
                  className={cn(
                    "group relative flex flex-col rounded-xl border bg-card p-3 text-start shadow-sm transition-all hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md",
                    out && "cursor-not-allowed opacity-55 hover:translate-y-0",
                    inCart > 0 && "border-teal-500 ring-1 ring-teal-500/40"
                  )}
                >
                  {inCart > 0 && (
                    <span className="num absolute end-2 top-2 flex size-5 items-center justify-center rounded-full bg-teal-600 text-[10px] font-bold text-white">
                      {inCart}
                    </span>
                  )}
                  <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400">
                    <PillBottle className="size-5" />
                  </div>
                  <p className="line-clamp-1 text-sm font-bold">{m.name}</p>
                  <p className="num mt-0.5 text-[11px] text-muted-foreground" dir="ltr">
                    {m.barcode}
                  </p>
                  <div className="mt-auto flex items-center justify-between pt-2">
                    <span className="num text-sm font-extrabold text-teal-700 dark:text-teal-400">
                      {fmtMoney(m.sellingPrice)}
                      <span className="ms-1 text-[9px] font-normal">ر.س</span>
                    </span>
                    <span className="num text-[11px] font-medium text-muted-foreground">
                      مخزون {m.quantity}
                    </span>
                  </div>
                  {m.quantity <= m.minQuantity && (
                    <div className="mt-1.5">
                      <StockBadge quantity={m.quantity} minQuantity={m.minQuantity} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* السلة */}
      <div className="flex flex-col rounded-xl border bg-card shadow-sm xl:sticky xl:top-20 xl:max-h-[calc(100vh-6.5rem)]">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <ShoppingCart className="size-5 text-teal-600" />
            <h3 className="font-bold">سلة البيع</h3>
            <Badge className="num bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400">
              {cart.length}
            </Badge>
          </div>
          {cart.length > 0 && (
            <Button variant="ghost" size="sm" className="text-xs text-rose-600" onClick={() => setCart([])}>
              <Trash2 className="size-3.5" /> إفراغ
            </Button>
          )}
        </div>

        {/* تحذيرات التداخلات */}
        {warnings.length > 0 && (
          <div className="mx-3 mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
            <p className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400">
              <TriangleAlert className="size-4" />
              تداخلات دوائية محتملة ({warnings.length})
            </p>
            <ul className="mt-1.5 space-y-1">
              {warnings.map((w, i) => (
                <li key={i} className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                  <span className="font-bold">
                    {w.genericA} + {w.genericB}
                  </span>{" "}
                  ({w.severity === "major" ? "خطير" : w.severity === "moderate" ? "متوسط" : "بسيط"}):{" "}
                  {w.description}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="min-h-24 flex-1 overflow-y-auto p-3">
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center text-muted-foreground">
              <ScanBarcode className="size-10 opacity-30" />
              <p className="text-sm">اضغط على دواء لإضافته للسلة</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cart.map((l) => (
                <div key={l.medicine.id} className="rounded-lg border bg-background/60 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{l.medicine.name}</p>
                      <p className="num text-[11px] text-muted-foreground">
                        {fmtMoney(l.medicine.sellingPrice)} ر.س / وحدة
                        {l.medicine.requiresPrescription && (
                          <Badge variant="outline" className="ms-1.5 h-4 px-1 text-[9px]">
                            وصفة
                          </Badge>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => setCart((p) => p.filter((x) => x.medicine.id !== l.medicine.id))}
                      className="rounded p-1 text-muted-foreground transition hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-7"
                        onClick={() => setQty(l.medicine.id, l.quantity - 1)}
                      >
                        <Minus className="size-3" />
                      </Button>
                      <span className="num w-10 text-center text-sm font-bold">{l.quantity}</span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-7"
                        onClick={() => setQty(l.medicine.id, l.quantity + 1)}
                      >
                        <Plus className="size-3" />
                      </Button>
                    </div>
                    <span className="num text-sm font-extrabold text-teal-700 dark:text-teal-400">
                      {fmtMoney(l.medicine.sellingPrice * l.quantity)} ر.س
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* الملخص والدفع */}
        <div className="space-y-3 border-t p-4">
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="اسم العميل (اختياري)"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="h-9"
            />
            <Input
              placeholder="هاتف العميل"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              className="h-9"
              dir="ltr"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="mb-1 text-xs text-muted-foreground">طريقة الدفع</Label>
              <Select value={payment} onValueChange={setPayment}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">
                    <span className="flex items-center gap-1.5">
                      <Banknote className="size-4" /> نقدي
                    </span>
                  </SelectItem>
                  <SelectItem value="card">
                    <span className="flex items-center gap-1.5">
                      <CreditCard className="size-4" /> بطاقة
                    </span>
                  </SelectItem>
                  <SelectItem value="insurance">
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="size-4" /> تأمين
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 text-xs text-muted-foreground">الخصم (ر.س)</Label>
              <Input
                type="number"
                min="0"
                step="0.5"
                value={discountSar}
                onChange={(e) => setDiscountSar(e.target.value)}
                placeholder="0.00"
                className="h-9"
              />
            </div>
          </div>

          <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>الإجمالي</span>
              <span className="num font-medium">{fmtMoney(totals.total)} ر.س</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>الخصم</span>
              <span className="num font-medium">-{fmtMoney(totals.discount)} ر.س</span>
            </div>
            <div className="flex justify-between border-t pt-1.5 text-base font-extrabold">
              <span>الصافي</span>
              <span className="num text-teal-700 dark:text-teal-400">
                {fmtMoney(totals.net)} ر.س
              </span>
            </div>
          </div>

          <Button
            onClick={checkout}
            disabled={checking || cart.length === 0}
            className="h-11 w-full bg-teal-600 text-base font-bold hover:bg-teal-700"
          >
            {checking ? <Loader2 className="size-5 animate-spin" /> : `إتمام البيع · ${fmtMoney(totals.net)} ر.س`}
          </Button>
        </div>
      </div>

      {/* نافذة النجاح */}
      <Dialog open={!!result} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-teal-700 dark:text-teal-400">
              <CheckCircle2 className="size-6" />
              {result?.duplicated ? "عملية مكررة" : "تم البيع بنجاح"}
            </DialogTitle>
            <DialogDescription>
              {result?.duplicated
                ? "هذه العملية كانت مسجلة مسبقاً — لم يُخصم المخزون مرتين"
                : `تم تسجيل الفاتورة وخصم الكميات من المخزون`}
            </DialogDescription>
          </DialogHeader>
          {result && (
            <div className="space-y-2 rounded-xl border bg-muted/40 p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">رقم المرجع</span>
                <span className="num font-bold" dir="ltr">{result.reference}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">المبلغ الصافي</span>
                <span className="num font-extrabold text-teal-700 dark:text-teal-400">
                  {fmtMoney(result.netAmount)} ر.س
                </span>
              </div>
              {(result.interactionWarnings?.length ?? 0) > 0 && (
                <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                  ⚠ رُصدت {result.interactionWarnings!.length} تداخلات دوائية في هذه الفاتورة — راجع سجلها في الإشعارات
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setResult(null)} className="w-full bg-teal-600 hover:bg-teal-700">
              عملية جديدة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
