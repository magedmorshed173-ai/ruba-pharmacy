import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/auth";

/**
 * v5.2 — إلغاء تحويل معلّق (مدير حصراً) — لا أثر على أي أرصدة (لم تُنفَّذ).
 */

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
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

    // v5.4 — الإلغاء وتوثيقه في معاملة واحدة (لا أثر أرصدة — لم تُنفَّذ)
    const updated = await db.$transaction(async (tx) => {
      const t = await tx.stockTransfer.update({
        where: { id },
        data: { status: "cancelled", acceptedByUserId: user.id, acceptedAt: new Date() },
        include: {
          medicine: { select: { name: true } },
          fromBranch: { select: { name: true } },
          toBranch: { select: { name: true } },
        },
      });
      await recordAudit(tx, {
        action: "transfer.cancel",
        entityType: "transfer",
        entityId: id,
        summary: `إلغاء تحويل ${t.quantity} ${t.medicine.name} إلى ${t.toBranch.name}`, // المصدر: null = المستودع المركزي
        meta: {
          medicine: t.medicine.name,
          quantity: t.quantity,
          from: t.fromBranch?.name ?? "المستودع المركزي",
          to: t.toBranch.name,
        },
        actor: user,
        ip: clientIp(request.headers),
      });
      return t;
    });
    return ok({ transfer: updated });
  } catch {
    return fail("تعذر إلغاء التحويل", 500);
  }
}
