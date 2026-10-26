import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";
import { toInt } from "@/lib/money";
import {
  createSale,
  parseSaleItems,
  reviewSaleItems,
  type SaleItemInput,
} from "@/lib/sale-engine";

/**
 * POST /api/sales — إتمام البيع النقدي الحر (عملية ذرّية عبر محرك البيع المشترك)
 * البوابة السريرية:
 *  - «ممنوع سريرياً» أو تعارض حساسية يحجب البيع
 *  - الفني محجوب دائماً؛ الصيدلي/المدير يتجاوز بـ clinicalOverride المسؤول
 *  - صرف الوصفات المحققة يمر عبر /api/prescriptions/[id]/dispense بنفس المحرك
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  try {
    const body = await request.json();
    const items = parseSaleItems(body.items);
    if (!items) return fail("السلة فارغة");

    const reference =
      String(body.transactionId ?? "").trim() ||
      `POS-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const patientId = String(body.patientId ?? "").trim() || null;
    const clinicalOverride = body.clinicalOverride === true;

    // Idempotency: إن كانت العملية مسجلة مسبقاً أعدها دون تكرار
    const existing = await db.sale.findUnique({
      where: { reference },
      include: { items: true },
    });
    if (existing) {
      return ok({
        duplicated: true,
        saleId: existing.id,
        reference: existing.reference,
        netAmount: existing.netAmount,
        message: "هذه العملية مسجلة مسبقاً",
      });
    }

    // مراجعة سريعة للحجب قبل الدخول في المعاملة (المحرك يعيد الفحص داخلياً)
    const preReview = await reviewSaleItems(items as SaleItemInput[], patientId);
    if (preReview.blocking) {
      if (user.role === "technician") {
        return fail(
          "يوجد ممنوع سريرياً أو تعارض حساسية في السلة — يجب مراجعة صيدلي قبل الإتمام",
          403,
          { clinicalBlock: true, clinicalReview: preReview }
        );
      }
      if (!clinicalOverride) {
        return fail(
          "تعارض سريري خطر — يتطلب تأكيد تجاوز مسؤول من الصيدلي",
          409,
          { clinicalBlock: true, clinicalReview: preReview }
        );
      }
    }

    const paymentMethod = ["cash", "card", "insurance"].includes(body.paymentMethod)
      ? body.paymentMethod
      : "cash";

    try {
      const result = await createSale({
        items: items as SaleItemInput[],
        reference,
        patientId,
        clinicalOverride,
        discount: toInt(body.discount ?? 0),
        customerName: String(body.customerName ?? "").trim() || "عميل نقدي",
        customerPhone: String(body.customerPhone ?? "").trim() || null,
        paymentMethod,
        userId: user.id,
      });

      const full = await db.sale.findUnique({
        where: { id: result.saleId },
        include: {
          items: { include: { medicine: { select: { barcode: true, quantity: true } } } },
          user: { select: { username: true, fullName: true } },
        },
      });

      return ok(
        {
          duplicated: false,
          saleId: result.saleId,
          reference: result.reference,
          netAmount: result.netAmount,
          interactionWarnings: result.clinicalReview.interactions,
          clinicalReview: result.clinicalReview,
          message: "تم البيع بنجاح",
          sale: full,
        },
        201
      );
    } catch (e) {
      // سباق التزامن: إن سجلت معاملة أخرى نفس المرجع — أعد النتيجة
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const dup = await db.sale.findUnique({ where: { reference } });
        return ok({ duplicated: true, saleId: dup?.id, reference, message: "عملية مكررة" });
      }
      const msg = e instanceof Error ? e.message : "تعذر إتمام البيع";
      return fail(msg);
    }
  } catch {
    return fail("طلب غير صالح", 400);
  }
}

// GET /api/sales?q=&page=&pageSize=&days= — سجل المبيعات
export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const page = Math.max(1, toInt(sp.get("page"), 1));
  const pageSize = Math.min(100, Math.max(5, toInt(sp.get("pageSize"), 15)));

  const where: Record<string, unknown> = {};
  if (q)
    where.OR = [
      { reference: { contains: q } },
      { customerName: { contains: q } },
      { customerPhone: { contains: q } },
    ];

  try {
    const [total, sales] = await Promise.all([
      db.sale.count({ where }),
      db.sale.findMany({
        where,
        include: {
          items: true,
          user: { select: { username: true, fullName: true } },
        },
        orderBy: { saleDate: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return ok({ total, page, pageSize, sales });
  } catch {
    return fail("تعذر جلب المبيعات", 500);
  }
}
