"use client";

/**
 * صفحة التحميل — صيدلية رُبى v4.6.6
 * تثبيت PWA بضغطة + أوامر تثبيت قابلة للنسخ لكل منصة (Termux/Linux/Windows/macOS/Docker).
 * بلا اعتماديات خارجية — مكونات shadcn الموجودة + lucide فقط.
 */
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Apple,
  Check,
  Chrome,
  Copy,
  Download,
  Globe,
  Laptop,
  MonitorSmartphone,
  Package,
  Server,
  ShieldCheck,
  Smartphone,
  TerminalSquare,
} from "lucide-react";

const REPO = "https://github.com/magedmorshed173-ai/ruba-pharmacy";
const RAW_SH = `${REPO}/raw/main/scripts/install.sh`;
const RAW_PS1 = `${REPO}/raw/main/scripts/install.ps1`;
const LIVE = "https://ruba-pharmacy.vercel.app";

type BPEvent = Event & { prompt: () => Promise<void> };

function CopyRow({ label, cmd }: { label: string; cmd: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
    } catch {
      // احتياط للسياقات غير الآمنة
      const ta = document.createElement("textarea");
      ta.value = cmd;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="rounded-lg border bg-muted/40 p-3" dir="ltr">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">{label}</span>
        <Button size="sm" variant="secondary" className="h-8 gap-1.5" onClick={copy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "نُسخ" : "نسخ"}
        </Button>
      </div>
      <code className="block overflow-x-auto whitespace-nowrap text-[13px] leading-relaxed">
        {cmd}
      </code>
    </div>
  );
}

