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
} from "lucide-react";

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
              منصة ويب عربية متكاملة لإدارة الصيدليات — إصدار 4.5. تشمل نقطة بيع ذرّية
              آمنة مع Idempotency وفوترة ZATCA ضريبية، مخزوناً بسجل تدقيق كامل،
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
