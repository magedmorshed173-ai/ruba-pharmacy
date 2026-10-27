import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";
import { verifyTotp } from "@/lib/totp";

/**
 * POST /api/auth/2fa/enable — تأكيد التفعيل بالكود (v4.5)
 * يُقبل فقط كود صحيح للسرّ المحفوظ من setup — والحساب ذو دورة كاملة:
 * setup (سر معلق) ← enable بالكود (مفعّل) ← disable بالكود (معطل).
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  try {
    const body = await request.json();
    const code = String(body.code ?? "");
    if (!code) return fail("كود التحقق مطلوب");

    const row = await db.user.findUnique({ where: { id: user.id } });
    if (!row?.totpSecret)
      return fail("ابدأ بالتهيئة أولاً — لا يوجد سرّ محفوظ", 409);
    if (row.totpEnabled) return fail("التحقق بخطوتين مفعّل مسبقاً", 409);

    const { valid } = verifyTotp(row.totpSecret, code, Math.floor(Date.now() / 1000));
    if (!valid)
      return fail("الكود غير صحيح — تأكد من تطابق ساعة الجهاز وأعد المحاولة", 401);

    await db.user.update({
      where: { id: user.id },
      data: { totpEnabled: true },
    });
    return ok({ enabled: true });
  } catch {
    return fail("تعذر تفعيل التحقق بخطوتين", 500);
  }
}
