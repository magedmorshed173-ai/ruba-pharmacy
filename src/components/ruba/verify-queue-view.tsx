"use client";

// ─────────────── طابور التحقق الصيدلي (v3.6) ───────────────
// المعيار الغربي Fill → Verify → Dispense: الفني يُدخل الوصفة،
// والصيدلي يتحقق بمطابقة باركود لكل بند قبل الصرف عبر محرك البيع الذري.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, fmtDate } from "@/lib/api-client";
import type { AuthUser } from "@/lib/types";
import type { ClinicalReview } from "@/lib/clinical-review";
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
import { toast } from "sonner";
import { BarcodeScanner } from "./barcode-scanner";
import {
  AlertTriangle,
  Baby,
  Ban,
  Cake,
  CheckCircle2,
  ClipboardCheck,
  Landmark,
  Loader2,
  Plus,
  ShieldAlert,
  ScanLine,
  Stethoscope,
  XCircle,
} from "lucide-react";

// ─────────────── الأنواع ───────────────

interface RxItem {
  id: string;
  medicineId: string;
  medicineName: string;
  quantity: number;
  instructions?: string | null;
  verified: boolean;
  medicine: { barcode: string; genericName: string; quantity: number; atcClass?: string | null };
}

interface Prescription {
  id: string;
  number: number;
  status: "pending" | "verified" | "rejected" | "dispensed";
  patientName?: string | null;
  doctorName?: string | null;
  notes?: string | null;
  rejectReason?: string | null;
  clinicalOverride: boolean;
  creatorName?: string | null;
  verifierName?: string | null;
  verifiedAt?: string | null;
  saleId?: string | null;
  createdAt: string;
  items: RxItem[];
}

interface PatientLite {
  id: string;
  name: string;
  nationalId: string;
}

interface MedicineLite {
  id: string;
  name: string;
  genericName: string;
  quantity: number;
  sellingPrice: number;
  requiresPrescription: boolean;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: {
    label: "بانتظار التحقق",
    cls: "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400",
  },
  verified: {
    label: "محققة — بانتظار الصرف",
    cls: "border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-400",
  },
  rejected: {
    label: "مرفوضة",
    cls: "border-rose-400 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-400",
  },
  dispensed: {
    label: "مصروفة",
    cls: "border-teal-400 bg-teal-50 text-teal-700 dark:border-teal-500/40 dark:bg-teal-500/10 dark:text-teal-400",
  },
};

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

