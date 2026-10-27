import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";
import { toInt } from "@/lib/money";
import { zatcaSellerFromEnv } from "@/lib/zatca";
import { assertPolicyUsable, POLICY_BLOCK_LABEL } from "@/lib/insurance";
import {
  createSale,
  parseSaleItems,
  reviewSaleItems,
  RegistryBlockError,
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

    // الحجب التنظيمي المطلق (معلق/محظور) — لا تجاوز له لأي دور
    if (preReview.registryBlocking) {
      const first = preReview.registryAlerts.find((a) => a.blocking);
      return fail(first?.message ?? "دواء محجوب تنظيمياً من السجل الوطني", 409, {
        registryBlock: true,
        clinicalReview: preReview,
      });
    }

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

    const paymentMethodRaw = ["cash", "card", "insurance"].includes(body.paymentMethod)
      ? body.paymentMethod
      : "cash";

    // ── v4.6 — التأمين: حلّ البوليصة خدمياً (لا تُؤمَن قيم العميل) ──
    let insurance: Parameters<typeof createSale>[0]["insurance"];
    const rawPolicyId = String(body.insurancePolicyId ?? "").trim();
    if (rawPolicyId || paymentMethodRaw === "insurance") {
      if (!patientId)
        return fail("البيع بالتأمين يتطلب اختيار مريض أولاً", 409);
      if (!rawPolicyId)
        return fail("اختر بوليصة تأمين صالحة للبيع بالتأمين", 409);
      const policy = await db.patientInsurancePolicy.findUnique({
        where: { id: rawPolicyId },
        include: { provider: { select: { id: true, isActive: true, name: true } } },
      });
      if (!policy) return fail("بوليصة التأمين غير موجودة", 404);
      if (policy.patientId !== patientId)
        return fail("البوليصة مسجّلة على مريض آخر — اختر مريض البوليصة نفسه", 409);
      if (!policy.provider.isActive)
        return fail(
          `شركة التأمين «${policy.provider.name}» موقوفة عن التعامل`,
          409
        );
      const block = assertPolicyUsable({
        isActive: policy.isActive,
        expiryDate: policy.expiryDate,
        coverageBps: policy.coverageBps,
        copayFixed: policy.copayFixed,
      });
      if (block)
        return fail(POLICY_BLOCK_LABEL[block], 409, { policyBlock: block });
      insurance = {
        policyId: policy.id,
        providerId: policy.providerId,
        coverageBps: policy.coverageBps,
        copayFixed: policy.copayFixed,
      };
    }
    const paymentMethod = insurance ? "insurance" : paymentMethodRaw;

    // ── v4.6 — الفرع: فرع الموظف من القاعدة (حديث دائماً)، والإدارة قد تحدد غيره ──
    let branchId: string | null = null;
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { branchId: true },
    });
    branchId = dbUser?.branchId ?? null;
    if (user.role === "admin" && String(body.branchId ?? "").trim()) {
      const b = await db.branch.findUnique({
        where: { id: String(body.branchId).trim() },
        select: { isActive: true },
      });
      if (!b) return fail("الفرع غير موجود", 404);
      branchId = b.isActive ? String(body.branchId).trim() : null;
    }

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
        branchId,
        insurance,
        // v4.5 — فاتورة ZATCA تلقائياً متى صار الرقم الضريبي مضبوطاً في البيئة
        zatca: zatcaSellerFromEnv()
          ? { seller: zatcaSellerFromEnv()! }
          : undefined,
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
      if (e instanceof RegistryBlockError)
        return fail(e.message, 409, { registryBlock: true });
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
