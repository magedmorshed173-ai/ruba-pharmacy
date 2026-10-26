import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { reviewSaleItems } from "@/lib/sale-engine";

interface ScanInput {
  medicineId?: string;
  barcode?: string;
}

/**
 * POST /api/prescriptions/[id]/verify — تحقق الصيدلي بمطابقة باركود (صيدلي فما فوق)
 * المعيار الغربي: كل بند يُمسح باركوده فعلياً ويُطابق بباركود الدواء في النظام
 * — الباركود الخاطئ مرفوض. عند اكتمال كل البنود تتحول الوصفة إلى verified.
 * البوابة السريرية: إن كان هناك «ممنوع سريرياً» أو تعارض حساسية، لا يكتمل
 * التحقق إلا بـ clinicalOverride مسؤول مسجّل (الفني محجوب هنا أصلاً بالدور).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireRole("pharmacist");
  if (error) return error;
  const { id } = await params;

  try {
    const body = await request.json();
    const scans: ScanInput[] = Array.isArray(body.scans) ? body.scans : [];
    if (scans.length === 0) return fail("لا توجد مسح باركود في الطلب");
    const clinicalOverride = body.clinicalOverride === true;

    const prescription = await db.prescription.findUnique({
      where: { id },
      include: { items: { include: { medicine: { select: { barcode: true } } } } },
    });
    if (!prescription) return fail("الوصفة غير موجودة", 404);
    if (prescription.status !== "pending")
      return fail(
        `الوصفة في حالة «${prescription.status}» — التحقق متاح للوصفات بانتظار التحقق فقط`,
        409
      );

    // ── مطابقة كل مسح مع بند الوصفة ──
    const updates: { itemId: string; medicineId: string }[] = [];
    for (const scan of scans) {
      const medId = String(scan.medicineId ?? "").trim();
      const barcode = String(scan.barcode ?? "").trim();
      if (!medId || !barcode) return fail("بيانات مسح ناقصة");

      const item = prescription.items.find((i) => i.medicineId === medId);
      if (!item) return fail("المسح يخص دواءً ليس من بنود هذه الوصفة", 400);
      if (barcode !== item.medicine.barcode)
        return fail(`الباركود لا يطابق بند «${item.medicineName}» — تحقق من العبوة`, 400);
      updates.push({ itemId: item.id, medicineId: medId });
    }

    // البوابة السريرية قبل اكتمال التحقق
    const review = await reviewSaleItems(
      prescription.items.map((i) => ({ medicineId: i.medicineId, quantity: i.quantity })),
      prescription.patientId
    );

    const willComplete = prescription.items.every((i) =>
      updates.some((u) => u.itemId === i.id) || i.verified
    );
    if (review.blocking && willComplete && !clinicalOverride) {
      return fail(
        "تعارض سريري خطر في الوصفة — يلزم تأكيد تجاوز مسؤول مسجّل للاكتمال",
        409,
        { clinicalBlock: true, clinicalReview: review }
      );
    }

    const updated = await db.$transaction(async (tx) => {
      for (const u of updates) {
        await tx.prescriptionItem.update({
          where: { id: u.itemId },
          data: { verified: true },
        });
      }
      // إعادة قراءة حالة البنود بعد التحديث
      const items = await tx.prescriptionItem.findMany({
        where: { prescriptionId: id },
      });
      const allVerified = items.every((i) => i.verified);
      return tx.prescription.update({
        where: { id },
        data: {
          status: allVerified ? "verified" : "pending",
          ...(allVerified
            ? {
                verifiedBy: user.id,
                verifierName: user.fullName,
                verifiedAt: new Date(),
                clinicalOverride: clinicalOverride || prescription.clinicalOverride,
              }
            : {}),
        },
        include: { items: true },
      });
    });

    const remaining = updated.items.filter((i) => !i.verified).length;
    return ok({
      prescription: updated,
      remaining,
      clinicalReview: review,
      message:
        remaining === 0
          ? `اكتمل التحقق من الوصفة رقم ${prescription.number} — جاهزة للصرف`
          : `تحقق ${updated.items.length - remaining} من ${updated.items.length} بنوداً`,
    });
  } catch {
    return fail("طلب غير صالح", 400);
  }
}
