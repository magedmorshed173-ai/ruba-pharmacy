import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";
import { ok } from "@/lib/api-guard";

export async function POST() {
  const res = ok({ message: "تم تسجيل الخروج" });
  res.cookies.set(COOKIE_NAME, "", { httpOnly: true, maxAge: 0, path: "/" });
  return res;
}
