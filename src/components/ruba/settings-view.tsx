"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { ROLE_LABEL } from "@/lib/role-label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  DatabaseBackup,
  Download,
  LogOut,
  Pill,
  ShieldCheck,
  ShieldOff,
  Info,
  Loader2,
  KeyRound,
  Landmark,
  Building2,
  Plus,
} from "lucide-react";

interface ProviderRow {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
  isActive: boolean;
  _count: { policies: number; sales: number };
}
interface BranchRow {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  _count: { users: number; sales: number };
}

export function SettingsView({
  user,
  onLogout,
}: {
  user: { id: string; username: string; fullName: string; role: string };
  onLogout: () => void;
}) {
  const [exporting, setExporting] = useState(false);
  // ── v4.5 — التحقق بخطوتين ──
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [setupUri, setSetupUri] = useState<string | null>(null);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy2fa, setBusy2fa] = useState(false);

  // ── v4.6 — شركات التأمين والفروع (إدارة المدير) ──
  const isAdmin = user.role === "admin";
  const [providers, setProviders] = useState<ProviderRow[] | null>(null);
  const [provForm, setProvForm] = useState({ name: "", code: "", phone: "" });
  const [provSaving, setProvSaving] = useState(false);
  const [branches, setBranches] = useState<BranchRow[] | null>(null);
  const [branchForm, setBranchForm] = useState({ name: "", code: "", phone: "", address: "" });
  const [branchSaving, setBranchSaving] = useState(false);

  // ── v5.0 — لوحة بوابة قفل النظام ──
  interface LockCfg {
    mode: "admin" | "users";
    ttlHours: number;
    epoch: string;
    source: { mode: "env" | "db"; ttl: "env" | "db"; epoch: "env" | "db" };
  }
  const [lockCfg, setLockCfg] = useState<LockCfg | null>(null);
  const [lockSaving, setLockSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const loadProviders = useCallback(async () => {
    try {
      const r = await api<{ providers: ProviderRow[] }>("/api/insurance/providers");
      setProviders(r.providers);
    } catch {
      setProviders([]);
    }
  }, []);

  const loadBranches = useCallback(async () => {
    try {
      const r = await api<{ branches: BranchRow[] }>("/api/branches");
      setBranches(r.branches);
    } catch {
      setBranches([]);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void loadProviders();
    void loadBranches();
  }, [isAdmin, loadProviders, loadBranches]);

  const loadLockCfg = useCallback(async () => {
    try {
      const r = await api<LockCfg>("/api/lock/settings");
      setLockCfg(r);
    } catch {
      setLockCfg(null);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void loadLockCfg();
  }, [isAdmin, loadLockCfg]);

  async function saveLock(patch: { mode?: "admin" | "users"; ttlHours?: number }) {
    setLockSaving(true);
    try {
      const r = await api<LockCfg>("/api/lock/settings", { method: "PUT", json: patch });
      setLockCfg(r);
      toast.success("حُفظت إعدادات القفل — تُطبّق على مفاتيح الفتح الجديدة");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر الحفظ");
    } finally {
      setLockSaving(false);
    }
  }

  async function revokeKeys() {
    setRevoking(true);
    try {
      await api("/api/lock/revoke", { method: "POST" });
      toast.success("سُحبت كل المفاتيح — ستُلتقط الأجهزة المفتوحة خلال دقيقة");
      await loadLockCfg();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر السحب");
    } finally {
      setRevoking(false);
    }
  }

  async function addProvider() {
    if (!provForm.name.trim()) {
      toast.error("اسم الشركة مطلوب");
      return;
    }
    setProvSaving(true);
    try {
      await api("/api/insurance/providers", { method: "POST", json: provForm });
      toast.success("تمت إضافة شركة التأمين");
      setProvForm({ name: "", code: "", phone: "" });
      await loadProviders();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر الإضافة");
    } finally {
      setProvSaving(false);
    }
  }

  async function toggleProvider(row: ProviderRow) {
    try {
      await api(`/api/insurance/providers/${row.id}`, {
        method: "PATCH",
        json: { isActive: !row.isActive },
      });
      await loadProviders();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر التحديث");
    }
  }

  async function addBranch() {
    if (!branchForm.name.trim()) {
      toast.error("اسم الفرع مطلوب");
      return;
    }
    setBranchSaving(true);
    try {
      await api("/api/branches", { method: "POST", json: branchForm });
      toast.success("تمت إضافة الفرع — عيّنه للموظفين من تبويب المستخدمين");
      setBranchForm({ name: "", code: "", phone: "", address: "" });
      await loadBranches();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر الإضافة");
    } finally {
      setBranchSaving(false);
    }
  }

  async function toggleBranch(row: BranchRow) {
    try {
      await api(`/api/branches/${row.id}`, {
        method: "PATCH",
        json: { isActive: !row.isActive },
      });
      await loadBranches();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر التحديث");
    }
  }

  const load2fa = useCallback(async () => {
    try {
      const me = await api<{ user: { totpEnabled?: boolean } }>("/api/auth/me");
      setTotpEnabled(!!me.user.totpEnabled);
    } catch {
      setTotpEnabled(false);
    }
  }, []);

  useEffect(() => {
    void load2fa();
  }, [load2fa]);

  async function start2faSetup() {
    setBusy2fa(true);
    try {
      const res = await api<{ otpauthUri: string; secret: string }>(
        "/api/auth/2fa/setup",
        { method: "POST" }
      );
      setSetupUri(res.otpauthUri);
      setSetupSecret(res.secret);
      setEnrolling(true);
      setCode("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التهيئة");
    } finally {
      setBusy2fa(false);
    }
  }

  async function confirm2fa() {
    if (code.length !== 6) {
      toast.error("أدخل الكود الست-رقمي من التطبيق");
      return;
    }
    setBusy2fa(true);
    try {
      await api("/api/auth/2fa/enable", { method: "POST", json: { code } });
      toast.success("التحقق بخطوتين مفعّل — حماية كاملة لحسابك");
      setEnrolling(false);
      setSetupUri(null);
      setSetupSecret(null);
      setCode("");
      await load2fa();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التفعيل");
    } finally {
      setBusy2fa(false);
    }
  }

  async function disable2fa() {
    if (code.length !== 6) {
      toast.error("أدخل كوداً صحيحاً لتأكيد التعطيل");
      return;
    }
    setBusy2fa(true);
    try {
      await api("/api/auth/2fa/disable", { method: "POST", json: { code } });
      toast.info("عُطّل التحقق بخطوتين");
      setCode("");
      await load2fa();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التعطيل");
    } finally {
      setBusy2fa(false);
    }
  }

  async function backup() {
    setExporting(true);
    try {
      const res = await fetch("/api/backup");
      if (!res.ok) throw new Error("فشل إنشاء النسخة");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `ruba-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("تم تنزيل النسخة الاحتياطية");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التصدير");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* بطاقة الحساب */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-teal-600 text-xl font-extrabold text-white">
            {user.fullName.charAt(0)}
          </div>
          <div className="flex-1">
            <p className="text-lg font-extrabold">{user.fullName}</p>
            <p className="num text-sm text-muted-foreground" dir="ltr">
              @{user.username}
            </p>
          </div>
          <Badge className="bg-teal-100 font-bold text-teal-700 dark:bg-teal-500/15 dark:text-teal-400">
            <ShieldCheck className="me-1 size-3" />
            {ROLE_LABEL[user.role] ?? user.role}
          </Badge>
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={onLogout} className="text-rose-600">
            <LogOut className="size-4" /> تسجيل الخروج
          </Button>
        </div>
      </div>

      {/* التحقق بخطوتين — v4.5 */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">
            <KeyRound className="size-5" />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-bold">التحقق بخطوتين (TOTP)</h3>
              {totpEnabled === null ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : totpEnabled ? (
                <Badge className="bg-emerald-100 font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                  <ShieldCheck className="me-1 size-3" /> مفعّل
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  <ShieldOff className="me-1 size-3" /> غير مفعّل
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              طبقة حماية ثانية عبر تطبيق مصادقة (Google Authenticator أو مثيلاته) —
              كلمة المرور وحدها لن تكفي لدخول حسابك بعد تفعيله. يُنصح به بشدة
              لحساب المدير.
            </p>

            {enrolling && setupUri ? (
              <div className="mt-3 space-y-3 rounded-lg border border-dashed p-4">
                <p className="text-sm font-bold">1. امسح الرمز بتطبيق المصادقة:</p>
                <div className="flex flex-col items-center gap-2">
                  <QRCodeSVG value={setupUri} size={144} level="M" />
                  <p className="num break-all text-center text-[10px] text-muted-foreground" dir="ltr">
                    {setupSecret}
                  </p>
                </div>
                <p className="text-sm font-bold">2. أدخل الكود الست-رقمي للتأكيد:</p>
                <div className="flex gap-2">
                  <Input
                    className="num h-11 text-center text-lg font-bold tracking-[0.4em]"
                    placeholder="000000"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))
                    }
                    inputMode="numeric"
                    dir="ltr"
                  />
                  <Button onClick={confirm2fa} disabled={busy2fa || code.length !== 6} className="bg-teal-600 hover:bg-teal-700">
                    {busy2fa ? <Loader2 className="size-4 animate-spin" /> : "تفعيل"}
                  </Button>
                </div>
              </div>
            ) : totpEnabled ? (
              <div className="mt-3 space-y-2">
                <Input
                  className="num h-10 text-center text-lg font-bold tracking-[0.4em]"
                  placeholder="كود للتأكيد قبل التعطيل"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))
                  }
                  inputMode="numeric"
                  dir="ltr"
                />
                <Button
                  variant="outline"
                  onClick={disable2fa}
                  disabled={busy2fa || code.length !== 6}
                  className="text-rose-600"
                >
                  {busy2fa ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4" />}
                  تعطيل التحقق بخطوتين
                </Button>
              </div>
            ) : (
              <Button onClick={start2faSetup} disabled={busy2fa} className="mt-3 bg-teal-600 hover:bg-teal-700">
                {busy2fa ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                تفعيل التحقق بخطوتين
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* v5.0 — لوحة بوابة قفل النظام */}
      {isAdmin && (
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
              <KeyRound className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold">بوابة قفل النظام</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                مَن يفتح النظام وبأي مفتاح ولمدة كم — تُطبّق القيم على مفاتيح الفتح الجديدة،
                والقائمة تكمل صلاحيتها.
              </p>
              {lockCfg === null ? (
                <Loader2 className="mt-3 size-4 animate-spin text-muted-foreground" />
              ) : (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline">
                      الوضع الحالي: {lockCfg.mode === "admin" ? "مفتاح المدير" : "مفاتيح الموظفين"}
                    </Badge>
                    <Badge variant="outline">المدة: {lockCfg.ttlHours} ساعة</Badge>
                    <Badge variant="outline">epoch: {lockCfg.epoch}</Badge>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="mb-2 text-xs font-bold">وضع المفاتيح</p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={lockCfg.mode === "admin" ? "default" : "outline"}
                          disabled={lockSaving || lockCfg.mode === "admin"}
                          onClick={() => saveLock({ mode: "admin" })}
                          className="bg-teal-600 hover:bg-teal-700"
                        >
                          مفتاح المدير
                        </Button>
                        <Button
                          size="sm"
                          variant={lockCfg.mode === "users" ? "default" : "outline"}
                          disabled={lockSaving || lockCfg.mode === "users"}
                          onClick={() => saveLock({ mode: "users" })}
                        >
                          مفاتيح الموظفين
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="mb-2 text-xs font-bold">مدة بقاء المفتاح</p>
                      <select
                        className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                        value={lockCfg.ttlHours}
                        disabled={lockSaving}
                        onChange={(e) => saveLock({ ttlHours: Number(e.target.value) })}
                      >
                        {[1, 2, 4, 8, 12, 24, 48, 72, 168].map((h) => (
                          <option key={h} value={h}>{h} ساعة</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-900 dark:bg-rose-950/30">
                    <p className="text-xs font-bold text-rose-700 dark:text-rose-300">سحب طارئ</p>
                    <p className="mt-1 text-xs text-rose-600/80 dark:text-rose-400/80">
                      يميت كل مفاتيح الفتح الصادرة على كل الأجهزة فوراً — تُستخدم عند
                      فقدان جهاز أو شبهة تسريب.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 border-rose-300 text-rose-700 hover:bg-rose-100 dark:text-rose-300"
                      disabled={revoking}
                      onClick={revokeKeys}
                    >
                      {revoking ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4" />}
                      سحب كل المفاتيح الآن
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* شركات التأمين والفروع — إدارة (v4.6) */}
      {isAdmin && (
        <>
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                <Landmark className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold">شركات التأمين</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  الشركات المتعامل معها — إيقاف شركة يحجب بوليصاتها من نقطة البيع فوراً
                  (البوليصات تُدار من تبويب المرضى).
                </p>
                <div className="mt-3 space-y-2">
                  {providers === null ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : providers.length === 0 ? (
                    <p className="rounded-lg border bg-muted/40 p-3 text-center text-xs text-muted-foreground">
                      لا شركات تأمين بعد — أضف أول شركة
                    </p>
                  ) : (
                    providers.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 p-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold">
                            {p.name}
                            {p.code && (
                              <span className="num ms-2 text-[10px] font-normal text-muted-foreground" dir="ltr">
                                {p.code}
                              </span>
                            )}
                            {!p.isActive && (
                              <span className="ms-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-500/20 dark:text-slate-400">
                                موقوفة
                              </span>
                            )}
                          </p>
                          <p className="num text-[11px] text-muted-foreground">
                            {p._count.policies} بوليصة · {p._count.sales} فاتورة تأمين
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 text-xs"
                          onClick={() => toggleProvider(p)}
                        >
                          {p.isActive ? "إيقاف" : "تفعيل"}
                        </Button>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <Input
                    placeholder="اسم الشركة *"
                    value={provForm.name}
                    onChange={(e) => setProvForm({ ...provForm, name: e.target.value })}
                  />
                  <Input
                    placeholder="رمز التعامل"
                    value={provForm.code}
                    onChange={(e) => setProvForm({ ...provForm, code: e.target.value })}
                    dir="ltr"
                  />
                  <div className="flex gap-2">
                    <Input
                      placeholder="هاتف"
                      value={provForm.phone}
                      onChange={(e) => setProvForm({ ...provForm, phone: e.target.value })}
                      dir="ltr"
                    />
                    <Button
                      onClick={addProvider}
                      disabled={provSaving}
                      className="shrink-0 bg-emerald-600 hover:bg-emerald-700"
                    >
                      {provSaving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
                <Building2 className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold">الفروع</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  وحدات التقرير والربط — كل فاتورة تُسجّل على فرع موظفها، وتقارير المبيعات
                  تُفلتر بالفرع. المخزون مركزي واحد (قرار v4.6).
                </p>
                <div className="mt-3 space-y-2">
                  {branches === null ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : branches.length === 0 ? (
                    <p className="rounded-lg border bg-muted/40 p-3 text-center text-xs text-muted-foreground">
                      لا فروع بعد — أضف الفرع الرئيسي أولاً
                    </p>
                  ) : (
                    branches.map((b) => (
                      <div
                        key={b.id}
                        className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 p-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold">
                            {b.name}
                            {b.code && (
                              <span className="num ms-2 text-[10px] font-normal text-muted-foreground" dir="ltr">
                                {b.code}
                              </span>
                            )}
                            {!b.isActive && (
                              <span className="ms-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-500/20 dark:text-slate-400">
                                موقوف
                              </span>
                            )}
                          </p>
                          <p className="num text-[11px] text-muted-foreground">
                            {b._count.users} موظف · {b._count.sales} فاتورة
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 text-xs"
                          onClick={() => toggleBranch(b)}
                        >
                          {b.isActive ? "إيقاف" : "تفعيل"}
                        </Button>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <Input
                    placeholder="اسم الفرع *"
                    value={branchForm.name}
                    onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
                  />
                  <Input
                    placeholder="رمز الفرع"
                    value={branchForm.code}
                    onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value })}
                    dir="ltr"
                  />
                  <div className="flex gap-2">
                    <Input
                      placeholder="هاتف الفرع"
                      value={branchForm.phone}
                      onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })}
                      dir="ltr"
                    />
                    <Button
                      onClick={addBranch}
                      disabled={branchSaving}
                      className="shrink-0 bg-amber-600 hover:bg-amber-700"
                    >
                      {branchSaving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* النسخ الاحتياطي */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">
            <DatabaseBackup className="size-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold">النسخ الاحتياطي</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              تصدير نسخة كاملة من قاعدة البيانات (المستخدمون، المخزون، المبيعات، المرضى،
              الإشعارات) بصيغة JSON — احتفظ بها في مكان آمن خارج الجهاز.
            </p>
            <Button onClick={backup} disabled={exporting} className="mt-3 bg-teal-600 hover:bg-teal-700">
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              تنزيل نسخة احتياطية
            </Button>
          </div>
        </div>
      </div>

      {/* عن المنصة */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400">
            <Pill className="size-5" />
          </div>
          <div className="flex-1 text-sm">
            <h3 className="font-bold">عن ربي فارمسي</h3>
            <p className="mt-1 leading-relaxed text-muted-foreground">
              منصة ويب عربية متكاملة لإدارة الصيدليات — إصدار 4.6. تشمل نقطة بيع ذرّية
              آمنة مع Idempotency وفوترة ZATCA ضريبية وتأميناً طبياً بتقسيم حصص
              المؤمن والمريض، مخزوناً بسجل تدقيق كامل وتعدد فروع،
              سجلاً وطنياً مرخصاً SFDA، فحص تداخلات دوائية، تنبؤاً ذكياً بإعادة الطلب،
              وتحققاً بخطوتين وصلاحيات مبنية على الأدوار.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {["Next.js 16", "Prisma ORM", "shadcn/ui", "JWT Auth", "Decimal-safe"].map((t) => (
                <Badge key={t} variant="secondary" className="num text-[11px]">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* الإصلاحات الأمنية */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
            <Info className="size-5" />
          </div>
          <div className="flex-1 text-sm">
            <h3 className="font-bold">سجل الإصلاحات (مقابل v2.0)</h3>
            <ul className="mt-2 list-inside list-disc space-y-1.5 leading-relaxed text-muted-foreground">
              <li>إصلاح ثغرة التعبئة: فحص الدور مركزي في الخادم قبل كل عملية حساسة</li>
              <li>معاملة ذرّية واحدة للبيع (فاتورة + بنود + مخزون + تدقيق) بدل خطوات منفصلة</li>
              <li>مفاتيح dedupe فريدة للإشعارات بدل مطابقة النصوص</li>
              <li>حماية من تكرار المعاملات على مستوى قاعدة البيانات (reference فريد)</li>
              <li>نقود بالهللات الصحيحة (Integer) — دقة مطلقة بلا أخطاء عائمة</li>
              <li>حماية بقاء مدير فعال واحد على الأقل في النظام</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
