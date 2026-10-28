/**
 * سجل التدقيق الشامل — ربي فارمسي v5.4
 * المساءلة التنظيمية (نمط SFDA: «التوثيق أساس اليقظة الدوائية»): كل عملية
 * حساسة تُوثَّق بفاعلها وسياقها — داخل نفس معاملتها حين تتوفر معاملة
 * (لا تدقيق بلا عملية)، وrecordAudit لا يُسقط العملية الرئيسة أبداً.
 *
 * المبادئ:
 *  - أنواع بنيوية (AuditLogWriter/AuditLogPruner) بدل أنواع Prisma الحرفية —
 *    تعمل مع PrismaClient وtx ومع المُحاكيات في الاختبارات بلا غموض.
 *  - userName/userRole نسختان جامدتان لحظة العملية: السجل يبقى صادقاً
 *    حتى بعد تعديل المستخدم أو حذفه لاحقاً (العلاقة onDelete: Set Null).
 *  - meta يُطبَّع عبر jsonSafeMeta إلى JSON آمن: قيم دائرية/دوال/رموز
 *    تُسقَط بصمت، وعمق مقيّد — لا استثناءات ولا حقن بنى عملاقة.
 *  - الاحتفاظ الافتراضي سنة كاملة (AUDIT_RETENTION_DAYS) — يُقلَّم تلقائياً
 *    مع اللقطة اليومية فلا ينمو الجدول بلا حدود.
 */

// ── السجل المرجعي للإجراءات (تسمية عربية موحدة للواجهة والتصدير) ──
export const AUDIT_ACTIONS = {
  "sale.void": "إلغاء فاتورة بيع",
  "batch.create": "إضافة دفعة مخزون",
  "user.create": "إضافة مستخدم",
  "user.update": "تعديل مستخدم",
  "user.deactivate": "إيقاف مستخدم",
  "user.delete": "حذف مستخدم",
  "transfer.create": "إنشاء تحويل مخزون",
  "transfer.accept": "تنفيذ تحويل مخزون",
  "transfer.cancel": "إلغاء تحويل مخزون",
} as const satisfies Record<string, string>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

/** تسمية عربية للإجراء — إجراء غير معروف يعود كما هو (لا اختفاء أبداً) */
export function auditLabel(action: string): string {
  return (AUDIT_ACTIONS as Record<string, string>)[action] ?? action;
}

/** مجموعة الإجراء = الجزء قبل النقطة (sale.void → sale) */
export function auditGroup(action: string): string {
  const i = action.indexOf(".");
  return i === -1 ? action : action.slice(0, i);
}

/** تسميات المجموعات لشرائح فلترة الواجهة */
export const AUDIT_GROUPS: Record<string, string> = {
  sale: "المبيعات",
  batch: "المخزون",
  user: "المستخدمون",
  transfer: "التحويلات",
};

// ── أنواع بنيوية دنيا — PrismaClient وtx والمحاكيات تصدّقها جميعاً ──
// AuditMeta: JSON متكرر بلا null على المستوى الأعلى — نفس مدخلات Prisma
// (null تُعالَج بحذف المفتاح كلياً في recordAudit، لا بقيمة صريحة).
export type AuditMeta =
  | string
  | number
  | boolean
  | AuditMeta[]
  | { [k: string]: AuditMeta };

export interface AuditLogCreateData {
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  meta?: AuditMeta; // يُحذف المفتاح عند انعدام القيمة
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  ip: string | null;
}

export interface AuditLogWriter {
  auditLog: {
    create: (args: { data: AuditLogCreateData }) => Promise<unknown>;
  };
}

export interface AuditLogPruner {
  auditLog: {
    deleteMany: (args: {
      where: { createdAt: { lt: Date } };
    }) => Promise<{ count: number }>;
  };
}

export interface AuditActorInfo {
  id?: string | null;
  fullName?: string | null;
  role?: string | null;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  /** وصف عربي موجز — يُقطع عند 500 محرف دفاعياً */
  summary: string;
  /** تفاصيل مرجعية تُطبَّع إلى JSON آمن */
  meta?: unknown;
  /** الفاعل من جلسة requireRole — تُجامَد نسخته في الصف */
  actor?: AuditActorInfo | null;
  ip?: string | null;
}

// ── تطبيع meta إلى JSON آمن ──
const META_MAX_DEPTH = 4;
const META_MAX_ARRAY = 50;

/**
 * تحويل أي قيمة إلى JSON قابل للتخزين: Date→ISO، bigint→نص، غير المنتهي
 * الرقمي→نص، الدوال/الرموز تُسقَط، المراجع الدائرية تُقطع، العمق مقيّد.
 * دالة نقية — لا تلمس المدخل الأصلي.
 */
