import { requireAuth, fail, ok } from "@/lib/api-guard";
import { db } from "@/lib/db";

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;
  try {
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        isActive: true,
        totpEnabled: true, // v4.5 — حالة التحقق بخطوتين للإعدادات
      },
    });
    if (!dbUser || !dbUser.isActive) return fail("الحساب غير فعال", 401);
    return ok({ user: dbUser });
  } catch {
    return ok({ user });
  }
}
