import { describe, it, expect, vi } from "vitest";
import {
  AUDIT_ACTIONS,
  AUDIT_GROUPS,
  auditLabel,
  auditGroup,
  jsonSafeMeta,
  recordAudit,
  pruneCutoff,
  pruneAuditLogs,
  parseAuditQuery,
  AUDIT_RETENTION_DAYS,
  type AuditLogCreateData,
} from "@/lib/audit";

// ── محاكاة كاتب بنيوية — تلتقط ما يُكتب دون لمس Prisma ──
function fakeWriter() {
  const rows: AuditLogCreateData[] = [];
  return {
    rows,
    auditLog: {
      create: vi.fn(async ({ data }: { data: AuditLogCreateData }) => {
        rows.push(data);
        return data;
      }),
    },
  };
}

describe("audit — السجل المرجعي والتسميات", () => {
  it("لكل إجراء في السجل تسمية عربية غير فارغة", () => {
    for (const [action, label] of Object.entries(AUDIT_ACTIONS)) {
      expect(label.length).toBeGreaterThan(0);
      expect(auditLabel(action)).toBe(label);
    }
  });

  it("إجراء غير معروف يعود كما هو — لا اختفاء في العرض", () => {
    expect(auditLabel("future.thing")).toBe("future.thing");
    expect(auditLabel("")).toBe("");
  });

  it("auditGroup يستخرج البادئة قبل النقطة ويتسامح مع غيابها", () => {
    expect(auditGroup("sale.void")).toBe("sale");
    expect(auditGroup("transfer.accept")).toBe("transfer");
    expect(auditGroup("plain")).toBe("plain");
  });

  it("كل مجموعة إجراءات معروفة لها تسمية مجموعة للواجهة", () => {
    const groups = new Set(Object.keys(AUDIT_ACTIONS).map(auditGroup));
    for (const g of groups) {
      expect(AUDIT_GROUPS[g]).toBeTruthy();
    }
  });
});

describe("audit — jsonSafeMeta تطبيع JSON الآمن", () => {
  it("يمرر الأنواع البسيطة ويحول Date وbigint", () => {
    expect(jsonSafeMeta("نص")).toBe("نص");
    expect(jsonSafeMeta(42)).toBe(42);
    expect(jsonSafeMeta(true)).toBe(true);
    expect(jsonSafeMeta(null)).toBeNull();
    expect(jsonSafeMeta(new Date("2026-01-02T03:04:05Z"))).toBe("2026-01-02T03:04:05.000Z");
    expect(jsonSafeMeta(BigInt(10))).toBe("10");
  });

  it("يقطع المرجع الدائري دون استثناء", () => {
    const a: Record<string, unknown> = { name: "دائري" };
    a.self = a;
    expect(jsonSafeMeta(a)).toEqual({ name: "دائري" }); // self أُسقط
  });

  it("يحترم حد العمق ويحصر طول المصفوفة", () => {
    const deep = { l1: { l2: { l3: { l4: { l5: "بعيد" } } } } };
    // العمق 4 يُقذف بعد l3 — ما تحته يُسقط فتصير l3 كائناً فارغاً
    expect(jsonSafeMeta(deep)).toEqual({ l1: { l2: { l3: {} } } });
    const long = Array.from({ length: 80 }, (_, i) => i);
    expect((jsonSafeMeta(long) as number[]).length).toBe(50);
  });

  it("يسقط الدوال والرموز وغير المنتهي الرقمي", () => {
    expect(jsonSafeMeta({ fn: () => 1, sym: Symbol("s"), inf: Infinity, ok: 1 })).toEqual({
      ok: 1,
      inf: "Infinity",
    });
  });
});