export function jsonSafeMeta(value: unknown, maxDepth = META_MAX_DEPTH): AuditMeta | null {
  const seen = new Set<object>();

  function walk(v: unknown, depth: number): AuditMeta | null {
    if (v === null || v === undefined) return null;
    const t = typeof v;
    if (t === "string") return v as string;
    if (t === "boolean") return v as boolean;
    if (t === "number") return Number.isFinite(v as number) ? (v as number) : String(v);
    if (t === "bigint") return (v as bigint).toString();
    if (v instanceof Date) return v.toISOString();
    if (t !== "object" || depth >= maxDepth) return null;

    const obj = v as object;
    if (seen.has(obj)) return null; // مرجع دائري
    seen.add(obj);
    try {
      if (Array.isArray(v)) {
        return v
          .slice(0, META_MAX_ARRAY)
          .map((x) => walk(x, depth + 1)) as AuditMeta[];
      }
      const out: Record<string, AuditMeta> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (typeof val === "function" || typeof val === "symbol") continue;
        const w = walk(val, depth + 1);
        if (w !== null) out[k] = w; // null ≈ غائب — JSON للكائن بلا null داخلياً
      }
      return out;
    } finally {
      seen.delete(obj);
    }
  }

  return walk(value, 0);
}

/**
 * توثيق عملية حساسة — best-effort بحسب التصميم: أي إخفاق يُبتلع بصمت
 * فلا يُسقط العملية الرئيسة التي نُوثّقها. داخل معاملة؟ استدعِه داخلها
 * ليكون التوثيق ذرياً معها (فشل المعاملة يُسقط التدقيق معها — لا عكسه).
 */
export async function recordAudit(
  client: AuditLogWriter,
  entry: AuditEntry
): Promise<void> {
  try {
    const meta = jsonSafeMeta(entry.meta);
    await client.auditLog.create({
      data: {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        summary: entry.summary.slice(0, 500),
        // Prisma JSON لا يقبل null صريحاً — انعدام القيمة = حذف المفتاح
        ...(meta === null ? {} : { meta }),
        userId: entry.actor?.id ?? null,
        userName: entry.actor?.fullName ?? null,
        userRole: entry.actor?.role ?? null,
        ip: entry.ip ?? null,
      },
    });
  } catch {
    // التوثيق لا يُسقط العملية الرئيسة أبداً
  }
}

// ── التقليم: الاحتفاظ سنة كاملة ثم حذف الأقدم مع اللقطة اليومية ──
export const AUDIT_RETENTION_DAYS = 365;

/** حد التقليم: كل ما قبل (now − keepDays يوم) يُحذف — نقية وقابلة للاختبار */
export function pruneCutoff(now: Date, keepDays = AUDIT_RETENTION_DAYS): Date {
  return new Date(now.getTime() - keepDays * 86_400_000);
}

/** حذف سجلات التدقيق الأقدم من حد الاحتفاظ — يعيد عدد المحذوف (0 عند الإخفاق) */
export async function pruneAuditLogs(
  client: AuditLogPruner,
  now = new Date(),
  keepDays = AUDIT_RETENTION_DAYS
): Promise<number> {
  try {
    const r = await client.auditLog.deleteMany({
      where: { createdAt: { lt: pruneCutoff(now, keepDays) } },
    });
    return r.count;
  } catch {
    return 0; // التقليم خدمة صيانة — لا يُسقط مساره الأب أبداً
  }
}

// ── تحليل معاملات استعلام /api/audit (نقي — للـ API والاختبار) ──
export interface AuditQuery {
  days: number; // 1..365 (افتراضي 30)
  action: string | null; // بادئة إجراء أو إجراء كامل — بعد التطهير
  page: number; // 1..
  pageSize: number; // 1..100
}

const ACTION_SAFE = /^[a-zA-Z0-9._-]{1,40}$/;

export function parseAuditQuery(sp: URLSearchParams): AuditQuery {
  // حاضر ورقمي ⇒ يُقيَّد للنطاق؛ غائب أو غير رقمي ⇒ الافتراضي
  const num = (key: string, def: number, min: number, max: number): number => {
    const raw = sp.get(key);
    if (raw === null || raw.trim() === "") return def;
    const n = Number(raw);
    if (!Number.isFinite(n)) return def;
    return Math.max(min, Math.min(max, Math.floor(n)));
  };
  const days = num("days", 30, 1, 365);
  const rawAction = (sp.get("action") ?? "").trim();
  const action = ACTION_SAFE.test(rawAction) ? rawAction : null;
  const page = num("page", 1, 1, 1_000_000);
  const pageSize = num("pageSize", 50, 1, 100);
  return { days, action, page, pageSize };
}
