import type { Metadata } from "next";
import { WifiOff, CloudOff, ShieldCheck } from "lucide-react";
import { OfflineRetry } from "./retry-button";

/**
 * v4.8 — صفحة السقوط دون اتصال (PWA Offline Fallback)
 * يخدمها الـ Service Worker عندما يفشل التنقل بلا شبكة ولا نسخة حديثة.
 * محتوى ساكن بالكامل — بلا بيانات تشغيل — ومسار عام في بوابة القفل.
 */
export const metadata: Metadata = {
  title: "لا يوجد اتصال · ربي فارمسي",
  description: "الصفحة غير متوفرة دون اتصال بالإنترنت",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-3xl bg-teal-500/10 ring-1 ring-teal-500/20">
        <WifiOff className="size-8 text-teal-600" />
      </div>

      <h1 className="mt-6 text-2xl font-extrabold">لا يوجد اتصال بالإنترنت</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
        هذه الصفحة غير مخزَّنة محلياً بعد. الصفحات التي زرتها خلال الساعة
        الأخيرة تبقى متاحة دون اتصال، وكل بيانات النظام الحية تُجلب مباشرة من
        الخادم عند عودة الاتصال.
      </p>

      <div className="mt-8 grid w-full max-w-md gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border bg-card p-4 text-start">
          <CloudOff className="size-5 text-muted-foreground" />
          <p className="mt-2 text-sm font-bold">وضع دون اتصال</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            تصفّح آخر صفحات النظام المزارة — دون أي طلبات شبكة.
          </p>
        </div>
        <div className="rounded-2xl border bg-card p-4 text-start">
          <ShieldCheck className="size-5 text-muted-foreground" />
          <p className="mt-2 text-sm font-bold">أمان محفوظ</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            بيانات النظام لا تُخبَّز محلياً — وتُمحى فور إقفال النظام.
          </p>
        </div>
      </div>

      <OfflineRetry />
    </div>
  );
}
