import { SignJWT, jwtVerify } from "jose";
import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";

export type Role = "admin" | "pharmacist" | "technician";

export const ROLE_RANK: Record<Role, number> = {
  technician: 1,
  pharmacist: 2,
  admin: 3,
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: "مدير النظام",
  pharmacist: "صيدلي",
  technician: "فني صيدلة",
};

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
}

// ── v4.4.1 (P0): fail-closed ──
// الإنتاج بلا AUTH_SECRET يتوقف فوراً بدل توقيع التوكنات بسرّ احتياطي
// مكشوف في الريبو العام. الاحتياطي للتطوير فقط. استثناء phase-production-build
// ضروري لأن next build يقيّم الوحدات مع NODE_ENV=production.
const DEV_FALLBACK_SECRET =
  "ruba-pharmacy-dev-secret-2026-change-in-production-0d9488";

if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  !process.env.AUTH_SECRET
) {
  throw new Error(
    "رفض التشغيل: AUTH_SECRET مطلوب في الإنتاج — اضبط المتغير (32+ حرفاً عشوائياً) ثم أعد التشغيل"
  );
}

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || DEV_FALLBACK_SECRET
);

const COOKIE_NAME = "ruba_token";
export { COOKIE_NAME };

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({
    sub: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    // jti فريد لكل دخول — دخولان في نفس الثانية لا ينتجان توكناً متطابقاً
    // (فريدية tokenHash في جدول الجلسات لا تُخترق أبداً)
    .setJti(randomUUID())
    .setExpirationTime("7d")
    .sign(SECRET);
}

// ── v3.9: جلسات قابلة للسحب + ربط الجهاز ──
// التوكن التوقيعي وحده لم يعد كافياً: من يسرق نصه يستخدمه من أي جهاز
// حتى انتهاء صلاحيته. الحل: كل توكن يقابله صف Session في قاعدة
// البيانات — بلا صف أو صف مسحوب = ميت فوراً، وبصمة الجهاز داخل
// الصف ترفض استخدام التوكن من متصفح آخر.

/** SHA-256 للتوكن — لا يُخزن التوكن الخام في القاعدة أبداً */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** بصمة الجهاز من User-Agent */
export function hashDevice(ua: string | null | undefined): string | null {
  const s = (ua ?? "").trim();
  if (!s) return null;
  return createHash("sha256").update(s).digest("hex");
}

/** تسجيل جلسة جديدة عند الدخول — التوكن بلا صف لا يُعترف به */
export async function createSession(params: {
  token: string;
  userId: string;
  deviceHash: string | null;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  await db.session.create({
    data: {
      userId: params.userId,
      tokenHash: hashToken(params.token),
      deviceHash: params.deviceHash,
      ip: params.ip?.slice(0, 64) || null,
      userAgent: params.userAgent?.slice(0, 250) || null,
    },
  });
}

/**
 * تحقق الجلسة الكامل: توقيع + صلاحية + صف حي في القاعدة + تطابق الجهاز
 * + الدور يُقرأ من قاعدة البيانات لحظياً (إيقاف الحساب أو تغيير دوره يسري فوراً).
 * فشل أي شرط = null (401) — لا استثناءات تسريب هنا.
 */
export async function verifySession(
  token: string,
  deviceHash?: string | null
): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (!payload.sub || typeof payload.role !== "string") return null;

    const row = await db.session.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!row || row.revokedAt) return null;
    // ربط الجهاز: جلسة مسجلة لجهاز لا تُقبل من جهاز آخر
    if (row.deviceHash && deviceHash && row.deviceHash !== deviceHash) return null;

    const user = await db.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) return null;

    // آخر استخدام — بلا انتظار (تجاهل فشلها لا يؤثر على القرار)
    if (Date.now() - row.lastUsedAt.getTime() > 300_000)
      void db.session
        .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {});

    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role as Role,
    };
  } catch {
    return null;
  }
}

/** سحب الجلسة الحالية (تسجيل الخروج) — التوكن يميت فوراً على الخادم */
export async function revokeSessionByToken(token: string): Promise<void> {
  try {
    await db.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch {
    /* الخروج لا يفشل بسبب القاعدة */
  }
}

/**
 * سحب كل جلسات مستخدم — عند تغيير كلمة المرور أو إيقاف الحساب أو
 * «إنهاء كل الأجهزة». exceptTokenHash: إبقاء جلسة الطلب الحالي.
 */
export async function revokeAllUserSessions(
  userId: string,
  exceptTokenHash?: string
): Promise<number> {
  const r = await db.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptTokenHash ? { tokenHash: { not: exceptTokenHash } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return r.count;
}


/** هل المستخدم يملك الحد الأدنى من الدور المطلوب؟
 * إصلاح مباشر لثغرة v2.0: الفحص مركزي وليس داخل الـ handler */
export function hasMinRole(userRole: Role, minRole: Role): boolean {
  return (ROLE_RANK[userRole] ?? 0) >= (ROLE_RANK[minRole] ?? 99);
}
