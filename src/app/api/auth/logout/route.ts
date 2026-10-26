import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE_NAME, revokeSessionByToken } from "@/lib/auth";
import { ok } from "@/lib/api-guard";

/**
 * POST /api/auth/logout — v3.9: الخروج الحقيقي
 * سابقاً: كان يمحو الكوكي من المتصفح فقط والتوكن يبقى حياً 7 أيام إن سُرق.
 * الآن: يسحب الجلسة من قاعدة البيانات فوراً — التوكن يميت على الخادم
 * حتى لو نُسخ نصه قبل المحو، ثم يمحو الكوكي من المتصفح.
 */
export async function POST() {
  try {
    const token = (await cookies()).get(COOKIE_NAME)?.value;
    if (token) await revokeSessionByToken(token);
  } catch {
    /* الخروج لا يفشل */
  }
  const res = ok({ message: "تم تسجيل الخروج" });
  res.cookies.set(COOKIE_NAME, "", { httpOnly: true, maxAge: 0, path: "/" });
  return res;
}
