import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { autoLotNumber } from "@/lib/purchase";

/**
 * POST /api/purchase-orders/[id]/receive — استلام أمر الشراء ذرياً (صيدلي فما فوق)
 * لكل بند: دفعة LOT بالتكلفة الفعلية + تحديث رصيد الدواء وأقرب صلاحية + حركة مخزون مُدقَّقة.
 * التشغيلة الموجودة مسبقاً تُدمَج (كمية+) — لا يُقبل تكرار الاستلام ولا تشغيلة منتهية.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireRole("pharmacist");
  if (error) return error;
  const { id } = await params;

  try {
    const result = await db.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { supplier: true, items: { include: { medicine: true } } },
      });
      if (!po) throw new Error("PO_NOT_FOUND");
      if (po.status === "received") throw new Error("ALREADY_RECEIVED");
      if (po.status === "cancelled") throw new Error("PO_CANCELLED");
      if (po.items.length === 0) throw new Error("NO_ITEMS");

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const [idx, item] of po.items.entries()) {
        const lotNumber = item.lotNumber?.trim() || autoLotNumber(po.number, idx);
        const expiryDate = item.expiryDate;
        if (!expiryDate) throw new Error(`EXPIRY_MISSING:${item.medicine.name}`);
        if (expiryDate.getTime() <= today.getTime())
          throw new Error(`EXPIRED_LOT:${item.medicine.name}`);

        const existing = await tx.batch.findUnique({
          where: { medicineId_lotNumber: { medicineId: item.medicineId, lotNumber } },
        });

        if (existing) {
          // دمج: الكمية تُجمع، التكلفة تُحدَّث لآخر شراء
          await tx.batch.update({
            where: { id: existing.id },
            data: {
              quantity: existing.quantity + item.quantity,
              unitCost: item.unitCost > 0 ? item.unitCost : existing.unitCost,
              isActive: true,
            },
          });
        } else {
          await tx.batch.create({
            data: {
              medicineId: item.medicineId,
              lotNumber,
              expiryDate,
              quantity: item.quantity,
              unitCost: item.unitCost,
              supplier: po.supplier.name,
            },
          });
        }

        const newQty = item.medicine.quantity + item.quantity;
        await tx.medicine.update({
          where: { id: item.medicineId },
          data: {
            quantity: newQty,
            expiryDate: expiryDate < item.medicine.expiryDate ? expiryDate : item.medicine.expiryDate,
            ...(item.unitCost > 0 ? { purchasePrice: item.unitCost } : {}),
          },
        });
        await tx.stockMovement.create({
          data: {
            medicineId: item.medicineId,
            type: "restock",
            delta: item.quantity,
            balanceAfter: newQty,
            reference: `PO-${po.number} · LOT ${lotNumber}`,
            userId: user.id,
          },
        });
        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: { receivedQty: item.quantity },
        });
      }

      return tx.purchaseOrder.update({
        where: { id },
        data: { status: "received", receivedAt: new Date() },
        include: { supplier: { select: { name: true } } },
      });
    });

    return ok({
      order: result,
      message: `استُلم أمر الشراء رقم ${result.number} — أُنشئت الدفعات وسُجّلت الحركات`,
    });
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "PO_NOT_FOUND") return fail("أمر الشراء غير موجود", 404);
      if (e.message === "ALREADY_RECEIVED")
        return fail("تم استلام هذا الأمر مسبقاً — لا يمكن تكرار الاستلام", 409);
      if (e.message === "PO_CANCELLED")
        return fail("أمر الشراء ملغى — لا يمكن استلامه", 400);
      if (e.message === "NO_ITEMS") return fail("الأمر بلا بنود", 400);
      if (e.message.startsWith("EXPIRY_MISSING:"))
        return fail(`البند «${e.message.split(":")[1]}» بلا تاريخ صلاحية — عدّل الأمر أو أدخل التشغيلة يدوياً`);
      if (e.message.startsWith("EXPIRED_LOT:"))
        return fail(`البند «${e.message.split(":")[1]}» بصلاحية منتهية/اليوم — لا يمكن استلامه`);
    }
    return fail("تعذر استلام أمر الشراء", 500);
  }
}
