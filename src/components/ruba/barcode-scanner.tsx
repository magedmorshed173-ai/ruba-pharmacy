"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScanLine, Loader2 } from "lucide-react";

// BarcodeDetector API — مدعوم في Chrome/Android (هدف PWA الأساسي)
type DetectedBarcode = { rawValue: string };
interface BarcodeDetectorLike {
  detect: (src: HTMLVideoElement) => Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

const FORMATS = ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "qr_code"];

/** ماسح باركود بالكاميرا (v3.4) — BarcodeDetector API مع معالجة صلاحيات لطيفة */
export function BarcodeScanner({
  onScan,
  disabled,
}: {
  onScan: (code: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"init" | "scanning" | "unsupported" | "denied" | "error">("init");
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void) | null>(null);

  function cleanup() {
    stopRef.current?.();
    stopRef.current = null;
  }

  useEffect(() => {
    if (!open) return;
    const Ctor: BarcodeDetectorCtor | undefined = (window as unknown as {
      BarcodeDetector?: BarcodeDetectorCtor;
    }).BarcodeDetector;

    if (!Ctor) {
      setState("unsupported");
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    const detector = new Ctor({ formats: FORMATS });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setState("scanning");

        const timer = setInterval(async () => {
          if (video.readyState < 2) return;
          try {
            const hits = await detector.detect(video);
            const hit = hits.find((h) => h.rawValue?.trim());
            if (hit) {
              cleanup();
              setOpen(false);
              onScan(hit.rawValue.trim());
            }
          } catch {
            /* إطار غير قابل للقراءة — تابع */
          }
        }, 250);

        stopRef.current = () => {
          clearInterval(timer);
          stream?.getTracks().forEach((t) => t.stop());
        };
      } catch (e) {
        if (cancelled) return;
        if (e instanceof DOMException && e.name === "NotAllowedError")
          setState("denied");
        else setState("error");
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [open]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="absolute end-2 top-1/2 size-7 -translate-y-1/2"
        title="مسح باركود بالكاميرا"
        disabled={disabled}
        onClick={() => {
          setState("init");
          setOpen(true);
        }}
      >
        <ScanLine className="size-4 text-teal-600" />
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanLine className="size-5 text-teal-600" /> مسح باركود
            </DialogTitle>
            <DialogDescription>
              وجّه الكاميرا نحو باركود الدواء — يُضاف للسلة تلقائياً
            </DialogDescription>
          </DialogHeader>

          {state === "init" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="size-7 animate-spin text-teal-600" />
              <p className="text-sm text-muted-foreground">جارٍ تشغيل الكاميرا…</p>
            </div>
          )}

          {state === "scanning" && (
            <div className="overflow-hidden rounded-xl border bg-black">
              <video ref={videoRef} className="h-64 w-full object-cover" muted playsInline />
              <div className="bg-teal-600/90 py-1.5 text-center text-xs font-bold text-white">
                بانتظار الباركود…
              </div>
            </div>
          )}

          {state === "unsupported" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
              متصفحك لا يدعم المسح بالكاميرا — استخدم Chrome على أندرويد، أو القارئ الخارجي
              الذي يكتب في حقل البحث مباشرة.
            </div>
          )}

          {state === "denied" && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
              تم رفض الوصول للكاميرا — اسمح به من إعدادات المتصفح ثم أعد المحاولة.
            </div>
          )}

          {state === "error" && (
            <div className="rounded-lg border p-4 text-sm text-muted-foreground">
              تعذر تشغيل الكاميرا — تأكد أن جهازاً آخر لا يستخدمها.
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
