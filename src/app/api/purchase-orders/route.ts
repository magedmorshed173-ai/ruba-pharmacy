import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth, requireRole } from "@/lib/api-guard";
import { normalizePOItems } from "@/lib/purchase";

/**
 * GET /api/purchase-orders?status=draft — أوامر الشراء مع المورد والبنود
 * POST — إنشاء أمر شراء (مسودة) (صيدلي فما فوق)
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const status = request.nextUrl.searchParams.get("status");
  try {
    const orders = await db.purchaseOrder.findMany({
      where: status ? { status } : {},
      include: {
        supplier: { select: { name: true } },
        items: {
          include: { medicine: { select: { name: true, barcode: true } } },
        },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
    });
    return ok({ orders });
  } catch {
    return fail("تعذر جلب أوامر الشراء", 500);
  }
}

export async function POST(request: NextRequest) {
  const { user, error } = await requireRole("pharmacist");
  if (error) return error;

  try {
    const body = await request.json();
    const supplierId = String(body.supplierId ?? "").trim();
    if (!supplierId) return fail("اختيار المورد مطلوب");

    const norm = normalizePOItems(body.items);
    if (!norm.ok) return fail(norm.error);

    const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) return fail("المورد غير موجود", 404);
    if (!supplier.isActive) return fail("المورد معطّل — فعّله أولاً");

    const medicineIds = norm.items.map((i) => i.medicineId);
    const medicines = await db.medicine.findMany({
      where: { id: { in: medicineIds } },
      select: { id: true },
    });
    if (medicines.length !== medicineIds.length)
      return fail("أحد الأدوية المحددة غير موجود", 404);

    const po = await db.$transaction(async (tx) => {
      // SQLite أحادي الكاتب — max+1 داخل المعاملة آمن عملياً
      const last = await tx.purchaseOrder.aggregate({
        _max: { number: true },
      });
      const number = (last._max.number ?? 0) + 1;

      return tx.purchaseOrder.create({
        data: {
          number,
          supplierId,
          totalHalalas: norm.totalHalalas,
          notes: String(body.notes ?? "").trim() || null,
          createdBy: user.id,
          items: {
            create: norm.items.map((i) => ({
              medicineId: i.medicineId,
              quantity: i.quantity,
              unitCost: i.unitCost,
              lotNumber: i.lotNumber,
              expiryDate: i.expiryDate,
            })),
          },
        },
        include: {
          supplier: { select: { name: true } },
          items: { include: { medicine: { select: { name: true } } } },
        },
      });
    });

    return ok(
      { order: po, message: `أُنشئ أمر الشراء رقم ${po.number} — بانتظار الاستلام` },
      201
    );
  } catch {
    return fail("تعذر إنشاء أمر الشراء", 500);
  }
}
