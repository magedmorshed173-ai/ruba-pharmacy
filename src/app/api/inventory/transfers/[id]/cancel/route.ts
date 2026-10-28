import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";

/**
 * v5.2 — إلغاء تحويل معلّق (مدير حصراً) — لا أثر على أي أرصدة (لم تُنفَّذ).
 */

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireRole("admin");
  if (error) return error;

  const { id } = await params;
  try {
    const transfer = await db.stockTransfer.findUnique({ where: { id } });
    if (!transfer) return fail("التحويل غير موجود", 404);
    if (transfer.status !== "pending")
      return fail("التحويل منفَّذ أو ملغى مسبقاً");

    const updated = await db.stockTransfer.update({
      where: { id },
      data: { status: "cancelled", acceptedByUserId: user.id, acceptedAt: new Date() },
      include: {
        medicine: { select: { name: true } },
        fromBranch: { select: { name: true } },
        toBranch: { select: { name: true } },
      },
    });
    return ok({ transfer: updated });
  } catch {
    return fail("تعذر إلغاء التحويل", 500);
  }
}
