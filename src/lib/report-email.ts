/**
 * v5.1 — بريد اللقطات عبر Resend (HTTP خالص، بلا اعتماديات)
 *
 * تصميم «خامد حتى يُضبَط»: بلا RESEND_API_KEY أو REPORT_EMAIL_TO يُعاد
 * null من emailConfigFromEnv ولا يُرسل شيء — لا أخطاء ولا تعطيل للتوليد.
 * الإرسال best-effort دائماً: فشل البريد لا يُسقط اللقطة أبداً.
 *
 * متغيرات البيئة:
 *  • RESEND_API_KEY   — مفتاح API (resend.com).
 *  • REPORT_EMAIL_TO  — قائمة مستقبِلين مفصولة بفواصل (إجبارية مع المفتاح).
 *  • REPORT_EMAIL_FROM— المُرسِل (اختياري؛ الافتراضي عنوان onboarding الخاص بـ Resend).
 */

import { KIND_LABEL_AR, fmtAstDate, type ReportPeriod } from "./report-periods";

export interface EmailConfig {
  apiKey: string;
  from: string;
  to: string[];
}

/** يقرأ الإعداد من البيئة — null يعني «البريد غير مضبوط، تخطَّ بصمت» */
export function emailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EmailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const to = (env.REPORT_EMAIL_TO ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!apiKey || to.length === 0) return null;
  return {
    apiKey,
    from:
      env.REPORT_EMAIL_FROM?.trim() ||
      "Ruba Pharmacy <onboarding@resend.dev>",
    to,
  };
}

/* ── شكل بيانات اللقطة (JSON من القاعدة — يُقرأ دفاعياً) ────────────── */

export interface SnapshotEmailData {
  salesCount?: unknown;
  netRevenueHalalas?: unknown;
  discountHalalas?: unknown;
  voidedCount?: unknown;
  prescriptionsCount?: unknown;
  lowStockCount?: unknown;
  expiringBatches30?: unknown;
  topItems?: unknown;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** riyals عشري من هللات مخزنة */
function sar(halalas: unknown): string {
  return (num(halalas) / 100).toFixed(2);
}

interface TopItem {
  name?: unknown;
  qty?: unknown;
  subtotalHalalas?: unknown;
}

/** تهريب HTML للنصوص المدخلة (أسماء الأدوية قد تحوي & أو <) */
function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** HTML عربي RTL مختصر لنص البريد — جداول بسيطة تعمل في كل عملاء البريد */
export function snapshotEmailHtml(period: ReportPeriod, data: SnapshotEmailData): string {
  const kind = KIND_LABEL_AR[period.kind];
  const top = Array.isArray(data.topItems) ? (data.topItems as TopItem[]) : [];
  const rows = top
    .slice(0, 5)
    .map(
      (t, i) =>
        `<tr><td style="padding:4px 8px">${i + 1}. ${escHtml(String(t.name ?? "—"))}</td>` +
        `<td style="padding:4px 8px">${num(t.qty)}</td>` +
        `<td style="padding:4px 8px">${sar(t.subtotalHalalas)} ر.س</td></tr>`
    )
    .join("");
  return `<div dir="rtl" style="font-family:sans-serif;max-width:520px">
  <h2 style="margin:0 0 4px">تقرير ${kind} — صيدلية رُبى</h2>
  <p style="color:#555;margin:0 0 12px">${period.label}</p>
  <table style="border-collapse:collapse;width:100%">
    <tr><td style="padding:4px 8px;color:#555">المبيعات المكتملة</td><td style="padding:4px 8px"><b>${num(data.salesCount)}</b> فاتورة</td></tr>
    <tr><td style="padding:4px 8px;color:#555">صافي الإيراد</td><td style="padding:4px 8px"><b>${sar(data.netRevenueHalalas)} ر.س</b></td></tr>
    <tr><td style="padding:4px 8px;color:#555">الخصومات</td><td style="padding:4px 8px">${sar(data.discountHalalas)} ر.س</td></tr>
    <tr><td style="padding:4px 8px;color:#555">فواتير ملغاة</td><td style="padding:4px 8px">${num(data.voidedCount)}</td></tr>
    <tr><td style="padding:4px 8px;color:#555">وصفات جديدة</td><td style="padding:4px 8px">${num(data.prescriptionsCount)}</td></tr>
    <tr><td style="padding:4px 8px;color:#555">أصناف تحت الحد الأدنى</td><td style="padding:4px 8px">${num(data.lowStockCount)}</td></tr>
    <tr><td style="padding:4px 8px;color:#555">دفعات تنتهي خلال 30 يوماً</td><td style="padding:4px 8px">${num(data.expiringBatches30)}</td></tr>
  </table>
  ${
    rows
      ? `<h3 style="margin:14px 0 4px">أعلى الأصناف</h3>
  <table style="border-collapse:collapse;width:100%">${rows}</table>`
      : ""
  }
  <p style="color:#999;font-size:12px;margin-top:14px">تُولَّد آلياً من نظام إدارة صيدليات رُبى — ${fmtAstDate(new Date())}</p>
</div>`;
}

export type PostFn = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const defaultPost: PostFn = (url, init) => fetch(url, init);

/**
 * إرسال فعلي عبر Resend — يُرجع نتيجة ولا يرمي استثناءً أبداً.
 * `post` قابلة للحقن للاختبار.
 */
export async function sendSnapshotEmail(
  cfg: EmailConfig,
  subject: string,
  html: string,
  post: PostFn = defaultPost
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await post("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: cfg.from, to: cfg.to, subject, html }),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}
