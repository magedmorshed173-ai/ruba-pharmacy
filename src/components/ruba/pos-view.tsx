"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, fmtMoney } from "@/lib/api-client";
import type {
  AuthUser,
  Medicine,
  InteractionHit,
  ClinicalReview,
  Patient,
} from "@/lib/types";
import type { AlternativeSuggestion } from "@/lib/alternatives";
import { StockBadge, ExpiryBadge } from "./shared";
import { BarcodeScanner } from "./barcode-scanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QRCodeSVG } from "qrcode.react"; // v4.5 — رمز الفاتورة الضريبية ZATCA
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
  Printer,
  ShieldAlert,
  UserRound,
  Repeat2,
  Baby,
  Cake,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CartLine {
  medicine: Medicine;
  quantity: number;
}

interface SaleFullItem {
  medicineName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

interface SaleFull {
  reference: string;
  saleDate: string;
  customerName: string;
  itemsCount: number;
  totalAmount: number;
  discount: number;
  netAmount: number;
  paymentMethod: string;
  // ── v4.5 — ZATCA ──
  vatRate: number;
  vatTotal: number;
  netOfVat: number;
  invoiceNumber: string | null;
  zatcaQr: string | null;
  items: SaleFullItem[];
  user?: { username: string; fullName: string };
}

interface CheckoutResult {
  saleId: string;
  reference: string;
  netAmount: number;
  duplicated?: boolean;
  interactionWarnings?: InteractionHit[];
  clinicalReview?: ClinicalReview;
  clinicalOverride?: boolean;
  sale?: SaleFull;
}

/** أنماط شارات الشدة السريرية */
const SEV_STYLE: Record<string, string> = {
  contraindicated:
    "border-rose-400 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-400",
  major:
    "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400",
  moderate:
    "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-400",
  minor:
    "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-500/40 dark:bg-slate-500/10 dark:text-slate-400",
};

const SEV_TEXT: Record<string, string> = {
  contraindicated: "ممنوع سريرياً",
  major: "خطير",
  moderate: "متوسط",
  minor: "بسيط",
};

function hasFindings(r: ClinicalReview): boolean {
  return (
    r.interactions.length > 0 ||
    r.allergyAlerts.length > 0 ||
    r.duplicateTherapies.length > 0 ||
    (r.pregnancyAlerts?.length ?? 0) > 0 ||
    (r.ageAlerts?.length ?? 0) > 0
  );
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
  const [review, setReview] = useState<ClinicalReview | null>(null);
  const [blocked, setBlocked] = useState<ClinicalReview | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientId, setPatientId] = useState("none");
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // البدائل العلاجية عند النفاد — v4.3
  const [altTarget, setAltTarget] = useState<Medicine | null>(null);
  const [altList, setAltList] = useState<AlternativeSuggestion[] | null>(null);
  const [altLoading, setAltLoading] = useState(false);

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
      const r = await api<ClinicalReview>("/api/interactions/check", {
        method: "POST",
        json: {
          medicineIds: cart.map((l) => l.medicine.id),
          patientId: patientId !== "none" ? patientId : undefined,
        },
      });
      setReview(r);
    } catch {
      /* الفحص تحذيري — لا يعطل السلة */
    }
  }

  useEffect(() => {
    api<{ patients?: Patient[]; results?: Patient[] }>("/api/patients")
      .then((r) => setPatients(r.patients ?? r.results ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (cart.length >= 1) checkInteractions();
    else setReview(null);
  }, [cart.map((l) => l.medicine.id).join(","), patientId]);

  async function checkout(clinicalOverride = false) {
    if (cart.length === 0) {
      toast.error("السلة فارغة");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("أنت دون اتصال — أعد المحاولة عند عودة الشبكة");
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
          patientId: patientId !== "none" ? patientId : undefined,
          ...(clinicalOverride ? { clinicalOverride: true } : {}),
        },
      });
      setResult(r);
      setCart([]);
      setDiscountSar("");
      setCustomerName("");
      setCustomerPhone("");
      setReview(null);
      setBlocked(null);
      toast.success(r.duplicated ? "عملية مكررة — تم استرجاع الفاتورة الأصلية" : "تم البيع بنجاح");
      loadMeds(q);
      onDone?.();
    } catch (e) {
      const err = e as Error & {
        status?: number;
        payload?: { clinicalBlock?: boolean; clinicalReview?: ClinicalReview };
      };
      if (err.payload?.clinicalBlock) {
        setBlocked(err.payload.clinicalReview ?? null);
        if (err.status === 403)
          toast.error("حجب سريري — إتمام هذه العملية يتطلب صيدلياً");
        else toast.error("تعارض سريري خطر — يتطلب تأكيد التجاوز المسؤول");
      } else {
        toast.error(e instanceof Error ? e.message : "فشل إتمام البيع");
      }
    } finally {
      setChecking(false);
    }
  }

  /** مسح باركود بالكاميرا (v3.4): بحث مطابقة تامة وإضافة للسلة */
  async function handleScan(code: string) {
    try {
      const r = await api<{ results: Medicine[] }>(
        `/api/medicines?pageSize=5&q=${encodeURIComponent(code)}`
      );
      const exact = r.results.find((m) => m.barcode === code);
      if (exact) {
        addToCart(exact);
        toast.success(`أُضيف: ${exact.name}`);
      } else {
        toast.warning(`لا يوجد دواء بالباركود ${code}`);
        setQ(code);
      }
    } catch {
      toast.error("تعذر البحث عن الباركود");
    }
  }

  /** بدائل علاجية عند النفاد (v4.3): نفس الفئة العلاجية المتوفرة فعلاً */
  async function openAlternatives(m: Medicine) {
    setAltTarget(m);
    setAltList(null);
    setAltLoading(true);
    try {
      const r = await api<{ alternatives: AlternativeSuggestion[] }>(
        `/api/medicines/${m.id}/alternatives`
      );
      setAltList(r.alternatives);
    } catch {
      toast.error("تعذر جلب البدائل العلاجية");
      setAltTarget(null);
    } finally {
      setAltLoading(false);
    }
  }

  /** إضافة بديل للسلة — الكمية المتاحة معروضة أصلاً بعد خصم المحجوز */
  function addAlternative(a: AlternativeSuggestion) {
    const med: Medicine = {
      id: a.id,
      name: a.name,
      genericName: a.genericName,
      categoryId: "",
      category: { id: "", name: "" },
      barcode: "",
      purchasePrice: 0,
      sellingPrice: a.sellingPrice,
      quantity: a.availableQuantity,
      minQuantity: 0,
      expiryDate: "",
      requiresPrescription: a.requiresPrescription,
      isActive: true,
    };
    addToCart(med);
    toast.success(`أُضيف البديل: ${a.name}`);
    setAltTarget(null);
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
            className="h-11 ps-9 pe-10 text-base"
            autoFocus
          />
          <BarcodeScanner onScan={handleScan} />
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
                  onClick={() => (out ? openAlternatives(m) : addToCart(m))}
                  className={cn(
                    "group relative flex flex-col rounded-xl border bg-card p-3 text-start shadow-sm transition-all hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md",
                    out && "opacity-55 hover:translate-y-0 hover:border-amber-300",
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
                  {out && (
                    <div className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                      <Repeat2 className="size-3" /> انقر لعرض البدائل العلاجية
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

        {/* اللوحة السريرية — تداخلات + حساسية + علاج مكرر */}
        {review && hasFindings(review) && (
          <div className="mx-3 mt-3 space-y-2">
            {review.allergyAlerts.length > 0 && (
              <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 dark:border-rose-500/40 dark:bg-rose-500/10">
                <p className="flex items-center gap-1.5 text-xs font-bold text-rose-700 dark:text-rose-400">
                  <ShieldAlert className="size-4" />
                  تعارض حساسية ({review.allergyAlerts.length}) — حاجب
                </p>
                <ul className="mt-1.5 space-y-1.5">
                  {review.allergyAlerts.map((a, i) => (
                    <li key={i} className="text-[11px] leading-relaxed text-rose-800 dark:text-rose-300">
                      <span className="font-bold">{a.medicine}</span> — حساسية المريض: «{a.allergy}» ({a.familyAr})
                      <span className="block opacity-80">{a.note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(review.pregnancyAlerts?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-fuchsia-300 bg-fuchsia-50 p-3 dark:border-fuchsia-500/40 dark:bg-fuchsia-500/10">
                <p className="flex items-center gap-1.5 text-xs font-bold text-fuchsia-700 dark:text-fuchsia-400">
                  <Baby className="size-4" />
                  بوابة الحمل ({review.pregnancyAlerts!.length})
                </p>
                <ul className="mt-1.5 space-y-1.5">
                  {review.pregnancyAlerts!.map((a, i) => (
                    <li key={i} className="text-[11px] leading-relaxed text-fuchsia-800 dark:text-fuchsia-300">
                      <span className="font-bold">{a.medicine}</span> — {a.message}
                      <span className="block opacity-80">{a.note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(review.ageAlerts?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
                <p className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                  <Cake className="size-4" />
                  بوابة العمر ({review.ageAlerts!.length})
                </p>
                <ul className="mt-1.5 space-y-1.5">
                  {review.ageAlerts!.map((a, i) => (
                    <li key={i} className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                      <span className="font-bold">{a.medicine}</span> — {a.message}
                      <span className="block opacity-80">{a.note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {review.interactions
              .slice()
              .sort((x, y) => (x.severity === "contraindicated" ? -1 : y.severity === "contraindicated" ? 1 : 0))
              .map((w, i) => (
                <div
                  key={i}
                  className={`rounded-lg border p-3 ${SEV_STYLE[w.severity]}`}
                >
                  <p className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
                    <TriangleAlert className="size-4" />
                    {w.genericA} + {w.genericB}
                    <span className="rounded-full border border-current px-2 py-0.5 text-[10px]">
                      {SEV_TEXT[w.severity]}
                    </span>
                    {w.context === "patient" && (
                      <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px]">
                        دواء مزمن للمريض
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed">{w.description}</p>
                  {w.mechanism && (
                    <p className="mt-1 text-[11px] leading-relaxed opacity-90">
                      <span className="font-bold">الآلية:</span> {w.mechanism}
                    </p>
                  )}
                  {w.clinicalEffect && (
                    <p className="text-[11px] leading-relaxed opacity-90">
                      <span className="font-bold">الأثر المحتمل:</span> {w.clinicalEffect}
                    </p>
                  )}
                  {w.management && (
                    <p className="mt-1 rounded bg-black/5 p-1.5 text-[11px] leading-relaxed dark:bg-white/5">
                      <span className="font-bold">الإدارة:</span> {w.management}
                    </p>
                  )}
                  {(w.evidenceLevel || w.source) && (
                    <p className="num mt-1 text-[10px] opacity-70" dir="auto">
                      {w.evidenceLevel === "documented" ? "موثق سريرياً" : w.evidenceLevel === "probable" ? "مرجّح" : w.evidenceLevel === "theoretical" ? "نظري" : ""}
                      {w.source ? ` — المصدر: ${w.source}` : ""}
                      {w.onset === "rapid" ? " — بدء فوري" : w.onset === "delayed" ? " — بدء متأخر" : ""}
                    </p>
                  )}
                </div>
              ))}

            {review.duplicateTherapies.map((d, i) => (
              <div
                key={i}
                className="rounded-lg border border-sky-300 bg-sky-50 p-3 dark:border-sky-500/40 dark:bg-sky-500/10"
              >
                <p className="text-xs font-bold text-sky-700 dark:text-sky-400">
                  علاج مكرر — نفس الفئة العلاجية
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-sky-800 dark:text-sky-300">
                  {d.names.join(" + ")} — روجعت الفائدة العلاجية من الجمع؟
                  <span className="num block opacity-75">{d.atcClass}</span>
                </p>
              </div>
            ))}
          </div>
        )}

        {/* بوابة الحجب السريري */}
        {blocked && (
          <div className="mx-3 mt-3 rounded-lg border-2 border-rose-400 bg-rose-50 p-3 dark:border-rose-500/50 dark:bg-rose-500/10">
            <p className="flex items-center gap-1.5 text-xs font-bold text-rose-700 dark:text-rose-400">
              <ShieldAlert className="size-4" />
              البيع محجوب — {blocked.pregnancyAlerts?.some((a) => a.severity === "blocking")
                ? "تعارض مع الحمل (فئة X)"
                : blocked.ageAlerts?.some((a) => a.severity === "blocking")
                ? "العمر أقل من الحد المعتمد"
                : blocked.interactions.some((i) => i.severity === "contraindicated")
                ? "ممنوع سريرياً"
                : "تعارض حساسية"}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-rose-800 dark:text-rose-300">
              {user.role === "technician"
                ? "إتمام هذه العملية يتطلب حضور صيدلي — أدرجها للحجز وانتظر المراجعة."
                : "بصفتك صيدلياً يمكنك التجاوز المسؤول — يُسجل في الفاتورة للتدقيق."}
            </p>
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
          <div>
            <Label className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
              <UserRound className="size-3.5" />
              مريض مسجل — يفعّل فحص الحساسية والأدوية المزمنة
            </Label>
            <Select value={patientId} onValueChange={setPatientId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="عميل نقدي — بلا ملف" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">عميل نقدي — بلا ملف</SelectItem>
                {patients.map((pt) => (
                  <SelectItem key={pt.id} value={pt.id}>
                    {pt.name}
                    {pt.allergies ? ` — حساسية: ${pt.allergies}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
            onClick={() => checkout(!!blocked)}
            disabled={checking || cart.length === 0 || (!!blocked && user.role === "technician")}
            className={
              blocked && user.role !== "technician"
                ? "h-11 w-full bg-rose-600 text-base font-bold hover:bg-rose-700"
                : "h-11 w-full bg-teal-600 text-base font-bold hover:bg-teal-700"
            }
          >
            {checking ? (
              <Loader2 className="size-5 animate-spin" />
            ) : blocked && user.role !== "technician" ? (
              `تجاوز سريري مسؤول وإتمام البيع · ${fmtMoney(totals.net)} ر.س`
            ) : (
              `إتمام البيع · ${fmtMoney(totals.net)} ر.س`
            )}
          </Button>
        </div>
      </div>

      {/* نافذة النجاح */}
      <Dialog open={!!result} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent className="sm:max-w-md print-receipt" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-teal-700 dark:text-teal-400">
              <CheckCircle2 className="size-6" />
              {result?.duplicated ? "عملية مكررة" : "تم البيع بنجاح"}
            </DialogTitle>
            <DialogDescription>
              {result?.duplicated
                ? "هذه العملية كانت مسجلة مسبقاً — لم يُخصم المخزون مرتين"
                : `تم تسجيل الفاتورة وخصم الكميات من المخزون (FEFO)`}
            </DialogDescription>
          </DialogHeader>
          {result && (
            <div className="space-y-3 rounded-xl border bg-muted/40 p-4 text-sm">
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
              {result.clinicalOverride && (
                <p className="rounded-lg bg-rose-50 p-2 text-xs font-bold text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">
                  🛡 أُتممت بتجاوز سريري مسؤول — مسجلة في الفاتورة للتدقيق
                </p>
              )}

              {/* فاتورة قابلة للطباعة */}
              {result.sale && (
                <div className="rounded-lg border-t border-dashed pt-3 text-xs">
                  <p className="mb-1 text-center text-sm font-extrabold">ربي فارمسي</p>
                  {result.sale.invoiceNumber && (
                    <p className="num mb-1 text-center font-bold text-teal-700 dark:text-teal-400" dir="ltr">
                      {result.sale.invoiceNumber}
                    </p>
                  )}
                  <p className="mb-2 text-center text-muted-foreground">
                    {new Date(result.sale.saleDate).toLocaleString("ar-SA")} — البائع: {result.sale.user?.fullName ?? "—"}
                  </p>
                  <table className="w-full">
                    <tbody>
                      {result.sale.items.map((it, i) => (
                        <tr key={i} className="border-b border-dashed">
                          <td className="py-1 font-medium">{it.medicineName}</td>
                          <td className="num py-1 text-center">×{it.quantity}</td>
                          <td className="num py-1 text-end">{fmtMoney(it.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-2 space-y-1">
                    <div className="flex justify-between text-muted-foreground">
                      <span>الإجمالي</span>
                      <span className="num">{fmtMoney(result.sale.totalAmount)} ر.س</span>
                    </div>
                    {result.sale.discount > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>الخصم</span>
                        <span className="num">−{fmtMoney(result.sale.discount)} ر.س</span>
                      </div>
                    )}
                    <div className="flex justify-between text-muted-foreground">
                      <span>الصافي قبل الضريبة</span>
                      <span className="num">{fmtMoney(result.sale.netOfVat)} ر.س</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>ضريبة القيمة المضافة ({result.sale.vatRate}%) — ضمن الإجمالي</span>
                      <span className="num">{fmtMoney(result.sale.vatTotal)} ر.س</span>
                    </div>
                    <div className="flex justify-between text-base font-extrabold">
                      <span>الإجمالي المدفوع ({result.sale.paymentMethod === "cash" ? "نقدي" : result.sale.paymentMethod === "card" ? "شبكة" : "تأمين"})</span>
                      <span className="num">{fmtMoney(result.sale.netAmount)} ر.س</span>
                    </div>
                  </div>
                  {result.sale.zatcaQr && (
                    <div className="mt-3 flex flex-col items-center gap-1">
                      <QRCodeSVG value={result.sale.zatcaQr} size={96} level="M" />
                      <p className="text-[10px] text-muted-foreground">الفاتورة الضريبية المبسطة — ZATCA</p>
                    </div>
                  )}
                  <p className="mt-2 text-center text-[10px] text-muted-foreground">شكراً لثقتكم — نتمنى لكم دوام الصحة والعافية</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => window.print()}
            >
              <Printer className="size-4" /> طباعة الفاتورة
            </Button>
            <Button onClick={() => setResult(null)} className="flex-1 bg-teal-600 hover:bg-teal-700">
              عملية جديدة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* نافذة البدائل العلاجية عند النفاد — v4.3 */}
      <Dialog open={!!altTarget} onOpenChange={(o) => !o && setAltTarget(null)}>
        <DialogContent className="sm:max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Repeat2 className="size-5 text-amber-600" />
              «{altTarget?.name}» غير متوفر — بدائل علاجية
            </DialogTitle>
            <DialogDescription>
              من نفس الفئة العلاجية (ATC) والمتوفر فعلاً بالرصيد الصالح — الجنيس المكافئ أولاً
            </DialogDescription>
          </DialogHeader>
          {altLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-6 animate-spin text-amber-600" />
            </div>
          ) : !altList || altList.length === 0 ? (
            <p className="rounded-lg border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
              لا يوجد بديل متوفر من نفس الفئة العلاجية حالياً — راجع تبويب إعادة الطلب الذكية
            </p>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto pe-1">
              {altList!.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-sm font-bold">
                      {a.name}
                      {a.sameGeneric && (
                        <Badge className="h-4 bg-emerald-100 px-1.5 text-[9px] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                          نفس المادة الفعالة
                        </Badge>
                      )}
                      {a.requiresPrescription && (
                        <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
                          وصفة
                        </Badge>
                      )}
                    </p>
                    <p className="num mt-0.5 text-[11px] text-muted-foreground">
                      {a.genericName}
                      {a.dosage ? ` · ${a.dosage}` : ""} · متاح {a.availableQuantity}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="num text-sm font-extrabold text-teal-700 dark:text-teal-400">
                      {fmtMoney(a.sellingPrice)} ر.س
                    </span>
                    <span
                      className={cn(
                        "num text-[10px] font-bold",
                        a.priceDiff < 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : a.priceDiff > 0
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground"
                      )}
                    >
                      {a.priceDiff === 0
                        ? "نفس السعر"
                        : `${a.priceDiff < 0 ? "أرخص" : "أغلى"} بـ ${fmtMoney(Math.abs(a.priceDiff))}`}
                    </span>
                    <Button
                      size="sm"
                      className="h-7 bg-teal-600 text-xs hover:bg-teal-700"
                      onClick={() => addAlternative(a)}
                    >
                      <Plus className="size-3" /> استبدال
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
