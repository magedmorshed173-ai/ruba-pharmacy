import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, SessionUser, hasMinRole, verifySession } from "./auth";

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400, extra?: object) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** استخراج المستخدم الحالي من الكوكي — يُستدعى في كل API محمي */
export async function getSessionUser(
  request?: NextRequest
): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

/** حارس مصادقة: يعيد المستخدم أو يرمي استجابة 401 */
export async function requireAuth(): Promise<
  { user: SessionUser; error: null } | { user: null; error: NextResponse }
> {
  const user = await getSessionUser();
  if (!user) return { user: null, error: fail("غير مصرح — سجّل الدخول أولاً", 401) };
  return { user, error: null };
}

/** حارس دور: إصلاح ثغرة v2.0 — الفحص مركزي قبل أي عملية حساسة */
export async function requireRole(
  minRole: "admin" | "pharmacist" | "technician"
): Promise<
  { user: SessionUser; error: null } | { user: null; error: NextResponse }
> {
  const { user, error } = await requireAuth();
  if (error) return { user: null, error };
  if (!hasMinRole(user.role, minRole))
    return {
      user: null,
      error: fail("صلاحيتك لا تسمح بهذه العملية", 403, {
        requiredRole: minRole,
      }),
    };
  return { user, error: null };
}
