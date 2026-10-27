"use client";

import { useCallback, useEffect, useState } from "react";
import { api, fmtDate, SEVERITY_LABEL } from "@/lib/api-client";
import type { AuthUser, Patient, InteractionHit } from "@/lib/types";
import { ageInYears, PREGNANCY_STATUS_LABEL } from "@/lib/patient-gate";
import { EmptyState, LoadingRows } from "./shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { toast } from "sonner";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  UsersRound,
  ShieldAlert,
  Stethoscope,
} from "lucide-react";

const RANK: Record<string, number> = { technician: 1, pharmacist: 2, admin: 3 };
const EMPTY = {
  name: "",
  nationalId: "",
  phone: "",
  chronicMedications: "",
  allergies: "",
  dateOfBirth: "",
  pregnancyStatus: "none",
};

export function PatientsView({ user }: { user: AuthUser }) {
  const canDelete = (RANK[user.role] ?? 0) >= 2;
  const [q, setQ] = useState("");
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  // فحص التداخلات
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkText, setCheckText] = useState("");
  const [checkResults, setCheckResults] = useState<InteractionHit[] | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ patients: Patient[] }>(`/api/patients?q=${encodeURIComponent(q)}`);
      setPatients(r.patients);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطأ في جلب المرضى");
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY });
    setFormOpen(true);
  }

  function openEdit(p: Patient) {
    setEditing(p);
    setForm({
      name: p.name,
      nationalId: p.nationalId,
      phone: p.phone ?? "",
      chronicMedications: p.chronicMedications ?? "",
      allergies: p.allergies ?? "",
      dateOfBirth: p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : "",
      pregnancyStatus: p.pregnancyStatus ?? "none",
    });
    setFormOpen(true);
  }

  async function save() {
    if (!form.name.trim() || !form.nationalId.trim()) {
      toast.error("الاسم ورقم الهوية مطلوبان");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api(`/api/patients/${editing.id}`, { method: "PUT", json: form });
        toast.success("تم تحديث بيانات المريض");
      } else {
        await api("/api/patients", { method: "POST", json: form });
        toast.success("تمت إضافة المريض");
      }
      setFormOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر الحفظ");
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: Patient) {
    if (!confirm(`تأكيد حذف المريض "${p.name}"؟`)) return;
    try {
      await api(`/api/patients/${p.id}`, { method: "DELETE" });
      toast.success("تم الحذف");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر الحذف");
    }
  }

  async function runCheck() {
    const names = checkText
      .split(/[،,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length < 2) {
      toast.error("أدخل مادتين فعالتين على الأقل مفصولتين بفاصلة");
      return;
    }
    setChecking(true);
    try {
      const r = await api<{ interactions: InteractionHit[] }>("/api/interactions/check", {
        method: "POST",
        json: { patientGenericNames: names, medicineIds: ["__none__"] },
      });
      setCheckResults(r.interactions);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر الفحص");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث بالاسم أو الهوية أو الهاتف…"
            className="ps-9"
          />
        </div>
        <Button variant="outline" onClick={() => { setCheckResults(null); setCheckText(""); setCheckOpen(true); }}>
          <Stethoscope className="size-4" />
          فحص تداخلات
        </Button>
        <Button onClick={openAdd} className="bg-teal-600 hover:bg-teal-700">
          <Plus className="size-4" />
          مريض جديد
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {patients === null ? (
          <LoadingRows rows={6} />
        ) : patients.length === 0 ? (
          <EmptyState
            title={q ? "لا نتائج مطابقة" : "لا مرضى مسجلين بعد"}
            hint="سجّل بيانات المرضى الدائمين لتتبع أدويتهم المزمنة وحساسياتهم"
            action={
              <Button onClick={openAdd} variant="outline" className="mt-2">
                <Plus className="size-4" /> إضافة مريض
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المريض</TableHead>
                <TableHead className="hidden md:table-cell">الهوية</TableHead>
                <TableHead className="hidden sm:table-cell">الهاتف</TableHead>
                <TableHead className="hidden lg:table-cell">ملاحظات طبية</TableHead>
                <TableHead className="hidden text-end md:table-cell">التسجيل</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {patients.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-teal-50 font-bold text-teal-700 dark:bg-teal-500/10 dark:text-teal-400">
                        {p.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-bold">{p.name}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {p.allergies && (
                            <p className="flex items-center gap-1 text-xs text-rose-600">
                              <ShieldAlert className="size-3" /> حساسية: {p.allergies}
                            </p>
                          )}
                          {(() => {
                            const age = ageInYears(p.dateOfBirth);
                            return age !== null ? (
                              <span className="num text-xs text-muted-foreground">{age} سنة</span>
                            ) : null;
                          })()}
                          {p.pregnancyStatus && p.pregnancyStatus !== "none" && (
                            <span className="rounded-full bg-fuchsia-100 px-2 py-0.5 text-[10px] font-bold text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-400">
                              {PREGNANCY_STATUS_LABEL[p.pregnancyStatus]}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="num hidden text-xs md:table-cell" dir="ltr">
                    {p.nationalId}
                  </TableCell>
                  <TableCell className="num hidden text-xs sm:table-cell" dir="ltr">
                    {p.phone || "—"}
                  </TableCell>
                  <TableCell className="hidden max-w-52 truncate text-xs text-muted-foreground lg:table-cell">
                    {p.chronicMedications || "—"}
                  </TableCell>
                  <TableCell className="hidden text-end text-xs text-muted-foreground md:table-cell">
                    {fmtDate(p.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(p)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-rose-600 hover:text-rose-700"
                          onClick={() => remove(p)}
                        >
                          <Trash2 className="size-3.5" />
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

      {/* نافذة إضافة/تعديل */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing ? `تعديل: ${editing.name}` : "إضافة مريض"}</DialogTitle>
            <DialogDescription>الاسم ورقم الهوية إلزاميان</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>الاسم الكامل *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>رقم الهوية *</Label>
              <Input
                value={form.nationalId}
                onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label>الهاتف</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>الأدوية المزمنة</Label>
              <Textarea
                rows={2}
                value={form.chronicMedications}
                onChange={(e) => setForm({ ...form, chronicMedications: e.target.value })}
                placeholder="مثال: وارفارين، ميتفورمين…"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>الحساسيات الدوائية</Label>
              <Textarea
                rows={2}
                value={form.allergies}
                onChange={(e) => setForm({ ...form, allergies: e.target.value })}
                placeholder="مثال: بنسلين…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>تاريخ الميلاد</Label>
              <Input
                type="date"
                value={form.dateOfBirth}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
              />
              <p className="text-[10px] text-muted-foreground">
                يفعّل فحص الحد الأدنى للعمر عند البيع
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>الحالة الخاصة</Label>
              <select
                className="h-9 w-full rounded-md border bg-card px-3 text-sm"
                value={form.pregnancyStatus}
                onChange={(e) => setForm({ ...form, pregnancyStatus: e.target.value })}
              >
                <option value="none">لا ينطبق</option>
                <option value="pregnant">حامل</option>
                <option value="breastfeeding">مرضعة</option>
              </select>
              <p className="text-[10px] text-muted-foreground">
                يفعّل فحص فئات حمل FDA عند البيع
              </p>
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

      {/* نافذة فحص التداخلات */}
      <Dialog open={checkOpen} onOpenChange={setCheckOpen}>
        <DialogContent className="sm:max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>فحص التداخلات الدوائية</DialogTitle>
            <DialogDescription>
              أدخل المواد الفعالة مفصولة بفواصل للتحقق من التداخلات بينها
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              rows={2}
              value={checkText}
              onChange={(e) => setCheckText(e.target.value)}
              placeholder="مثال: warfarin, aspirin, ibuprofen"
              dir="ltr"
            />
            <Button onClick={runCheck} disabled={checking} className="w-full bg-teal-600 hover:bg-teal-700">
              {checking ? <Loader2 className="size-4 animate-spin" /> : "فحص"}
            </Button>
            {checkResults !== null &&
              (checkResults.length === 0 ? (
                <p className="rounded-lg bg-emerald-50 p-3 text-center text-sm font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                  ✓ لا توجد تداخلات معروفة بين هذه المواد
                </p>
              ) : (
                <div className="space-y-2">
                  {checkResults.map((h, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border p-3 text-sm ${
                        h.severity === "major"
                          ? "border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10"
                          : "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
                      }`}
                    >
                      <p className="font-bold">
                        {h.genericA} + {h.genericB}
                        <span className="ms-2 text-xs font-medium text-muted-foreground">
                          ({SEVERITY_LABEL[h.severity] ?? h.severity})
                        </span>
                      </p>
                      <p className="mt-1 text-xs leading-relaxed">{h.description}</p>
                      {h.management && (
                        <p className="mt-1 text-xs text-muted-foreground">💡 {h.management}</p>
                      )}
                    </div>
                  ))}
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
