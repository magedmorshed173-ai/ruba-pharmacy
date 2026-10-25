import type { MetadataRoute } from "next";

/**
 * بيان تطبيق الويب (PWA) — يُقدَّم تلقائياً على /manifest.webmanifest
 * Web App Manifest — served automatically at /manifest.webmanifest
 * متطلبات Google Play عبر TWA / PWABuilder مغطاة (icons 192/512 + maskable + standalone)
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ربي فارمسي — نظام إدارة الصيدليات المتكامل",
    short_name: "ربي فارمسي",
    description:
      "نظام إدارة صيدليات عربي متكامل: نقطة بيع ذكية، مخزون مُدقَّق، مرضى، فحص تداخلات دوائية حي، وتقارير — بواجهة عربية RTL.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    dir: "rtl",
    lang: "ar",
    background_color: "#FFFFFF",
    theme_color: "#0D9488",
    categories: ["medical", "business", "productivity"],
    icons: [
      { src: "/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
