import { config } from "dotenv";

/**
 * v4.2 — تحميل .env بوضع «التجاوز»:
 * بعض البيئات المشتركة تفرض DATABASE_URL قديماً (مثل SQLite محلي) متجاوزةً
 * ملف .env — و dotenv الافتراضي لا يتجاوز المتغيرات الموجودة. هنا نضمن أن
 * قيم المشروع في .env (Neon Postgres) هي المرجع عند وجود الملف، بينما تبقى
 * متغيرات بيئة الإنتاج هي المرجع عند غياب .env (النشر السحابي القياسي).
 */
config({ override: true, quiet: true });

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? new PrismaClient({ log: ["query"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

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