export default function DownloadClient() {
  const [installer, setInstaller] = useState<BPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState("");

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstaller(e as BPEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstaller(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // الكشف بعد أول إطار — يرضي قواعد الـ hooks ويضمن توفر navigator
    const detect = () => {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes("android")) setPlatform("android");
      else if (/iphone|ipad|ipod/.test(ua)) setPlatform("ios");
      else if (ua.includes("win")) setPlatform("windows");
      else if (/mac os|macintosh/.test(ua)) setPlatform("macos");
      else if (ua.includes("linux")) setPlatform("linux");
      const nav = navigator as Navigator & { standalone?: boolean };
      setInstalled(
        window.matchMedia("(display-mode: standalone)").matches ||
          nav.standalone === true
      );
    };
    const t = window.setTimeout(detect, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const highlight = (key: string) =>
    platform === key ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "";

  const cards = useMemo(
    () => [
      {
        key: "android",
        icon: Smartphone,
        title: "أندرويد",
        badge: platform === "android" ? "جهازك الحالي" : "PWA",
        steps: [
          "افتح " + LIVE + " في Chrome",
          "القائمة ⋮ ← «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»",
          "يعمل بلا شريط متصفح ومع أيقونتك الخاصة — وبدون متجر",
        ],
        extra: "لحزمة APK/AAB للمتجر: docs/ANDROID.md (TWA جاهز)",
      },
      {
        key: "ios",
        icon: Apple,
        title: "iPhone / iPad",
        badge: platform === "ios" ? "جهازك الحالي" : "Safari",
        steps: [
          "افتح " + LIVE + " في Safari (وليس Chrome)",
          "زر المشاركة ⬆ ← «إضافة إلى الشاشة الرئيسية»",
          "أيقونة مستقلة وتشغيل بملء الشاشة كأي تطبيق",
        ],
        extra: "iOS يدعم PWA فقط — وهو دعم كامل وثابت من Apple",
      },
      {
        key: "windows",
        icon: Laptop,
        title: "ويندوز",
        badge: platform === "windows" ? "جهازك الحالي" : "PWA + مثبّت",
        steps: [
          "افتح " + LIVE + " في Edge أو Chrome ← «تثبيت التطبيق» من شريط العنوان",
          "لخادم محلي: مثبّت PowerShell بأمر واحد (أدناه)",
          "أو Docker Desktop: docker compose up -d --build",
        ],
        extra: "سكربت install.ps1 يتكفل: git + Node/Bun + القاعدة + الترحيلات + التشغيل",
      },
      {
        key: "macos",
        icon: MonitorSmartphone,
        title: "macOS",
        badge: platform === "macos" ? "جهازك الحالي" : "PWA + مثبّت",
        steps: [
          "افتح " + LIVE + " في Chrome/Edge ← «تثبيت» (أيقونة في شريط العنوان)",
          "يظهر في Dock ومجلد التطبيقات كتطبيق مستقل",
          "لخادم محلي: نفس مثبّت لينكس أدناه (يتطلب Docker أو Node)",
        ],
        extra: "PWA على ماك يدعم النوافذ المستقلة وقائمة التطبيقات الأصلية",
      },
      {
        key: "linux",
        icon: TerminalSquare,
        title: "لينكس",
        badge: platform === "linux" ? "جهازك الحالي" : "مثبّت شامل",
        steps: [
          "مثبّت بأمر واحد أدناه — يكتشف بيئتك ويثبّت كل شيء",
          "خيار --service يجعله خدمة systemd تعمل عند الإقلاع",
          "أو Docker Compose للاستضافة الدائمة على خادم/VPS",
        ],
        extra: "Debian/Ubuntu/Fedora/Arch/Alpine + WSL — كلها مدعومة",
      },
      {
        key: "termux",
        icon: Package,
        title: "أندرويد — Termux (متقدم)",
        badge: "خادم في جيبك",
        steps: [
          "ثبّت Termux من F-Droid أو متجر Play",
          "شغّل أمر التثبيت أدناه — سيجهّز Debian داخل proot تلقائياً",
          "خادم كامل داخل الهاتف يخدم بقية أجهزتك عبر الشبكة المحلية",
        ],
        extra: "لا يحتاج جذر (root) — بيئة معزولة وآمنة داخل Termux",
      },
    ],
    [platform]
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-10 sm:px-6">
      {/* ── الترويسة ── */}
      <header className="mb-10 text-center">
        <div className="mb-4 flex items-center justify-center gap-2">
          <Badge variant="secondary" className="gap-1.5">
            <ShieldCheck className="size-3.5" /> v4.6.6
          </Badge>
          <Badge variant="outline" className="gap-1.5">
            <Globe className="size-3.5" /> PWA جاهز
          </Badge>
          <Badge variant="outline">مفتوح المصدر · MIT</Badge>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          صيدلية رُبى على كل أجهزتك
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
          نظام واحد يعمل كتطبيق مستقل على الهاتف والحاسب والخادم — ثبّته بضغطة
          كتطبيق ويب متقدم (PWA)، أو استضفه بنفسك بأمر واحد على أي نظام.
        </p>
        {installed && (
          <div className="mx-auto mt-4 w-fit rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
            ✓ أنت تستخدم التطبيق المثبَّت الآن — شارك الرابط لتثبيته على بقية الأجهزة
          </div>
        )}
      </header>

      {/* ── بطاقة التثبيت المباشر ── */}
      <Card className="mb-10 border-primary/20 bg-gradient-to-b from-primary/5 to-transparent">
        <CardHeader className="items-center pb-2 text-center">
          <CardTitle className="flex items-center justify-center gap-2 text-xl">
            <Download className="size-5 text-primary" /> التثبيت الفوري — بلا تنزيلات
          </CardTitle>
          <CardDescription>
            هذه الصفحة نفسها هي المثبّت: متصفح حديث يضيف «صيدلية رُبى» كتطبيق
            مستقل بأيقونتها، يعمل أوفلاين للواجهة ويُحدَّث تلقائياً.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3">
          {installer ? (
            <Button
              size="lg"
              className="h-12 px-8 text-base"
              onClick={async () => {
                await installer.prompt();
                setInstaller(null);
              }}
            >
              <Download className="size-5" />
              تثبيت التطبيق الآن
            </Button>
          ) : (
            <p className="rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
              {installed
                ? "التطبيق مثبَّت بالفعل على هذا الجهاز"
                : "لتثبيت مباشر: استخدم Chrome/Edge على الحاسب والأندرويد، وSafari على الآيفون — الخطوات في البطاقات أدناه"}
            </p>
          )}
          <p className="text-xs text-muted-foreground" dir="ltr">
            {LIVE}
          </p>
        </CardContent>
      </Card>

      {/* ── بطاقات المنصات ── */}
      <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
        <MonitorSmartphone className="size-5 text-primary" />
        خطوات كل منصة
      </h2>
      <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.key} className={`flex flex-col ${highlight(c.key)}`}>
            <CardHeader className="pb-2">
              <div className="mb-1 flex items-center justify-between">
                <c.icon className="size-6 text-primary" />
                <Badge variant={c.badge === "جهازك الحالي" ? "default" : "secondary"}>
                  {c.badge}
                </Badge>
              </div>
              <CardTitle className="text-lg">{c.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-3">
              <ol className="list-inside list-decimal space-y-1.5 text-sm leading-relaxed text-muted-foreground">
                {c.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              <p className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed">
                {c.extra}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── الاستضافة الذاتية ── */}
      <h2 className="mb-1 flex items-center gap-2 text-xl font-bold">
        <Server className="size-5 text-primary" />
        خادم ذاتي الاستضافة — بأمر واحد
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        بياناتك عندك: مثبّتنا يكتشف النظام (لينكس/ماك/Termux/WSL)، يثبّت بيئة
        التشغيل، ينسخ المشروع، يسألك عن قاعدة البيانات (سحابية Neon أو محلية)،
        يطبّق الترحيلات، يبني ويشغّل — وكل القيم الحساسة تبقى محلية.
      </p>
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <CopyRow
          label="Linux · macOS · WSL · Termux (أندرويد)"
          cmd={`curl -fsSL ${RAW_SH} | bash`}
        />
        <CopyRow
          label="Windows PowerShell"
          cmd={`irm ${RAW_PS1} | iex`}
        />
      </div>
      <div className="mb-10 grid grid-cols-1 gap-4 md:grid-cols-2">
        <CopyRow
          label="Docker — خادم/VPS (بعد git clone)"
          cmd={`git clone --depth 1 ${REPO}.git\ncd ruba-pharmacy\nexport AUTH_SECRET="$(openssl rand -hex 32)"\ndocker compose up -d --build`}
        />
        <CopyRow
          label="خيارات مفيدة للمثبّت"
          cmd="bash install.sh --seed=catalog        # بذر الكتالوج للإنتاج\nbash install.sh --service             # خدمة systemd تعمل عند الإقلاع\nbash install.sh --docker              # كل شيء داخل Docker\nbash install.sh --port=8080 --no-run  # منفذ مخصص"
        />
      </div>

      <Separator className="mb-6" />

      {/* ── روابط رسمية ── */}
      <footer className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <a
          className="flex items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-muted"
          href={LIVE}
          target="_blank"
          rel="noreferrer"
        >
          <Globe className="size-4 text-primary" /> التطبيق الحي (سحابي)
        </a>
        <a
          className="flex items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-muted"
          href={`${REPO}/releases/tag/v4.6.6`}
          target="_blank"
          rel="noreferrer"
        >
          <Download className="size-4 text-primary" /> إصدار v4.6.6 (أصول التحميل)
        </a>
        <a
          className="flex items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-muted"
          href={`${REPO}/blob/main/docs/PLATFORMS.md`}
          target="_blank"
          rel="noreferrer"
        >
          <Chrome className="size-4 text-primary" /> دليل المنصات الكامل
        </a>
        <a
          className="flex items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-muted"
          href={`${REPO}/blob/main/docs/ANDROID.md`}
          target="_blank"
          rel="noreferrer"
        >
          <Smartphone className="size-4 text-primary" /> حزمة Google Play (TWA)
        </a>
      </footer>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        صيدلية رُبى — نظام إدارة صيدليات عربي متكامل · rُخَّص MIT · البيانات على
        Neon Postgres مشفّرة عبر TLS
      </p>
    </main>
  );
}