describe("audit — recordAudit", () => {
  it("يكتب حقول الصف كاملة مع تجميد نسخة الفاعل", async () => {
    const w = fakeWriter();
    await recordAudit(w, {
      action: "sale.void",
      entityType: "sale",
      entityId: "sale-1",
      summary: "إلغاء الفاتورة REF-1",
      meta: { reference: "REF-1", netAmount: 2300 },
      actor: { id: "u1", fullName: "أحمد", role: "admin" },
      ip: "1.2.3.4",
    });
    expect(w.rows[0]).toEqual({
      action: "sale.void",
      entityType: "sale",
      entityId: "sale-1",
      summary: "إلغاء الفاتورة REF-1",
      meta: { reference: "REF-1", netAmount: 2300 },
      userId: "u1",
      userName: "أحمد",
      userRole: "admin",
      ip: "1.2.3.4",
    });
  });

  it("meta الفارغ يحذف المفتاح كلياً (Prisma JSON لا يقبل null صريحاً)", async () => {
    const w = fakeWriter();
    await recordAudit(w, { action: "user.create", entityType: "user", summary: "س" });
    expect("meta" in w.rows[0]).toBe(false);
  });

  it("الملخص يُقطع عند 500 محرف دفاعياً", async () => {
    const w = fakeWriter();
    await recordAudit(w, {
      action: "user.update",
      entityType: "user",
      summary: "س".repeat(700),
    });
    expect(w.rows[0].summary.length).toBe(500);
  });

  it("إخفاق الكاتب يُبتلع — لا استثناء يُسقط العملية الرئيسة", async () => {
    const failing = {
      auditLog: {
        create: vi.fn(async () => {
          throw new Error("DB down");
        }),
      },
    };
    await expect(
      recordAudit(failing, { action: "sale.void", entityType: "sale", summary: "س" })
    ).resolves.toBeUndefined();
  });
});

describe("audit — التقليم", () => {
  it("حد التقليم = الآن ناقص أيام الاحتفاظ (365 افتراضياً)", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    expect(pruneCutoff(now).getTime()).toBe(now.getTime() - 365 * 86_400_000);
    expect(pruneCutoff(now, 7).getTime()).toBe(now.getTime() - 7 * 86_400_000);
    expect(AUDIT_RETENTION_DAYS).toBe(365);
  });

  it("pruneAuditLogs يحذف ما قبل الحد ويعيد العدد، والإخفاق يعيد صفراً", async () => {
    let captured: Date | null = null;
    const ok = {
      auditLog: {
        deleteMany: vi.fn(async (args: { where: { createdAt: { lt: Date } } }) => {
          captured = args.where.createdAt.lt;
          return { count: 7 };
        }),
      },
    };
    await expect(pruneAuditLogs(ok as never, new Date("2026-10-28T00:00:00Z"))).resolves.toBe(7);
    expect(captured).toEqual(new Date("2025-10-28T00:00:00Z"));

    const failing = {
      auditLog: {
        deleteMany: vi.fn(async () => {
          throw new Error("x");
        }),
      },
    };
    await expect(pruneAuditLogs(failing as never)).resolves.toBe(0);
  });
});

describe("audit — parseAuditQuery (فلاتر /api/audit)", () => {
  const sp = (s: string) => new URLSearchParams(s);

  it("الافتراضي: 30 يوماً، بلا إجراء، صفحة 1 بحجم 50", () => {
    expect(parseAuditQuery(sp(""))).toEqual({
      days: 30,
      action: null,
      page: 1,
      pageSize: 50,
    });
  });

  it("يقيّد النطاق: الأيام 1..365 وحجم الصفحة 1..100 والصفحة ≥ 1", () => {
    expect(parseAuditQuery(sp("days=9999")).days).toBe(365);
    expect(parseAuditQuery(sp("days=0")).days).toBe(1);
    expect(parseAuditQuery(sp("pageSize=500")).pageSize).toBe(100);
    expect(parseAuditQuery(sp("page=-3")).page).toBe(1);
    expect(parseAuditQuery(sp("days=abc")).days).toBe(30);
  });

  it("يطهر الإجراء: حروف/أرقام/نقطة/شرطة فقط — ما عداه يُسقط", () => {
    expect(parseAuditQuery(sp("action=sale.void")).action).toBe("sale.void");
    expect(parseAuditQuery(sp("action=sale")).action).toBe("sale");
    expect(parseAuditQuery(sp("action=DROP TABLE")).action).toBeNull();
    expect(parseAuditQuery(sp("action=")).action).toBeNull();
  });
});
