import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";

/**
 * GET /api/batches/[id]/recall-affected — التتبع الأمامي لسحب دفعة (صيدلي فما فوق)
 * من أخذ من هذه الدفعة؟ — كل فاتورة صُرفت منها وحدات، مع بيانات المريض/العميل
 * والكمية والتاريخ، لإبلاغهم وفق بروتوكول السحب (نمط GS1 Track & Trace /
 * Forward Traceability في عمليات الاستدعاء الدوائي).
 * الفواتير الملغاة (void) مستبعدة — وحداتها عادت للمخزون.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireRole("pharmacist");
  if (error) return error;
  const { id } = await params;

  try {
    const batch = await db.batch.findUnique({
      where: { id },
      include: {
        medicine: { select: { name: true, genericName: true, barcode: true } },
      },
    });
    if (!batch) return fail("الدفعة غير موجودة", 404);

    const traces = await db.saleItemBatch.findMany({
      where: { batchId: id },
      include: {
        saleItem: {
          include: {
            sale: {
              select: {
                reference: true,
                saleDate: true,
                customerName: true,
                customerPhone: true,
                patientId: true,
                patientName: true,
                status: true,
              },
            },
          },
        },
      },
    });

    const affected = traces
      .filter((t) => t.saleItem.sale.status === "completed")
      .map((t) => ({
        saleReference: t.saleItem.sale.reference,
        saleDate: t.saleItem.sale.saleDate,
        customerName: t.saleItem.sale.customerName,
        customerPhone: t.saleItem.sale.customerPhone,
        patientName: t.saleItem.sale.patientName,
        patientId: t.saleItem.sale.patientId,
        quantity: t.quantity,
        lotNumber: t.lotNumber,
        medicineName: t.saleItem.medicineName,
      }))
      .sort((a, b) => b.saleDate.getTime() - a.saleDate.getTime());

    return ok({
      batch: {
        id: batch.id,
        lotNumber: batch.lotNumber,
        expiryDate: batch.expiryDate,
        remainingQty: batch.quantity,
        isRecalled: batch.isRecalled,
        recalledAt: batch.recalledAt,
        medicine: batch.medicine,
      },
      affectedCount: affected.length,
      totalUnitsSold: affected.reduce((a, x) => a + x.quantity, 0),
      affected,
    });
  } catch {
    return fail("تعذر جلب تتبع الدفعة", 500);
  }
}
