import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";
import { reviewSaleItems } from "@/lib/sale-engine";

/**
 * GET /api/prescriptions/[id] — تفاصيل وصفة كاملة مع المراجعة السريرية الحية
 * تُستخدم في لوحة التحقق: تظهر للصيدلي التداخلات والحساسية والعلاج المكرر
 * قبل أن يقرر التحقق بمطابقة الباركود أو الرفض.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth();
  if (error) return error;
  const { id } = await params;

  try {
    const prescription = await db.prescription.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            medicine: {
              select: {
                barcode: true,
                genericName: true,
                quantity: true,
                atcClass: true,
                maxDailyDose: true,
              },
            },
          },
        },
      },
    });
    if (!prescription) return fail("الوصفة غير موجودة", 404);

    const clinicalReview = await reviewSaleItems(
      prescription.items.map((i) => ({ medicineId: i.medicineId, quantity: i.quantity })),
      prescription.patientId
    );

    return ok({ prescription, clinicalReview });
  } catch {
    return fail("تعذر جلب تفاصيل الوصفة", 500);
  }
}
