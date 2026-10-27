import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";
import { verifyTotp } from "@/lib/totp";

/**
 * POST /api/auth/2fa/disable — التعطيل بكود صحيح فقط (v4.5)
 * من يملك الجهاز هو الوحيد القادر على التعطيل — كلمة المرور وحدها لا تكفي
 * (فاعلية 2FA ضد كلمة مرور مسروقة تظل قائمة حتى في هذا المسار).
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  try {
    const body = await request.json();
    const code = String(body.code ?? "");
    if (!code) return fail("كود التحقق مطلوب");

    const row = await db.user.findUnique({ where: { id: user.id } });
    if (!row?.totpEnabled || !row.totpSecret)
      return fail("التحقق بخطوتين غير مفعّل", 409);

    const { valid } = verifyTotp(row.totpSecret, code, Math.floor(Date.now() / 1000));
    if (!valid) return fail("الكود غير صحيح", 401);

    await db.user.update({
      where: { id: user.id },
      data: { totpSecret: null, totpEnabled: false },
    });
    return ok({ enabled: false });
  } catch {
    return fail("تعذر تعطيل التحقق بخطوتين", 500);
  }
}
