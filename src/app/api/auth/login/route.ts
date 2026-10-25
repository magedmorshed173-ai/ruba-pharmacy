import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { COOKIE_NAME, signSession, Role } from "@/lib/auth";
import { fail, ok } from "@/lib/api-guard";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    if (!username || !password) return fail("اسم المستخدم وكلمة المرور مطلوبان");

    const user = await db.user.findUnique({ where: { username } });
    if (!user || !user.isActive)
      return fail("بيانات الدخول غير صحيحة أو الحساب موقوف", 401);

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return fail("بيانات الدخول غير صحيحة", 401);

    const session = {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role as Role,
    };
    const token = await signSession(session);

    const res = ok({ user: session });
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });
    return res;
  } catch {
    return fail("تعذر تسجيل الدخول", 500);
  }
}
