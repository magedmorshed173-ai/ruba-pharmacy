"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import {
  Pill,
  Lock,
  User as UserIcon,
  ShieldCheck,
  BarChart3,
  ShoppingCart,
  BellRing,
  Loader2,
} from "lucide-react";

export function LoginView() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // ── v4.5 — الخطوة الثانية: تحدي TOTP قصير الأجل ──
  const [twoFaChallenge, setTwoFaChallenge] = useState<string | null>(null);
  const [twoFaCode, setTwoFaCode] = useState("");
  const [twoFaLoading, setTwoFaLoading] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!username.trim() || !password) {
      toast.error("أدخل اسم المستخدم وكلمة المرور");
      return;
    }
    setLoading(true);
    try {
      const res = await api<{ twoFactorRequired?: boolean; challenge?: string; mustEnroll2fa?: boolean }>(
        "/api/auth/login",
        {
          method: "POST",
          json: { username: username.trim(), password },
        }
      );
      if (res.twoFactorRequired && res.challenge) {
        setTwoFaChallenge(res.challenge);
        toast.info("أدخل كود التطبيق المصادق لإكمال الدخول");
        return;
      }
      toast.success("مرحباً بك في ربي فارمسي");
      router.refresh();
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل تسجيل الدخول");
    } finally {
      setLoading(false);
    }
  }

  async function submitTwoFa(e?: React.FormEvent) {
    e?.preventDefault();
    if (!/^[0-9]{6}$/.test(twoFaCode.trim())) {
      toast.error("الكود 6 أرقام من تطبيق المصادقة");
      return;
    }
    setTwoFaLoading(true);
    try {
      await api("/api/auth/login/verify", {
        method: "POST",
        json: { challenge: twoFaChallenge, code: twoFaCode.trim() },
      });
      toast.success("مرحباً بك في ربي فارمسي");
      router.refresh();
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل التحقق");
    } finally {
      setTwoFaLoading(false);
    }
  }

  function fillDemo(u: string, p: string) {
    setUsername(u);
    setPassword(p);
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* الجانب التعريفي */}
      <div className="relative hidden flex-1 overflow-hidden bg-[oklch(0.265_0.045_220)] lg:flex">
        <div className="absolute -top-24 -left-24 size-96 rounded-full bg-teal-500/20 blur-3xl" />
        <div className="absolute bottom-0 right-0 size-[28rem] translate-x-1/3 translate-y-1/3 rounded-full bg-teal-400/10 blur-3xl" />
        <div className="relative z-10 flex w-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-teal-500 shadow-lg shadow-teal-500/30">
              <Pill className="size-6 text-white" />
            </div>
            <div>
              <p className="text-xl font-extrabold">ربي فارمسي</p>
              <p className="text-[11px] tracking-[0.3em] text-teal-300/80">RUBA PHARMACY</p>
            </div>
          </div>

          <div className="max-w-lg">
            <h1 className="text-4xl font-extrabold leading-snug">
              نظام إدارة الصيدليات
              <span className="text-teal-300"> العربي المتكامل</span>
            </h1>
            <p className="mt-4 leading-relaxed text-white/70">
              نقطة بيع سريعة، مخزون دقيق، تنبؤ ذكي بإعادة الطلب، وفحص تداخلات دوائية —
              كل ما تحتاجه صيدليتك في منصة واحدة تعمل من المتصفح.
            </p>

            <div className="mt-10 grid grid-cols-2 gap-4">
              {[
                { icon: ShoppingCart, t: "نقطة بيع فورية", d: "سلة متعددة البنود مع خصم وتداخلات" },
                { icon: BarChart3, t: "تقارير وتنبؤات", d: "إيرادات يومية وتوصيل ذكي للطلب" },
                { icon: ShieldCheck, t: "أدوار وصلاحيات", d: "مدير · صيدلي · فني صيدلة" },
                { icon: BellRing, t: "إشعارات استباقية", d: "صلاحية قاربت ونقص مخزون" },
              ].map((f) => (
                <div key={f.t} className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                  <f.icon className="mb-2 size-5 text-teal-300" />
                  <p className="text-sm font-bold">{f.t}</p>
                  <p className="mt-0.5 text-xs text-white/60">{f.d}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-white/40">
            إصدار 4.5 · منصة الويب · مبني بتقنيات مفتوحة (Next.js · Prisma · shadcn/ui)
          </p>
        </div>
      </div>

      {/* نموذج الدخول */}
      <div className="flex w-full flex-col items-center justify-center px-6 lg:w-[480px] lg:px-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <div className="mb-3 flex size-14 items-center justify-center rounded-2xl bg-teal-600 shadow-lg shadow-teal-600/30">
              <Pill className="size-7 text-white" />
            </div>
            <h1 className="text-2xl font-extrabold">ربي فارمسي</h1>
            <p className="text-xs tracking-[0.25em] text-muted-foreground">RUBA PHARMACY</p>
          </div>

          <h2 className="text-2xl font-bold">
            {twoFaChallenge ? "التحقق بخطوتين" : "تسجيل الدخول"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {twoFaChallenge
              ? "أدخل الكود الست-رقمي من تطبيق المصادقة في هاتفك"
              : "أدخل بيانات حسابك للوصول إلى لوحة التحكم"}
          </p>

          {twoFaChallenge ? (
            <form onSubmit={submitTwoFa} className="mt-8 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="totp">كود التحقق</Label>
                <Input
                  id="totp"
                  className="num h-11 text-center text-2xl font-bold tracking-[0.5em]"
                  placeholder="000000"
                  value={twoFaCode}
                  onChange={(e) =>
                    setTwoFaCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  dir="ltr"
                />
              </div>
              <Button
                type="submit"
                disabled={twoFaLoading || twoFaCode.length !== 6}
                className="h-11 w-full bg-teal-600 text-base font-bold hover:bg-teal-700"
              >
                {twoFaLoading ? <Loader2 className="size-5 animate-spin" /> : "تحقق ودخول"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setTwoFaChallenge(null);
                  setTwoFaCode("");
                }}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
              >
                ← العودة إلى تسجيل الدخول
              </button>
            </form>
          ) : (
          <form onSubmit={submit} className="mt-8 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">اسم المستخدم</Label>
              <div className="relative">
                <UserIcon className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="username"
                  type="text"
                  name="username"
                  className="ps-9 h-11"
                  placeholder="مثال: admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  dir="ltr"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">كلمة المرور</Label>
              <div className="relative">
                <Lock className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  className="ps-9 h-11"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  dir="ltr"
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="h-11 w-full bg-teal-600 text-base font-bold hover:bg-teal-700"
            >
              {loading ? <Loader2 className="size-5 animate-spin" /> : "دخول"}
            </Button>
          </form>
          )}

          <div className="mt-8 rounded-xl border bg-muted/40 p-4">
            <p className="mb-3 text-xs font-bold text-muted-foreground">
              حسابات تجريبية — اضغط للتعبئة التلقائية
            </p>
            <div className="grid gap-2">
              {[
                { u: "admin", p: "Admin@2026!", label: "مدير النظام" },
                { u: "pharmacist", p: "Pharm@2026!", label: "صيدلي" },
                { u: "tech1", p: "Tech@2026!", label: "فني صيدلة" },
              ].map((a) => (
                <button
                  key={a.u}
                  type="button"
                  onClick={() => fillDemo(a.u, a.p)}
                  className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-start transition hover:border-teal-300 hover:bg-accent"
                >
                  <div>
                    <span className="num text-sm font-bold" dir="ltr">{a.u}</span>
                    <span className="num ms-2 text-xs text-muted-foreground" dir="ltr">{a.p}</span>
                  </div>
                  <span className="text-xs font-medium text-teal-700 dark:text-teal-400">{a.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
