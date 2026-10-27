"use client";

import { useEffect } from "react";

/**
 * v4.8 — تسجيل الـ Service Worker للعمل دون اتصال (PWA كاملة)
 * الإنتاج فقط — في التطوير يعطل التسجيل حتى لا يتعارض مع HMR.
 * التسجيل بعد استقرار الصفحة (1.5 ثانية) كي لا ينافس تحميلها الأول.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const t = window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* التسجيل الفاشل لا يعطل التطبيق — يعمل كالمعتاد عبر الشبكة */
      });
    }, 1500);
    return () => window.clearTimeout(t);
  }, []);

  return null;
}
