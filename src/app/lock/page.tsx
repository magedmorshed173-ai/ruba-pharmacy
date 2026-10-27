import type { Metadata } from "next";
import { Suspense } from "react";
import { LockClient } from "./lock-client";

/**
 * v4.7 — شاشة قفل النظام: أول ما يراه أي مستقبل للنظام.
 * الترتّص الديناميكي إلزامي (CSP بـ nonce عبر middleware) — نمط page.tsx.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "قفل النظام · ربي فارمسي",
  description: "النظام محمي بمفتاح مدير النظام — أدخل المفتاح للمتابعة",
  robots: { index: false, follow: false },
};

export default function LockPage() {
  return (
    <Suspense fallback={null}>
      <LockClient />
    </Suspense>
  );
}