function ClinicalReviewCard({ review }: { review: ClinicalReview }) {
  const clean =
    review.interactions.length === 0 &&
    review.allergyAlerts.length === 0 &&
    review.duplicateTherapies.length === 0 &&
    (review.registryAlerts?.length ?? 0) === 0 &&
    (review.pregnancyAlerts?.length ?? 0) === 0 &&
    (review.ageAlerts?.length ?? 0) === 0;
  return (
    <div className="rounded-xl border p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-bold">
        <Stethoscope className="size-4 text-teal-600" />
        المراجعة السريرية الحية
        {review.registryBlocking ? (
          <Badge className="border-rose-500 bg-rose-600 text-white">
            <Landmark className="size-3" /> حجب تنظيمي — بلا تجاوز
          </Badge>
        ) : review.blocking ? (
          <Badge className="border-rose-400 bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">
            <ShieldAlert className="size-3" /> حاجبة
          </Badge>
        ) : clean ? (
          <Badge className="border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
            <CheckCircle2 className="size-3" /> لا ملاحظات
          </Badge>
        ) : (
          <Badge variant="outline" className="text-amber-600 border-amber-300">
            <AlertTriangle className="size-3" /> تحذيرات
          </Badge>
        )}
      </div>
      {review.interactions.map((h, i) => (
        <div key={`i${i}`} className="rounded-lg border p-2 text-[13px] space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={SEV_STYLE[h.severity]}>
              {SEV_TEXT[h.severity]}
            </Badge>
            <span className="font-bold">
              {h.genericA} × {h.genericB}
            </span>
            <span className="text-muted-foreground">
              {h.context === "patient" ? "(مع دواء مزمن للمريض)" : "(داخل الوصفة)"}
            </span>
          </div>
          <p>{h.description}</p>
          {h.mechanism && (
            <p className="text-muted-foreground">الآلية: {h.mechanism}</p>
          )}
          {h.management && (
            <p className="text-teal-700 dark:text-teal-400">الإدارة: {h.management}</p>
          )}
        </div>
      ))}
      {review.allergyAlerts.map((a, i) => (
        <div
          key={`a${i}`}
          className="rounded-lg border border-rose-300 bg-rose-50 dark:bg-rose-500/10 p-2 text-[13px] font-medium text-rose-700 dark:text-rose-400"
        >
          تعارض حساسية: المريض لديه حساسية «{a.allergy}» والبند يحويها
        </div>
      ))}
      {(review.pregnancyAlerts ?? []).map((a, i) => (
        <div
          key={`p${i}`}
          className={
            a.severity === "blocking"
              ? "rounded-lg border border-rose-400 bg-rose-600/10 p-2 text-[13px] font-bold text-rose-700 dark:text-rose-400"
              : "rounded-lg border border-fuchsia-300 bg-fuchsia-50 dark:bg-fuchsia-500/10 p-2 text-[13px] text-fuchsia-700 dark:text-fuchsia-400"
          }
        >
          <span className="inline-flex items-center gap-1">
            <Baby className="size-3" /> بوابة الحمل:
          </span>{" "}
          {a.message}
        </div>
      ))}
      {(review.ageAlerts ?? []).map((a, i) => (
        <div
          key={`age${i}`}
          className="rounded-lg border border-rose-400 bg-rose-600/10 p-2 text-[13px] font-bold text-rose-700 dark:text-rose-400"
        >
          <span className="inline-flex items-center gap-1">
            <Cake className="size-3" /> بوابة العمر:
          </span>{" "}
          {a.message}
        </div>
      ))}
      {review.duplicateTherapies.map((d, i) => (
        <div
          key={`d${i}`}
          className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-500/10 p-2 text-[13px] text-amber-700 dark:text-amber-400"
        >
          تكرار علاجي ({d.atcClass}): {d.names.join("، ")}
        </div>
      ))}
      {(review.registryAlerts ?? []).map((a, i) => (
        <div
          key={`r${i}`}
          className={
            a.blocking
              ? "rounded-lg border border-rose-400 bg-rose-600/10 p-2 text-[13px] font-bold text-rose-700 dark:text-rose-400"
              : "rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-500/10 p-2 text-[13px] text-amber-700 dark:text-amber-400"
          }
        >
          <span className="inline-flex items-center gap-1">
            <Landmark className="size-3" /> السجل الوطني:
          </span>{" "}
          {a.message}
        </div>
      ))}
    </div>
  );
}

// ─────────────── العرض الرئيسي ───────────────

type FilterKey = "pending" | "verified" | "rejected" | "dispensed";

