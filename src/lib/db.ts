import { config } from "dotenv";

/**
 * v4.2 — تحميل .env بوضع «التجاوز»:
 * بعض البيئات المشتركة تفرض DATABASE_URL قديماً (مثل SQLite محلي) متجاوزةً
 * ملف .env — و dotenv الافتراضي لا يتجاوز المتغيرات الموجودة. هنا نضمن أن
 * قيم المشروع في .env (Neon Postgres) هي المرجع عند وجود الملف، بينما تبقى
 * متغيرات بيئة الإنتاج هي المرجع عند غياب .env (النشر السحابي القياسي).
 *
 * v4.3 — حارس عزل الاختبارات الحية:
 * حاضنة E2E تفرض DATABASE_URL مخصصاً (SQLite مؤقت) وترفع DOTENV_KEEP_ENV=1 —
 * عندها يُعطَّل التجاوز كلياً حتى لا يتسرب الاتصال إلى قاعدة الإنتاج/التطوير.
 */
config({ override: process.env.DOTENV_KEEP_ENV !== "1", quiet: true });

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? new PrismaClient({ log: ["query"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/**
 * v4.3 — ميزانيات مهل المعاملات التفاعلية على القاعدة السحابية:
 * افتراضي Prisma (maxWait=2s، timeout=5s) صُمم لقاعدة محلية؛ على Neon كل
 * جولة شبكة ~100–300ms فتنقطع معاملات نقطة البيع متعددة الخطوات
 * («Transaction not found — refers to an old closed transaction»).
 * الميزانيات تُطبق مركزياً هنا مع احترام أي خيارات صريحة من موضع النداء،
 * والمفاتيح الذرية (Idempotency + قيود فريدة) تبقى الحاجز الحقيقي ضد التكرار
 * — المهلة تحمي من القطع المبكر ولا تلغي أي ضمانة.
 */
const TX_MAX_WAIT_MS = 20_000;
const TX_TIMEOUT_MS = 60_000;
type TransactionFn = (
  arg: unknown,
  opts?: Record<string, unknown>
) => Promise<unknown>;
const prismaTx = db as unknown as { $transaction: TransactionFn };
const baseTransaction: TransactionFn = prismaTx.$transaction.bind(db);
prismaTx.$transaction = (arg: unknown, opts?: Record<string, unknown>) =>
  baseTransaction(arg, {
    maxWait: TX_MAX_WAIT_MS,
    timeout: TX_TIMEOUT_MS,
    ...(opts ?? {}),
  });

/**
 * تحسين أداء SQLite (v3.5) — يُطبق فقط عندما تكون القاعدة SQLite فعلاً
 * (تطوير محلي اختياري): WAL + busy_timeout يمنعان "database is locked".
 * مع Neon Postgres تُتجاهل بسلامة (PRAGMA غير مدعوم في PG — تُلتقط صمتاً).
 */
async function enableSqlitePerformanceMode(): Promise<void> {
  try {
    await db.$executeRawUnsafe("PRAGMA journal_mode=WAL;");
    await db.$executeRawUnsafe("PRAGMA busy_timeout=5000;");
  } catch {
    /* غير SQLite (Postgres/Neon) — تجاهل صامت */
  }
}

void enableSqlitePerformanceMode();
