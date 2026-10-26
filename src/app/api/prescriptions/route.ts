import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";
import { toInt } from "@/lib/money";
import { reviewSaleItems } from "@/lib/sale-engine";
import { reserveForPrescription, computeAvailable } from "@/lib/reservations";

interface RxItemInput {
  medicineId?: string;
  quantity: number;
  instructions?: string;
}

/**
 * POST /api/prescriptions — إدخال وصفة في طابور التحقق
 * المعيار الغربي (Fill → Verify → Dispense): الفني أو الصيدلي يُدخل الوصفة
 * الورقية إلى الطابور، والصرف لا يتم إلا بعد تحقق صيدلي بمطابقة باركود.
 * أي دور مسجل يمكنه الإدخال — التحقق والرفض والصرف للصيدلي فما فوق.
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  try {
    const body = await request.json();
    const rawItems: RxItemInput[] = Array.isArray(body.items) ? body.items : [];
    const patientId = String(body.patientId ?? "").trim();
    if (!patientId) return fail("المريض مطلوب — الوصفة تُسجل على مريض");
    if (rawItems.length === 0) return fail("الوصفة بلا بنود");

    const preparedItems = rawItems
      .map((i) => ({
        medicineId: String(i.medicineId ?? "").trim(),
        quantity: toInt(i.quantity, 0),
        instructions: String(i.instructions ?? "").trim() || null,
      }))
      .filter((i) => i.medicineId);
    if (preparedItems.length === 0) return fail("بنود الوصفة غير صحيحة");
    for (const it of preparedItems) {
      if (it.quantity <= 0) return fail("كمية غير صحيحة في أحد البنود");
    }

    const patient = await db.patient.findUnique({ where: { id: patientId } });
    if (!patient) return fail("المريض غير موجود", 404);

    const meds = await db.medicine.findMany({
      where: { id: { in: preparedItems.map((i) => i.medicineId) }, isActive: true },
    });
    const medMap = new Map(meds.map((m) => [m.id, m]));
    for (const it of preparedItems) {
      if (!medMap.has(it.medicineId)) return fail("أحد أدوية الوصفة غير موجود", 404);
    }

    const prescription = await db.$transaction(async (tx) => {
      // SQLite أحادي الكاتب — max+1 داخل المعاملة آمن عملياً (نمط أوامر الشراء)
      const last = await tx.prescription.aggregate({ _max: { number: true } });
      const number = (last._max.number ?? 0) + 1;
      const created = await tx.prescription.create({
        data: {
          number,
          status: "pending",
          patientId,
          patientName: patient.name,
          doctorName: String(body.doctorName ?? "").trim() || null,
          notes: String(body.notes ?? "").trim() || null,
          createdBy: user.id,
          creatorName: user.fullName,
          items: {
            create: preparedItems.map((i) => ({
              medicineId: i.medicineId,
              medicineName: medMap.get(i.medicineId)!.name,
              quantity: i.quantity,
              instructions: i.instructions,
            })),
          },
        },
        include: {
          items: {
            include: {
              medicine: {
                select: { barcode: true, genericName: true, quantity: true, atcClass: true },
              },
            },
          },
        },
      });
      // حجز وقائي فوري: وحدات الوصفة موعودة للوصفة — لا تُباع من نقطة البيع
      await reserveForPrescription(tx, created.id, created.items);
      return created;
    });

    // مراجعة سريرية فورية تظهر للصيدلي في الطابور (تحذير لا حجب — الحجب عند التحقق والصرف)
    const clinicalReview = await reviewSaleItems(
      preparedItems.map((i) => ({ medicineId: i.medicineId, quantity: i.quantity })),
      patientId
    );

    // المتاح بعد الحجز الفوري = الرصيد − محجوز الوصفات الأخرى
    const otherReserved = await db.stockReservation.groupBy({
      by: ["medicineId"],
      where: {
        medicineId: { in: preparedItems.map((i) => i.medicineId) },
        status: "active",
        prescriptionId: { not: prescription.id },
      },
      _sum: { quantity: true },
    });
    const reservedMap = new Map(otherReserved.map((r) => [r.medicineId, r._sum.quantity ?? 0]));
    const availability = preparedItems.map((i) => {
      const m = medMap.get(i.medicineId)!;
      const reserved = reservedMap.get(i.medicineId) ?? 0;
      return {
        medicineId: i.medicineId,
        onHand: m.quantity,
        reservedOther: reserved,
        available: computeAvailable(m.quantity, reserved),
        suffices: computeAvailable(m.quantity, reserved) >= i.quantity,
      };
    });

    return ok(
      {
        prescription,
        clinicalReview,
        availability,
        message: `أُدرجت الوصفة رقم ${prescription.number} في طابور التحقق — حُجز مخزونها وقائياً`,
      },
      201
    );
  } catch {
    return fail("طلب غير صالح", 400);
  }
}

// GET /api/prescriptions?status=&q=&page=&pageSize= — قائمة الطابور مع عدّادات الحالات
export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const status = sp.get("status")?.trim() ?? "";
  const q = sp.get("q")?.trim() ?? "";
  const page = Math.max(1, toInt(sp.get("page"), 1));
  const pageSize = Math.min(100, Math.max(5, toInt(sp.get("pageSize"), 20)));

  const where: Record<string, unknown> = {};
  if (["pending", "verified", "rejected", "dispensed"].includes(status)) where.status = status;
  if (q)
    where.OR = [
      { patientName: { contains: q } },
      { doctorName: { contains: q } },
      { rejectReason: { contains: q } },
    ];

  try {
    const [total, counts, prescriptions] = await Promise.all([
      db.prescription.count({ where }),
      db.prescription.groupBy({ by: ["status"], _count: { _all: true } }),
      db.prescription.findMany({
        where,
        include: {
          items: {
            include: {
              medicine: {
                select: {
                  barcode: true,
                  genericName: true,
                  quantity: true,
                  atcClass: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const byStatus: Record<string, number> = {};
    for (const g of counts) byStatus[g.status] = g._count._all;
    return ok({ total, page, pageSize, prescriptions, counts: byStatus });
  } catch {
    return fail("تعذر جلب طابور التحقق", 500);
  }
}
