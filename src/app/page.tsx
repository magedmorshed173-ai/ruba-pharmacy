import { AppShell } from "@/components/ruba/app-shell";

// v4.6 (P2) — الترتّص الديناميكي إلزامي هنا:
// CSP بـ nonce يُحقن وقت الطلب عبر src/middleware.ts، والصفحة الثابتة
// (prerendered) لا يمكنها حمل nonce لكل طلب — توثيق Next.js الرسمي للأمان.
export const dynamic = "force-dynamic";

export default function Home() {
  return <AppShell />;
}
