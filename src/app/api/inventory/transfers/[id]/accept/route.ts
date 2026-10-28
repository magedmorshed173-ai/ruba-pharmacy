import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { planAccept } from "@/lib/transfers";

/**
 * v5.2 — قبول تحويل مخزون (مدير حصراً)
 *
 * POST /api/inventory/transfers/:id/accept
 * معاملة ذرية واحدة: قراءة الأرقام الطازجة (المركزي/المرايا) ⇒ planAccept
 * ⇒ تطبيق المرايا (upsert) ⇒ تمهيد التحويل. المخزون المركزي لا يتغير
 * (نقل فعلي داخل الصيدلية الواحدة) — المرايا هي ما يُعاد توزيعه.
 * سباق القبول المزدوج محجوب بحالة الصف (pending فقط يُقبل).
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
    const result = await db.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({ where: { id } });
      if (!transfer) throw new Error("NOT_FOUND");
      if (transfer.status !== "pending") throw new Error("NOT_PENDING");

      const medicine = await tx.medicine.findUnique({
        where: { id: transfer.medicineId },
        select: { quantity: true, isActive: true },
      });
      if (!medicine || !medicine.isActive) throw new Error("MED_INACTIVE");

      const rows = await tx.branchStock.findMany({
        where: { medicineId: transfer.medicineId },
      });
      const totalAssigned = rows.reduce((a, r) => a + r.quantity, 0);
      const srcRow = transfer.fromBranchId
        ? rows.find((r) => r.branchId === transfer.fromBranchId)
        : undefined;

      const plan = planAccept({
        quantity: transfer.quantity,
        fromWarehouse: transfer.fromBranchId === null,
        fromBranchStock: srcRow?.quantity ?? null,
        centralQuantity: medicine.quantity,
        totalAssigned,
      });
      if (!plan.ok) throw new Error(`PLAN:${plan.error}`);

      // فرع المستلم: upsert (قد يكون أول توزيع لهذا الدواء عنده)
      await tx.branchStock.upsert({
        where: {
          medicineId_branchId: {
            medicineId: transfer.medicineId,
            branchId: transfer.toBranchId,
          },
        },
        update: { quantity: { increment: plan.ops.targetBranchDelta } },
        create: {
          medicineId: transfer.medicineId,
          branchId: transfer.toBranchId,
          quantity: plan.ops.targetBranchDelta,
        },
      });

      // فرع المصدر (إن لم يكن المستودع): خصم مع حماية من السالب
      if (transfer.fromBranchId) {
        await tx.branchStock.update({
          where: {
            medicineId_branchId: {
              medicineId: transfer.medicineId,
              branchId: transfer.fromBranchId,
            },
          },
          data: { quantity: { increment: plan.ops.sourceBranchDelta } },
        });
      }

      return tx.stockTransfer.update({
        where: { id },
        data: {
          status: "accepted",
          acceptedByUserId: user.id,
          acceptedAt: new Date(),
        },
        include: {
          medicine: { select: { name: true } },
          fromBranch: { select: { name: true } },
          toBranch: { select: { name: true } },
        },
      });
    });

    return ok({ transfer: result });
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "NOT_FOUND") return fail("التحويل غير موجود", 404);
      if (e.message === "NOT_PENDING") return fail("التحويل منفَّذ أو ملغى مسبقاً");
      if (e.message === "MED_INACTIVE") return fail("الدواء مؤرشف — لا يمكن تنفيذ التحويل");
      if (e.message.startsWith("PLAN:")) return fail(e.message.slice(5));
    }
    return fail("تعذر قبول التحويل", 500);
  }
}