export function VerifyQueueView({ user }: { user: AuthUser }) {
  const [filter, setFilter] = useState<FilterKey>("pending");
  const [list, setList] = useState<Prescription[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Prescription | null>(null);
  const [review, setReview] = useState<ClinicalReview | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [scans, setScans] = useState<Record<string, string>>({}); // medicineId → barcode
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const canDecide = user.role !== "technician";

  const load = useCallback(async () => {
    setList(null);
    try {
      const r = await api<{ prescriptions: Prescription[]; counts: Record<string, number> }>(
        `/api/prescriptions?status=${filter}&pageSize=50`
      );
      setList(r.prescriptions);
      setCounts(r.counts);
    } catch {
      toast.error("تعذر جلب طابور التحقق");
      setList([]);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function openDetail(rx: Prescription) {
    setSelected(rx);
    setReview(null);
    setScans({});
    setRejectReason("");
    setDetailLoading(true);
    try {
      const r = await api<{ prescription: Prescription; clinicalReview: ClinicalReview }>(
        `/api/prescriptions/${rx.id}`
      );
      setSelected(r.prescription);
      setReview(r.clinicalReview);
    } catch {
      toast.error("تعذر جلب تفاصيل الوصفة");
    } finally {
      setDetailLoading(false);
    }
  }

  async function submitVerify() {
    if (!selected) return;
    const pendingItems = selected.items.filter((i) => !i.verified);
    const payloadScans = pendingItems
      .map((i) => ({ medicineId: i.medicineId, barcode: scans[i.medicineId] }))
      .filter((s) => s.barcode);
    if (payloadScans.length === 0) {
      toast.error("امسح باركود عبوة واحدة على الأقل");
      return;
    }
    const hasBlocking = review?.blocking;
    if (hasBlocking && !window.confirm("توجد ملاحظات سريرية حاجبة — تأكيد التجاوز المسؤول؟")) {
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ prescription: Prescription; remaining: number; message: string }>(
        `/api/prescriptions/${selected.id}/verify`,
        { method: "POST", json: { scans: payloadScans, clinicalOverride: hasBlocking } }
      );
      toast.success(r.message);
      setSelected(r.prescription);
      setScans({});
      await load();
      if (r.remaining === 0) {
        const d = await api<{ prescription: Prescription; clinicalReview: ClinicalReview }>(
          `/api/prescriptions/${selected.id}`
        );
        setSelected(d.prescription);
        setReview(d.clinicalReview);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitReject() {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await api<{ prescription: Prescription; message: string }>(
        `/api/prescriptions/${selected.id}/reject`,
        { method: "POST", json: { reason: rejectReason } }
      );
      toast.success(r.message);
      setSelected(r.prescription);
      setRejectReason("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function dispense() {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await api<{ message: string }>(`/api/prescriptions/${selected.id}/dispense`, {
        method: "POST",
        json: { paymentMethod: "cash" },
      });
      toast.success(r.message);
      await openDetail(selected);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const scanProgress = useMemo(() => {
    if (!selected) return { done: 0, total: 0 };
    const total = selected.items.length;
    const done = selected.items.filter((i) => i.verified).length;
    return { done, total };
  }, [selected]);

  return (
    <div className="space-y-4">
      {/* عدّادات + مرشحات */}
      <div className="flex flex-wrap items-center gap-2">
        {(["pending", "verified", "rejected", "dispensed"] as FilterKey[]).map((k) => (
          <Button
            key={k}
            variant={filter === k ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(k)}
            className="gap-2"
          >
            {STATUS_META[k].label}
            <span className="rounded-full bg-black/10 px-1.5 text-[11px] font-bold dark:bg-white/15">
              {counts[k] ?? 0}
            </span>
          </Button>
        ))}
        <div className="ms-auto">
          <Button size="sm" onClick={() => setNewOpen(true)} className="gap-2">
            <Plus className="size-4" /> إدخال وصفة
          </Button>
        </div>
      </div>

      {/* القائمة */}
      {!list ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          <ClipboardCheck className="mx-auto mb-3 size-10 opacity-40" />
          لا توجد وصفات في هذه الحالة
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((rx) => {
            const meta = STATUS_META[rx.status];
            const verifiedCount = rx.items.filter((i) => i.verified).length;
            return (
              <button
                key={rx.id}
                onClick={() => openDetail(rx)}
                className="block w-full rounded-xl border bg-card p-4 text-start shadow-sm transition hover:border-teal-300 hover:shadow-md"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-teal-50 px-2 py-0.5 font-mono text-[12px] font-bold text-teal-700 dark:bg-teal-500/10 dark:text-teal-400">
                    RX-{rx.number}
                  </span>
                  <span className="font-bold">{rx.patientName ?? "مريض"}</span>
                  <Badge variant="outline" className={meta.cls}>
                    {meta.label}
                  </Badge>
                  {rx.clinicalOverride && (
                    <Badge
                      variant="outline"
                      className="border-rose-300 text-rose-600 dark:text-rose-400"
                    >
                      <ShieldAlert className="size-3" /> تجاوز مسؤول
                    </Badge>
                  )}
                  <span className="ms-auto text-[12px] text-muted-foreground">
                    {fmtDate(rx.createdAt, true)}
                  </span>
                </div>
                <div className="mt-2 text-[13px] text-muted-foreground">
                  {rx.items.map((i) => `${i.medicineName} ×${i.quantity}`).join(" · ")}
                </div>
                <div className="mt-1 text-[12px] text-muted-foreground">
                  {rx.doctorName ? `الطبيب: ${rx.doctorName} · ` : ""}
                  أدخلها: {rx.creatorName ?? "—"}
                  {rx.status === "pending" && verifiedCount > 0 && (
                    <> · تحقق {verifiedCount}/{rx.items.length} بنوداً</>
                  )}
                  {rx.status === "rejected" && rx.rejectReason && (
                    <> · السبب: {rx.rejectReason}</>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* لوحة التحقق */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">RX-{selected.number}</span>
                  <Badge variant="outline" className={STATUS_META[selected.status].cls}>
                    {STATUS_META[selected.status].label}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  {selected.patientName} · {selected.doctorName ?? "بلا طبيب مسجل"} · أدخلها{" "}
                  {selected.creatorName} في {fmtDate(selected.createdAt, true)}
                  {selected.verifierName && <> · تحقق منها {selected.verifierName}</>}
                </DialogDescription>
              </DialogHeader>

              {detailLoading ? (
                <Skeleton className="h-40 rounded-xl" />
              ) : (
                <div className="space-y-4">
                  {review && <ClinicalReviewCard review={review} />}

                  {/* البنود + التحقق بالباركود */}
                  <div className="space-y-2">
                    <p className="text-sm font-bold">
                      البنود{" "}
                      {scanProgress.total > 0 && (
                        <span className="text-[12px] font-normal text-muted-foreground">
                          ({scanProgress.done}/{scanProgress.total} بمطابقة باركود)
                        </span>
                      )}
                    </p>
                    {selected.items.map((it) => {
                      const scanned = scans[it.medicineId] ?? "";
                      const shortage = it.quantity > it.medicine.quantity;
                      return (
                        <div key={it.id} className="rounded-lg border p-2.5 space-y-2">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-bold">{it.medicineName}</span>
                            <span className="text-muted-foreground">
                              ({it.medicine.genericName}) ×{it.quantity}
                            </span>
                            {shortage && (
                              <Badge
                                variant="outline"
                                className="border-amber-300 text-amber-600"
                              >
                                المخزون {it.medicine.quantity}
                              </Badge>
                            )}
                            {it.verified ? (
                              <Badge
                                variant="outline"
                                className="border-emerald-400 text-emerald-600 dark:text-emerald-400"
                              >
                                <CheckCircle2 className="size-3" /> باركود مطابق
                              </Badge>
                            ) : null}
                            <span className="ms-auto text-[11px] text-muted-foreground">
                              {it.instructions}
                            </span>
                          </div>
                          {!it.verified && selected.status === "pending" && canDecide && (
                            <div className="flex items-center gap-2">
                              <Input
                                dir="ltr"
                                placeholder="امسح باركود العبوة أو أدخله يدوياً"
                                value={scanned}
                                onChange={(e) =>
                                  setScans((s) => ({ ...s, [it.medicineId]: e.target.value }))
                                }
                                className="h-9 font-mono text-[13px]"
                              />
                              <BarcodeScanner
                                disabled={busy}
                                onScan={(code) =>
                                  setScans((s) => ({ ...s, [it.medicineId]: code }))
                                }
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {selected.status === "rejected" && (
                    <div className="rounded-lg border border-rose-300 bg-rose-50 dark:bg-rose-500/10 p-3 text-[13px] text-rose-700 dark:text-rose-400">
                      <b>سبب الرفض:</b> {selected.rejectReason}
                    </div>
                  )}
                  {selected.status === "dispensed" && (
                    <div className="rounded-lg border border-teal-300 bg-teal-50 dark:bg-teal-500/10 p-3 text-[13px] text-teal-700 dark:text-teal-400">
                      صُرفت كفاتورة مرتبطة بالوصفة — سجلها في المبيعات
                    </div>
                  )}
                </div>
              )}

              {/* أزرار القرار */}
              {selected.status === "pending" && canDecide && (
                <DialogFooter className="gap-2">
                  <Button
                    variant="destructive"
                    onClick={submitReject}
                    disabled={busy || !rejectReason.trim()}
                    className="gap-2"
                    title="اكتب سبب الرفض في الحقل أدناه"
                  >
                    <XCircle className="size-4" /> رفض
                  </Button>
                  <Button variant="outline" onClick={submitVerify} disabled={busy} className="gap-2">
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <ScanLine className="size-4" />}
                    تحقق بالباركود
                  </Button>
                </DialogFooter>
              )}
              {selected.status === "pending" && canDecide && (
                <Input
                  placeholder="سبب الرفض (إلزامي عند الرفض)"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="h-9"
                />
              )}
              {selected.status === "verified" && canDecide && (
                <DialogFooter>
                  <Button onClick={dispense} disabled={busy} className="gap-2">
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-4" />
                    )}
                    صرف الآن — يولّد فاتورة ذرياً
                  </Button>
                </DialogFooter>
              )}
              {selected.status === "pending" && !canDecide && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-500/10 p-3 text-[13px] text-amber-700 dark:text-amber-400 flex items-center gap-2">
                  <Ban className="size-4" /> التحقق والصرف من صلاحيات الصيدلي — دورك يطالع فقط
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <NewRxDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={load}
      />
    </div>
  );
}

// ─────────────── حوار إدخال وصفة جديدة ───────────────

function NewRxDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [patients, setPatients] = useState<PatientLite[] | null>(null);
  const [meds, setMeds] = useState<MedicineLite[] | null>(null);
  const [patientId, setPatientId] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<{ medicineId: string; quantity: string; instructions: string }[]>(
    [{ medicineId: "", quantity: "1", instructions: "" }]
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api<{ patients: PatientLite[] }>("/api/patients")
      .then((r) => setPatients(r.patients))
      .catch(() => setPatients([]));
    api<{ results: MedicineLite[] }>("/api/medicines?pageSize=100")
      .then((r) => setMeds(r.results))
      .catch(() => setMeds([]));
  }, [open]);

  async function submit() {
    const items = rows
      .map((r) => ({
        medicineId: r.medicineId,
        quantity: Number(r.quantity) || 0,
        instructions: r.instructions,
      }))
      .filter((r) => r.medicineId && r.quantity > 0);
    if (!patientId) return toast.error("اختر المريض");
    if (items.length === 0) return toast.error("أضف بنداً واحداً على الأقل");
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/api/prescriptions", {
        method: "POST",
        json: { patientId, doctorName, notes, items },
      });
      toast.success(r.message);
      onCreated();
      onOpenChange(false);
      setRows([{ medicineId: "", quantity: "1", instructions: "" }]);
      setPatientId("");
      setDoctorName("");
      setNotes("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>إدخال وصفة إلى طابور التحقق</DialogTitle>
          <DialogDescription>
            تُسجل الوصفة الورقية هنا، ولا تُصرف إلا بعد تحقق الصيدلي بمطابقة الباركود
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>المريض</Label>
              {!patients ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <select
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">— اختر المريض —</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.nationalId})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>الطبيب الواصف</Label>
              <Input value={doctorName} onChange={(e) => setDoctorName(e.target.value)} placeholder="د. …" />
            </div>
          </div>

          {rows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_80px_1fr] gap-2">
              <select
                value={row.medicineId}
                onChange={(e) =>
                  setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, medicineId: e.target.value } : r)))
                }
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">— الدواء —</option>
                {(meds ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} (متوفر {m.quantity})
                  </option>
                ))}
              </select>
              <Input
                type="number"
                min={1}
                value={row.quantity}
                onChange={(e) =>
                  setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, quantity: e.target.value } : r)))
                }
                className="h-9"
              />
              <Input
                placeholder="إرشادات (اختياري)"
                value={row.instructions}
                onChange={(e) =>
                  setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, instructions: e.target.value } : r)))
                }
                className="h-9"
              />
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRows((rs) => [...rs, { medicineId: "", quantity: "1", instructions: "" }])}
            className="gap-2"
          >
            <Plus className="size-4" /> بند آخر
          </Button>

          <div className="space-y-1.5">
            <Label>ملاحظات</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy} className="gap-2">
            {busy && <Loader2 className="size-4 animate-spin" />} إدخال إلى الطابور
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
