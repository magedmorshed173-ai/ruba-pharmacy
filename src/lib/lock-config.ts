/**
 * v5.0 — إعدادات بوابة القفل الحية — قاعدة البيانات أولاً مع رجوع آمن للبيئة
 *
 * الفكرة: المدير يضبط وضع المفاتيح (admin/users) ومدة الفتح من لوحة الإعدادات
 * دون لمس Vercel، والقيم تُقرأ وقت **إصدار** مفاتيح الفتح فقط (Node runtime) —
 * بينما الـ Edge (middleware) يبقى توقيعياً بلا قاعدة بيانات:
 *  - epoch في التوكن يُقارن عددياً بـ LOCK_EPOCH البيئي (>=) — رفع قيمة البيئة
 *    يبقى رافعة السحب الطارئ العليا التي تميت كل المفاتيح على كل الأجهزة فوراً.
 *  - رفع epoch من اللوحة يخزن قيمة أعلى في القاعدة، فتُصدر المفاتيح الجديدة
 *    بها، وتفحص واجهات النقطة/الحالة عددياً ⇒ سحب فعّال من الواجهة أيضاً.
 * الكاش 30 ثانية يحمي المسارات الساخنة من قراءة قاعدة زائدة.
 */
import { db } from "./db";

export type LockMode = "admin" | "users";

export interface ResolvedLockConfig {
  mode: LockMode;
  ttlHours: number;
  /** epoch الفعلي = الأعلى بين البيئة والقاعدة (البيئة تبقى العليا) */
  epoch: string;
  /** مصدر كل قيمة — للشفافية في لوحة الإعدادات */
  source: { mode: "env" | "db"; ttl: "env" | "db"; epoch: "env" | "db" };
}

const KEY_MODE = "lock.mode";
const KEY_TTL = "lock.ttl_hours";
const KEY_EPOCH = "lock.epoch";

/** مدة الفتح من البيئة (نفس منطق system-lock.lockTtlSec) */
function envTtlHours(): number {
  const hours = Number(process.env.LOCK_TTL_HOURS ?? "4");
  return Math.min(24 * 7, Math.max(1, Number.isFinite(hours) && hours > 0 ? hours : 4));
}

function envMode(): LockMode {
  const m = (process.env.LOCK_MODE ?? "admin").trim().toLowerCase();
  return m === "users" ? "users" : "admin";
}

function envEpoch(): string {
  return process.env.LOCK_EPOCH?.trim() || "1";
}

let cache: { cfg: ResolvedLockConfig; at: number } | null = null;
const CACHE_MS = 30_000;

export function invalidateLockConfigCache(): void {
  cache = null;
}

/** يقرأ الإعدادات الفعلية — القاعدة تُعاوي البيئة، وepoch يُؤخذ بالأعلى عددياً */
export async function getLockConfig(force = false): Promise<ResolvedLockConfig> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.cfg;

  let mode = envMode();
  let ttl = envTtlHours();
  const source: ResolvedLockConfig["source"] = { mode: "env", ttl: "env", epoch: "env" };
  let epochNum = Number(envEpoch()) || 1;

  try {
    const rows = await db.systemSetting.findMany({
      where: { key: { in: [KEY_MODE, KEY_TTL, KEY_EPOCH] } },
    });
    for (const row of rows) {
      if (row.key === KEY_MODE) {
        const v = row.value.trim().toLowerCase();
        if (v === "users" || v === "admin") {
          // القاعدة مصدر الحقيقة بعد أول حفظ من اللوحة
          source.mode = "db";
          mode = v as LockMode;
        }
      } else if (row.key === KEY_TTL) {
        const v = Number(row.value);
        if (Number.isFinite(v) && v >= 1 && v <= 24 * 7) {
          source.ttl = "db";
          ttl = v;
        }
      } else if (row.key === KEY_EPOCH) {
        const v = Number(row.value);
        if (Number.isFinite(v) && v > epochNum) {
          source.epoch = "db";
          epochNum = v;
        }
      }
    }
  } catch {
    // قاعدة غير متاحة ⇒ البيئة فقط (fail-closed على القيم الافتراضية المتحصنة)
  }

  const cfg: ResolvedLockConfig = {
    mode,
    ttlHours: ttl,
    epoch: String(epochNum),
    source,
  };
  cache = { cfg, at: Date.now() };
  return cfg;
}

/** حفظ من لوحة المدير — upsert مُدقَّق ثم تفريغ الكاش */
export async function setLockConfig(
  partial: { mode?: LockMode; ttlHours?: number },
  updatedBy: string
): Promise<ResolvedLockConfig> {
  const ops: Promise<unknown>[] = [];
  if (partial.mode) {
    ops.push(
      db.systemSetting.upsert({
        where: { key: KEY_MODE },
        update: { value: partial.mode, updatedBy },
        create: { key: KEY_MODE, value: partial.mode, updatedBy },
      })
    );
  }
  if (partial.ttlHours != null) {
    const v = Math.min(24 * 7, Math.max(1, Math.round(partial.ttlHours)));
    ops.push(
      db.systemSetting.upsert({
        where: { key: KEY_TTL },
        update: { value: String(v), updatedBy },
        create: { key: KEY_TTL, value: String(v), updatedBy },
      })
    );
  }
  await Promise.all(ops);
  invalidateLockConfigCache();
  return getLockConfig(true);
}

/** سحب كل مفاتيح الفتح الصادرة — رفع epoch القاعدة فوق أي قيمة قائمة */
export async function bumpLockEpoch(updatedBy: string): Promise<string> {
  const next = String(Date.now());
  await db.systemSetting.upsert({
    where: { key: KEY_EPOCH },
    update: { value: next, updatedBy },
    create: { key: KEY_EPOCH, value: next, updatedBy },
  });
  invalidateLockConfigCache();
  return next;
}
