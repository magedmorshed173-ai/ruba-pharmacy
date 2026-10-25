import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * تحسين أداء SQLite (v3.5):
 *  - WAL: قراءة/كتابة متزامنة — ضروري لنقطة البيع متعددة المحطات
 *  - busy_timeout=5000: يمنع أخطاء "database is locked" تحت التزامن
 * يُطبق مرة واحدة عند أول تهيئة للعميل؛ يُتجاهل بأمان إن لم تكن القاعدة SQLite.
 */
async function enableSqlitePerformanceMode(): Promise<void> {
  try {
    await db.$executeRawUnsafe("PRAGMA journal_mode=WAL;")
    await db.$executeRawUnsafe("PRAGMA busy_timeout=5000;")
  } catch {
    /* غير SQLite أو قيد التهيئة — تجاهل صامت */
  }
}
void enableSqlitePerformanceMode()
