import { describe, it, expect } from "vitest";
import {
  emailConfigFromEnv,
  sendSnapshotEmail,
  snapshotEmailHtml,
  type EmailConfig,
} from "@/lib/report-email";
import { periodFor } from "@/lib/report-periods";

/** بيئة اختبار معزولة */
function env(vars: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

describe("report-email — بريد اللقطات (خامد حتى يُضبَط)", () => {
  it("بلا مفاتيح يعيد null — لا بريد ولا خطأ", () => {
    expect(emailConfigFromEnv(env({}))).toBeNull();
    expect(emailConfigFromEnv(env({ RESEND_API_KEY: "re_x" }))).toBeNull(); // بلا مستقبلين
    expect(emailConfigFromEnv(env({ REPORT_EMAIL_TO: "a@b.c" }))).toBeNull(); // بلا مفتاح
  });

  it("يقرأ الإعداد كاملاً عند ضبط المفتاح والمستقبلين", () => {
    const cfg = emailConfigFromEnv(
      env({
        RESEND_API_KEY: " re_x ",
        REPORT_EMAIL_TO: "a@b.c, d@e.f ,",
        REPORT_EMAIL_FROM: "Ruba <no-reply@ruba.sa>",
      })
    );
    expect(cfg).toEqual({
      apiKey: "re_x",
      from: "Ruba <no-reply@ruba.sa>",
      to: ["a@b.c", "d@e.f"],
    });
  });

  it("الافتراضي للمُرسِل عنوان Resend التجريبي", () => {
    const cfg = emailConfigFromEnv(
      env({ RESEND_API_KEY: "re_x", REPORT_EMAIL_TO: "a@b.c" })
    ) as EmailConfig;
    expect(cfg.from).toContain("onboarding@resend.dev");
  });

  it("snapshotEmailHtml يبني RTL عربياً بالأرقام الصحيحة بالريال", () => {
    const period = periodFor("daily", new Date("2026-10-27T21:30:00Z"));
    const html = snapshotEmailHtml(period, {
      salesCount: 12,
      netRevenueHalalas: 34550,
      discountHalalas: 250,
      voidedCount: 1,
      prescriptionsCount: 7,
      lowStockCount: 3,
      expiringBatches30: 2,
      topItems: [
        { name: "بانادول & إكسترا", qty: 30, subtotalHalalas: 12000 },
      ],
    });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("تقرير يومي — صيدلية رُبى");
    expect(html).toContain("345.50 ر.س");
    expect(html).toContain("2.50 ر.س");
    expect(html).toContain("بانادول &amp; إكسترا"); // تهريب XML
    expect(html).toContain(period.label);
  });

  it("topItems غير المصفوفة يُعامَل بأمان (دفاعياً)", () => {
    const period = periodFor("weekly", new Date("2026-10-27T21:30:00Z"));
    const html = snapshotEmailHtml(period, { topItems: "not-an-array" });
    expect(html).not.toContain("أعلى الأصناف");
    expect(html).toContain("تقرير أسبوعي");
  });

  it("sendSnapshotEmail يرسل POST إلى Resend بالترويسة الصحيحة", async () => {
    const calls: { url: string; init: Record<string, unknown> }[] = [];
    const post = async (url: string, init: { body: string }) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => "{}" };
    };
    const cfg: EmailConfig = {
      apiKey: "re_secret",
      from: "Ruba <no-reply@ruba.sa>",
      to: ["a@b.c", "d@e.f"],
    };
    const res = await sendSnapshotEmail(cfg, "الموضوع", "<p>النص</p>", post);
    expect(res.ok).toBe(true);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.from).toBe(cfg.from);
    expect(body.to).toEqual(["a@b.c", "d@e.f"]);
    expect(body.subject).toBe("الموضوع");
  });

  it("فشل HTTP لا يرمي استثناء — يعيد الخطأ فقط", async () => {
    const post = async () => ({
      ok: false,
      status: 422,
      text: async () => "validation error",
    });
    const res = await sendSnapshotEmail(
      { apiKey: "k", from: "f", to: ["t@x.y"] },
      "s",
      "<p>h</p>",
      post
    );
    expect(res).toEqual({ ok: false, error: "HTTP 422" });
  });

  it("انقطاع الشبكة لا يرمي استثناء", async () => {
    const post = async () => {
      throw new Error("ECONNREFUSED");
    };
    const res = await sendSnapshotEmail(
      { apiKey: "k", from: "f", to: ["t@x.y"] },
      "s",
      "<p>h</p>",
      post
    );
    expect(res).toEqual({ ok: false, error: "ECONNREFUSED" });
  });
});
