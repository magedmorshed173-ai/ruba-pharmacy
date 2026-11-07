import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/auth";

/**
 * v5.6 — إلغاء جلسة جرد (مدير حصراً)
 * الجلسة المفتوحة فقط — لا مساس بأي مخزون، والبنود المجمّدة تبقى للسجل.
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
    const number = await db.$transaction(async (tx) => {
      const count = await tx.stockCount.findUnique({ where: { id } });
      if (!count) throw new Error("NOT_FOUND");
      if (count.status !== "open") throw new Error("NOT_OPEN");

      await tx.stockCount.update({
        where: { id },
        data: { status: "cancelled", closedById: user.id, closedAt: new Date() },
      });

      recordAudit(tx, {
        action: "stocktake.cancel",
        entityType: "stockCount",
        entityId: id,
        summary: `إلغاء جلسة جرد ${count.number} (${count.batchesTotal} دفعة)`,
        meta: { number: count.number, batchesTotal: count.batchesTotal },
        actor: user,
        ip: clientIp(request.headers),
      });

      return count.number;
    });

    return ok({ ok: true, number });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "NOT_FOUND") return fail("جلسة الجرد غير موجودة", 404);
    if (msg === "NOT_OPEN") return fail("الجلسة ليست مفتوحة — لا إلغاء بعد التطبيق", 409);
    console.error("stocktake cancel failed:", e);
    return fail("تعذر إلغاء الجلسة", 500);
  }
}
