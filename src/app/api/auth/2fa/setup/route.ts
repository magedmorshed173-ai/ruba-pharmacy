import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";
import { generateTotpSecret, otpauthUri } from "@/lib/totp";

/**
 * POST /api/auth/2fa/setup — تهيئة TOTP (v4.5)
 * يولّد سرّاً ويحفظه على الحساب (totpEnabled تبقى false إلى التأكيد) ويعيد
 * otpauth URI لعرضه QR. إعادة الاستدعاء تُعيد التوليد (استبدال آمن).
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  try {
    const secret = generateTotpSecret();
    await db.user.update({
      where: { id: user.id },
      data: { totpSecret: secret, totpEnabled: false },
    });
    return ok({
      secret,
      otpauthUri: otpauthUri({
        issuer: "ربي فارمسي",
        label: user.username,
        secret,
      }),
      enabled: false,
    });
  } catch {
    return fail("تعذر تهيئة التحقق بخطوتين", 500);
  }
}
