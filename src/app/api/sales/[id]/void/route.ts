import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/auth";

// POST /api/sales/:id/void — إلغاء بيع واسترجاع المخزون (صيدلي فما فوق)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireRole("pharmacist");
  if (error) return error;

  const { id } = await params;
  try {
    await db.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!sale) throw new Error("NOT_FOUND");
      if (sale.status === "void") throw new Error("ALREADY_VOID");

      for (const item of sale.items) {
        const med = await tx.medicine.findUnique({ where: { id: item.medicineId } });
        if (!med) continue;
        const newQty = med.quantity + item.quantity;
        await tx.medicine.update({
          where: { id: med.id },
          data: { quantity: newQty },
        });
        await tx.stockMovement.create({
          data: {
            medicineId: med.id,
            type: "return",
            delta: item.quantity,
            balanceAfter: newQty,
            reference: `VOID-${sale.reference}`,
            userId: user.id,
          },
        });
        // ── v5.2 — رجوع مرآة الفرع: إن كان الدواء مُوزَّعاً بيع من رصيد فرعه،
        // فالإلغاء يعيد الكمية لتخصيص الفرع نفسه (upsert يضمن الصف) ──
        const distRows = await tx.branchStock.count({
          where: { medicineId: med.id },
        });
        if (distRows > 0 && sale.branchId) {
          await tx.branchStock.upsert({
            where: {
              medicineId_branchId: {
                medicineId: med.id,
                branchId: sale.branchId,
              },
            },
            update: { quantity: { increment: item.quantity } },
            create: {
              medicineId: med.id,
              branchId: sale.branchId,
              quantity: item.quantity,
            },
          });
        }
      }

      await tx.sale.update({ where: { id }, data: { status: "void" } });

      // v5.4 — توثيق الإلغاء داخل نفس المعاملة (لا إلغاء بلا تدقيق، والعكس
      // كذلك: فشل المعاملة يُسقط التوثيق معها). ملاحظة: clinicalOverride
      // يُرفق دائماً — الإلغاء لحافة تجاوز سريري يستحق ظهوراً أوضح في المراجعة.
      await recordAudit(tx, {
        action: "sale.void",
        entityType: "sale",
        entityId: sale.id,
        summary: `إلغاء الفاتورة ${sale.reference} (${sale.itemsCount} بند) واسترجاع كمياتها`,
        meta: {
          reference: sale.reference,
          netAmount: sale.netAmount,
          paymentMethod: sale.paymentMethod,
          patientName: sale.patientName,
          clinicalOverride: sale.clinicalOverride,
          itemsCount: sale.itemsCount,
        },
        actor: user,
        ip: clientIp(request.headers),
      });
    });

    return ok({ message: "تم إلغاء الفاتورة وإرجاع الكميات للمخزون" });
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "NOT_FOUND") return fail("الفاتورة غير موجودة", 404);
      if (e.message === "ALREADY_VOID") return fail("الفاتورة ملغاة مسبقاً");
    }
    return fail("تعذر إلغاء الفاتورة", 500);
  }
}
