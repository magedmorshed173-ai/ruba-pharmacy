import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { parseCountedQty, STOCK_COUNT_MAX_SUBMIT } from "@/lib/stocktake";

/**
 * v5.6 — الجرد الفعلي: تفاصيل الجلسة وإدخال الكميات المعدودة
 *
 * GET   /api/stocktake/:id — الجلسة وبنودها المجمّدة (صيدلي+)
 * PATCH /api/stocktake/:id — إدخال دفعة من العدّ { counts: [{itemId, countedQty}] }
 *   (صيدلي+) — countedQty null = تخطٍّ مقصود. يعمل على الجلسة المفتوحة فقط،
 *   وحتى 2000 بند في النداء الواحد. الإدخال مسودة — لا يمس المخزون.
 */

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireRole("pharmacist");
  if (error) return error;

  const { id } = await params;
  const count = await db.stockCount.findUnique({
    where: { id },
    include: {
      openedBy: { select: { fullName: true } },
      closedBy: { select: { fullName: true } },
      items: { orderBy: [{ medicineName: "asc" }, { lotNumber: "asc" }] },
    },
  });
  if (!count) return fail("جلسة الجرد غير موجودة", 404);
  return ok({ count });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireRole("pharmacist");
  if (error) return error;

  const { id } = await params;
  let body: { counts?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return fail("جسم الطلب غير صالح");
  }

  const raw = Array.isArray(body.counts) ? body.counts : null;
  if (!raw || raw.length === 0) return fail("لا بنود عدّ في الطلب");
  if (raw.length > STOCK_COUNT_MAX_SUBMIT)
    return fail(`الحد ${STOCK_COUNT_MAX_SUBMIT} بنداً في النداء الواحد`);

  // تطبيع وتحقق قبل لمس القاعدة — رسالة خطأ تحدد موضع الإدخال
  const entries: { itemId: string; countedQty: number | null }[] = [];
  for (let i = 0; i < raw.length; i++) {
    const it = raw[i] as { itemId?: unknown; countedQty?: unknown };
    const itemId = typeof it.itemId === "string" ? it.itemId : "";
    if (!itemId) return fail(`البند ${i + 1}: معرّف غير صالح`);
    const qty = parseCountedQty(it.countedQty);
    if (qty === false)
      return fail(`البند ${i + 1}: الكمية يجب أن تكون عدداً صحيحاً بين 0 و1000000`);
    entries.push({ itemId, countedQty: qty });
  }

  try {
    const updated = await db.$transaction(async (tx) => {
      const count = await tx.stockCount.findUnique({ where: { id }, select: { status: true } });
      if (!count) throw new Error("NOT_FOUND");
      if (count.status !== "open") throw new Error("NOT_OPEN");

      let n = 0;
      for (const e of entries) {
        const r = await tx.stockCountItem.updateMany({
          where: { id: e.itemId, countId: id },
          data: { countedQty: e.countedQty },
        });
        n += r.count;
      }
      return n;
    });

    return ok({ updated, by: user.fullName });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "NOT_FOUND") return fail("جلسة الجرد غير موجودة", 404);
    if (msg === "NOT_OPEN") return fail("الجلسة ليست مفتوحة — لا إدخال بعد التطبيق أو الإلغاء", 409);
    console.error("stocktake PATCH failed:", e);
    return fail("تعذر حفظ العدّ", 500);
  }
}
