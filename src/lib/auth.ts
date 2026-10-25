import { SignJWT, jwtVerify } from "jose";

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

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ||
    "ruba-pharmacy-dev-secret-2026-change-in-production-0d9488"
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
    .setExpirationTime("7d")
    .sign(SECRET);
}

export async function verifySession(
  token: string
): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (!payload.sub || typeof payload.role !== "string") return null;
    return {
      id: payload.sub,
      username: String(payload.username ?? ""),
      fullName: String(payload.fullName ?? ""),
      role: payload.role as Role,
    };
  } catch {
    return null;
  }
}

/** هل المستخدم يملك الحد الأدنى من الدور المطلوب؟
 * إصلاح مباشر لثغرة v2.0: الفحص مركزي وليس داخل الـ handler */
export function hasMinRole(userRole: Role, minRole: Role): boolean {
  return (ROLE_RANK[userRole] ?? 0) >= (ROLE_RANK[minRole] ?? 99);
}
