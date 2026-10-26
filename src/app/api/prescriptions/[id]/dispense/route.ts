import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { createSale, RegistryBlockError } from "@/lib/sale-engine";

/**
 * POST /api/prescriptions/[id]/dispense — صرف وصفة محققة (صيدلي فما فوق)
 * لا صرف إلا لوصفة حالة verified — والصرف يمر عبر محرك البيع الذري نفسه
 * (FEFO + دفتر الحركات + لقطات تكلفة + بوابة سريرية) مع ربط الوصفة بالفاتورة
 * داخل نفس المعاملة: إما تُصرف الوصفة وتُخصم المخزون معاً أو لا شيء.
 * مرجع الفاتورة RX-<رقم الوصفة> يجعل الصرف المزدوج مستحيلاً بقيد قاعدة البيانات.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireRole("pharmacist");
  if (error) return error;
  const { id } = await params;

  try {
    const body = await request.json().catch(() => ({}));
    const paymentMethod = ["cash", "card", "insurance"].includes(body.paymentMethod)
      ? body.paymentMethod
      : "cash";

    const prescription = await db.prescription.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!prescription) return fail("الوصفة غير موجودة", 404);
    if (prescription.status === "pending")
      return fail("الوصفة لم يُتحقق منها بعد — اطلب تحقق الصيدلي أولاً", 409);
    if (prescription.status === "rejected")
      return fail("الوصفة مرفوضة — لا يمكن صرفها", 409);
    if (prescription.status === "dispensed")
      return fail("الوصفة مصروفة مسبقاً", 409);

    try {
      const result = await createSale({
        items: prescription.items.map((i) => ({
          medicineId: i.medicineId,
          quantity: i.quantity,
        })),
        reference: `RX-${prescription.number}`,
        patientId: prescription.patientId,
        // التجاوز المسؤول سُجل لحظة التحقق — يُنقل للفاتورة كما هو
        clinicalOverride: prescription.clinicalOverride,
        discount: 0,
        customerName: prescription.patientName ?? "مريض",
        customerPhone: null,
        paymentMethod,
        userId: user.id,
        // حجوزات هذه الوصفة لا تُحسب ضدها — وحداتها موعودة لها أصلاً
        excludeReservationFor: id,
        withinTx: async (tx, saleId) => {
          // حارس سباق: التحديث فقط إذا كانت الوصفة ما زالت verified —
          // إن سبقنا صرفٌ موازٍ فإن count=0 والمعاملة كلها تتراجع
          const flip = await tx.prescription.updateMany({
            where: { id, status: "verified" },
            data: { status: "dispensed", saleId },
          });
          if (flip.count === 0) throw new Error("الوصفة مصروفة مسبقاً");
          // الحجز الوقائي تحقق فعلياً — يُستهلك بنفس الذرية
          await tx.stockReservation.updateMany({
            where: { prescriptionId: id, status: "active" },
            data: { status: "consumed", closedAt: new Date() },
          });
        },
      });

      const sale = await db.sale.findUnique({
        where: { id: result.saleId },
        include: { items: true },
      });

      return ok(
        {
          prescriptionId: id,
          saleId: result.saleId,
          reference: result.reference,
          netAmount: result.netAmount,
          clinicalReview: result.clinicalReview,
          sale,
          message: `صُرفت الوصفة رقم ${prescription.number} — فاتورة ${result.reference}`,
        },
        201
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "تعذر صرف الوصفة";
      if (e instanceof RegistryBlockError)
        return fail(msg, 409, { registryBlock: true });
      return fail(msg, msg.includes("مصروفة") ? 409 : 400);
    }
  } catch {
    return fail("طلب غير صالح", 400);
  }
}
