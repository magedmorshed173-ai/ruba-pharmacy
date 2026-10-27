"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import {
  Pill,
  Lock,
  KeyRound,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
  BarChart3,
  BellRing,
  LockKeyhole,
} from "lucide-react";

/**
 * v4.7 — شاشة قفل النظام (واجهة العميل)
 * طلب مفتاح النظام (= كلمة مرور مدير النظام) قبل السماح بعرض أي صفحة.
 * مستقلة تماماً عن شاشة تسجيل الدخول — القفل طبقة، والدخول طبقة فوقه.
 */
export function LockClient() {
  const params = useSearchParams();

  const [key, setKey] = useState("");
  const [username, setUsername] = useState("");
  const [mode, setMode] = useState<"admin" | "users">("admin");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // وجهة العودة بعد الفتح — داخلية فقط (حماية من open redirect)
  const [nextPath, setNextPath] = useState("/");

  useEffect(() => {
    const raw = params.get("next") ?? "/";
    // مسار نسبي داخلي فقط: يبدأ بـ "/" وليس "//" (لا بروتوكول خارجي)
    setNextPath(raw.startsWith("/") && !raw.startsWith("//") ? raw : "/");
  }, [params]);

  // v4.8 — وضع المفاتيح (admin/users) لتكييف الحقول + تمحيص خبز الصفحات
  // في الـ SW (وصلنا لشاشة القفل ⇒ النظام مقفل ⇒ لا نسخ صفحات قديمة محلياً)
  useEffect(() => {
    try {
      navigator.serviceWorker?.controller?.postMessage({ type: "PURGE_PAGES" });
    } catch {
      /* بلا SW */
    }
    api<{ mode?: "admin" | "users" }>("/api/lock/status")
      .then((s) => {
        if (s.mode === "users") setMode("users");
      })
      .catch(() => {
        /* الافتراضي admin */
      });
  }, []);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (mode === "users" && !username.trim()) {
      setError("أدخل اسم المستخدم");
      return;
    }
    if (!key) {
      setError("أدخل مفتاح النظام");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api("/api/lock/verify", {
        method: "POST",
        json: {
          password: key,
          ...(mode === "users"
            ? { username: username.trim().toLowerCase() }
            : {}),
        },
      });
      // فتح ناجح — الكوكي استُلم، الانتقال للوجهة المطلوبة
      window.location.replace(nextPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر فتح القفل");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* الجانب التعريفي — نفس هوية شاشة الدخول */}
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
            <div className="mb-6 inline-flex size-16 items-center justify-center rounded-3xl bg-white/10 ring-1 ring-white/20 backdrop-blur">
              <LockKeyhole className="size-8 text-teal-300" />
            </div>
            <h1 className="text-4xl font-extrabold leading-snug">
              النظام محمي{" "}
              <span className="text-teal-300">
                {mode === "users" ? "بمفاتيح الحسابات" : "بمفتاح المدير"}
              </span>
            </h1>
            <p className="mt-4 leading-relaxed text-white/70">
              طبقة حماية أولى قبل تسجيل الدخول: كل من يفتح النظام من أي جهاز
              يُطلب منه مفتاح النظام — وهو كلمة مرور مدير النظام — قبل عرض
              أي شاشة. كل محاولة فتح تُدقَّق وتُسجَّل.
            </p>

            <div className="mt-10 grid grid-cols-2 gap-4">
              {[
                { icon: ShieldCheck, t: "حماية شاملة", d: "كل الصفحات والواجهات خلف القفل" },
                { icon: KeyRound, t: mode === "users" ? "مفتاح لكل موظف" : "مفتاح واحد", d: mode === "users" ? "باسم المستخدم وكلمة المرور" : "كلمة مرور مدير النظام" },
                { icon: BarChart3, t: "تدقيق كامل", d: "كل محاولة فتح مسجلة بالـ IP" },
                { icon: BellRing, t: "صدّ القوة الغاشمة", d: "حد محاولات دائم في القاعدة" },
              ].map(({ icon: Icon, t, d }) => (
                <div
                  key={t}
                  className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10"
                >
                  <Icon className="size-5 text-teal-300" />
                  <p className="mt-2 font-bold">{t}</p>
                  <p className="mt-1 text-xs text-white/60">{d}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-white/40">
            صلاحية الفتح محدودة على كل جهاز — ويُبطل المفتاح تلقائياً عند تغيير كلمة مرور المدير
          </p>
        </div>
      </div>

      {/* شاشة الطلب */}
      <div className="flex w-full items-center justify-center p-6 lg:w-[560px] lg:shrink-0">
        <div className="w-full max-w-md">
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-teal-500 shadow-lg shadow-teal-500/30">
              <Pill className="size-6 text-white" />
            </div>
            <p className="mt-3 text-xl font-extrabold">ربي فارمسي</p>
            <p className="text-[11px] tracking-[0.3em] text-muted-foreground">
              RUBA PHARMACY
            </p>
          </div>

          <div className="rounded-3xl border bg-card p-8 shadow-xl shadow-black/5">
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="flex size-16 items-center justify-center rounded-3xl bg-teal-500/10 ring-1 ring-teal-500/20">
                <Lock className="size-8 text-teal-600" />
              </div>
              <h2 className="mt-4 text-2xl font-extrabold">النظام مقفل</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                للوصول إلى النظام أدخل مفتاح الحماية —
                وهو كلمة مرور <span className="font-bold text-foreground">مدير النظام</span>
              </p>
            </div>

            <form onSubmit={submit} className="space-y-4" noValidate>
              {mode === "users" ? (
                <div className="space-y-2">
                  <Label htmlFor="lock-username">اسم المستخدم</Label>
                  <Input
                    id="lock-username"
                    name="lock-username"
                    type="text"
                    autoComplete="username"
                    dir="ltr"
                    className="text-start"
                    placeholder="اسم حسابك في النظام"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (error) setError(null);
                    }}
                    disabled={loading}
                  />
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="lock-key">مفتاح النظام</Label>
                <div className="relative">
                  <KeyRound className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="lock-key"
                    name="lock-key"
                    type={showKey ? "text" : "password"}
                    inputMode="text"
                    autoComplete="current-password"
                    placeholder={mode === "users" ? "كلمة مرور حسابك" : "كلمة مرور مدير النظام"}
                    className="pr-9 pl-10"
                    value={key}
                    autoFocus
                    onChange={(e) => {
                      setKey(e.target.value);
                      if (error) setError(null);
                    }}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={showKey ? "إخفاء المفتاح" : "إظهار المفتاح"}
                    tabIndex={-1}
                  >
                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              {error ? (
                <p
                  data-testid="lock-error"
                  role="alert"
                  className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
                >
                  {error}
                </p>
              ) : null}

              <Button type="submit" className="w-full gap-2" disabled={loading}>
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <LockKeyhole className="size-4" />
                )}
                {loading ? "جارٍ التحقق…" : "فتح النظام"}
              </Button>
            </form>

            <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
              {mode === "users"
                ? "كل مستخدم نشط يفتح بحسابه — وكل محاولة تُسجَّل في سجل التدقيق باسم صاحبها مع عنوان IP ووقت المحاولة"
                : "المفتاح متاح لمدير النظام فقط — كل محاولة فتح (صحيحة أو خاطئة) تُسجَّل في سجل التدقيق مع عنوان IP ووقت المحاولة"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
