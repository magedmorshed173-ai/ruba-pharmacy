import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth, requireRole } from "@/lib/api-guard";
import { validateTransferInput } from "@/lib/transfers";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/auth";

/**
 * v5.2 — تحويلات المخزون بين الفروع
 *
 * GET  /api/inventory/transfers[?status=pending] — آخر 50 تحويلاً (صيدلي فما فوق)
 * POST /api/inventory/transfers                 — إنشاء تحويل معلّق (مدير حصراً)
 *
 * الدلالة: fromBranchId = null يعني «من غير المخصص في المستودع المركزي».
 * التنفيذ الفعلي للكميات يحدث عند القبول فقط — لا لمس للمخزون عند الإنشاء.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { error } = await requireRole("pharmacist");
  if (error) return error;

  const status = request.nextUrl.searchParams.get("status");
  const where =
    status && ["pending", "accepted", "cancelled"].includes(status)
      ? { status }
      : undefined;

  const transfers = await db.stockTransfer.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      medicine: { select: { name: true, barcode: true } },
      fromBranch: { select: { name: true } },
      toBranch: { select: { name: true } },
      createdBy: { select: { username: true } },
      acceptedBy: { select: { username: true } },
    },
  });
  return ok({ transfers });
}

export async function POST(request: NextRequest) {
  const { user, error } = await requireRole("admin");
  if (error) return error;

  try {
    const body = await request.json();
    const input = {
      medicineId: String(body.medicineId ?? "").trim(),
      fromBranchId: body.fromBranchId ? String(body.fromBranchId).trim() : null,
      toBranchId: String(body.toBranchId ?? "").trim(),
      quantity: Number(body.quantity),
      note: body.note ? String(body.note).slice(0, 300) : null,
    };

    const v = validateTransferInput(input);
    if (!v.ok) return fail(v.error);

    const [medicine, toBranch] = await Promise.all([
      db.medicine.findUnique({ where: { id: input.medicineId }, select: { id: true, isActive: true } }),
      db.branch.findUnique({ where: { id: input.toBranchId }, select: { id: true, isActive: true } }),
    ]);
    if (!medicine || !medicine.isActive) return fail("الدواء غير موجود أو مؤرشف", 404);
    if (!toBranch || !toBranch.isActive) return fail("الفرع المستلم غير موجود أو موقوف", 404);
    if (input.fromBranchId) {
      const fromBranch = await db.branch.findUnique({
        where: { id: input.fromBranchId },
        select: { isActive: true },
      });
      if (!fromBranch || !fromBranch.isActive) return fail("فرع المصدر غير موجود أو موقوف", 404);
    }

    // v5.4 — الإنشاء وتوثيقه في معاملة واحدة: لا تحويل بلا أثر مساءلة
    const transfer = await db.$transaction(async (tx) => {
      const t = await tx.stockTransfer.create({
        data: {
          medicineId: input.medicineId,
          fromBranchId: input.fromBranchId,
          toBranchId: input.toBranchId,
          quantity: Math.floor(input.quantity),
          note: input.note,
          createdByUserId: user.id,
        },
        include: {
          medicine: { select: { name: true } },
          fromBranch: { select: { name: true } },
          toBranch: { select: { name: true } },
        },
      });
      await recordAudit(tx, {
        action: "transfer.create",
        entityType: "transfer",
        entityId: t.id,
        summary: `تحويل ${t.quantity} ${t.medicine.name} إلى ${t.toBranch.name}`, // المصدر: null = المستودع المركزي
        meta: {
          medicine: t.medicine.name,
          quantity: t.quantity,
          from: t.fromBranch?.name ?? "المستودع المركزي",
          to: t.toBranch.name,
          note: t.note,
        },
        actor: user,
        ip: clientIp(request.headers),
      });
      return t;
    });
    return ok({ transfer });
  } catch {
    return fail("تعذر إنشاء التحويل", 500);
  }
}
