"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  TimerReset,
} from "lucide-react";

/**
 * v4.8 — مراقب انتهاء مفتاح النظام (الفجوة 4: لا انقطاع مفاجئ)
 *
 *  - يحاور /api/lock/status كل دقيقة (وعند عودة التبويب للواجهة):
 *      • انتهى/سُحب المفتاح  ⇒ تمحيص خبز الصفحات في الـ SW ثم توجيه فوري إلى /lock.
 *      • يقترب الانتهاء      ⇒ تنبيه تحذيري مع زر «تمديد الآن».
 *  - التمديد داخلي: حوار يطلب المفتاح (وباسم المستخدم في وضع users) ويستدعي
 *    /api/lock/verify — يبقى المستخدم في مكانه بلا خسارة أي حالة عمل.
 *
 * أمان: الحوار نفسه يمر بكل تحصينات /api/lock/verify (مقيّد 5/15د، bcrypt،
 * تدقيق) — ورسائل الخطأ معروضة كما في شاشة القفل الأصلية.
 */

type LockStatus = {
  locked: boolean;
  expiresAt: string | null;
  warnBeforeSec: number;
  mode: "admin" | "users";
};

/** تمحيص خبز صفحات الـ SW — يُستدعى عند الإقفال (دفاع في العمق مع v4.8 SW) */
function purgeServiceWorkerPages() {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "PURGE_PAGES" });
  } catch {
    /* بلا SW — لا شيء */
  }
}

export function LockExpiryWatcher() {
  const pathname = usePathname();

  const [extendOpen, setExtendOpen] = useState(false);
  const [mode, setMode] = useState<"admin" | "users">("admin");
  const [username, setUsername] = useState("");
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // تنبيه واحد لكل مفتاح — يعاد التسليح بعد التمديد الناجح
  const warnedRef = useRef(false);

  const goLock = useCallback(() => {
    purgeServiceWorkerPages();
    const next =
      pathname && pathname !== "/" && pathname.startsWith("/")
        ? pathname
        : "/";
    window.location.replace(`/lock?next=${encodeURIComponent(next)}`);
  }, [pathname]);

  const poll = useCallback(async () => {
    try {
      const s = await api<LockStatus>("/api/lock/status");
      if (s.mode === "users" || s.mode === "admin") setMode(s.mode);

      if (s.locked) {
        goLock();
        return;
      }
      if (s.expiresAt) {
        const remaining = Date.parse(s.expiresAt) - Date.now();
        if (remaining <= 0) {
          goLock();
          return;
        }
        if (remaining <= s.warnBeforeSec * 1000) {
          if (!warnedRef.current) {
            warnedRef.current = true;
            const mins = Math.max(1, Math.ceil(remaining / 60000));
            toast.warning(`مفتاح النظام ينتهي بعد ${mins} دقيقة`, {
              description:
                "أدخل المفتاح مجدداً الآن لتمديد الجلسة دون مغادرة الصفحة أو خسارة عملك.",
              duration: Math.min(remaining, 10 * 60_000),
              action: { label: "تمديد الآن", onClick: () => setExtendOpen(true) },
            });
          }
        } else {
          warnedRef.current = false;
        }
      }
    } catch {
      /* الشبكة/الخادم غير متاح — الواجهة تعمل والمسؤولية على القفل الخادمي */
    }
  }, [goLock]);

  useEffect(() => {
    poll();
    const t = window.setInterval(poll, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  async function submitExtend(e?: React.FormEvent) {
    e?.preventDefault();
    if (!key) {
      setError("أدخل مفتاح النظام");
      return;
    }
    if (mode === "users" && !username.trim()) {
      setError("أدخل اسم المستخدم");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api("/api/lock/verify", {
        method: "POST",
        json: {
          password: key,
          ...(mode === "users" ? { username: username.trim().toLowerCase() } : {}),
        },
      });
      setKey("");
      setUsername("");
      setExtendOpen(false);
      warnedRef.current = false;
      const s = await api<LockStatus>("/api/lock/status").catch(() => null);
      toast.success("تم تمديد مفتاح النظام", {
        description: s?.expiresAt
          ? `سارٍ حتى ${new Date(s.expiresAt).toLocaleTimeString("ar-SA", {
              hour: "2-digit",
              minute: "2-digit",
            })}`
          : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر التمديد — أعد المحاولة");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={extendOpen} onOpenChange={(v) => !saving && setExtendOpen(v)}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <TimerReset className="size-5 text-teal-600" />
            تمديد مفتاح النظام
          </DialogTitle>
          <DialogDescription>
            مفتاح النظام على هذا الجهاز يقترب من الانتهاء — أدخل{" "}
            {mode === "users" ? "بيانات حسابك" : "كلمة مرور مدير النظام"}{" "}
            للتمديد دون مغادرة الصفحة.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submitExtend} className="space-y-4" noValidate>
          {mode === "users" ? (
            <div className="space-y-2">
              <Label htmlFor="extend-username">اسم المستخدم</Label>
              <Input
                id="extend-username"
                name="extend-username"
                type="text"
                autoComplete="username"
                dir="ltr"
                className="text-start"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (error) setError(null);
                }}
                disabled={saving}
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="extend-key">مفتاح النظام</Label>
            <div className="relative">
              <KeyRound className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="extend-key"
                name="extend-key"
                type={showKey ? "text" : "password"}
                autoComplete="current-password"
                placeholder={mode === "users" ? "كلمة مرور حسابك" : "كلمة مرور مدير النظام"}
                className="pr-9 pl-10"
                value={key}
                autoFocus
                onChange={(e) => {
                  setKey(e.target.value);
                  if (error) setError(null);
                }}
                disabled={saving}
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
              role="alert"
              className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full gap-2" disabled={saving}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LockKeyhole className="size-4" />
            )}
            {saving ? "جارٍ التمديد…" : "تمديد الجلسة"}
          </Button>

          <p className="text-center text-xs leading-relaxed text-muted-foreground">
            كل محاولة تُدقَّق وتُسجَّل — والمقيّد نفسه (5 محاولات / 15 دقيقة) يسري هنا
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
