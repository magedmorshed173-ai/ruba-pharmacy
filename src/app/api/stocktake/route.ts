import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/auth";
import {
  newStockCountNumber,
  STOCK_COUNT_MAX_BATCHES,
  validateStartInput,
} from "@/lib/stocktake";

/**
 * v5.6 — الجرد الفعلي: القائمة وفتح جلسة جديدة
 *
 * GET  /api/stocktake — آخر 50 جلسة (صيدلي+)
 * POST /api/stocktake — فتح جلسة: تجميد أرصدة كل الدفعات النشطة لحظة الفتح
 *   (صيدلي+). جلسة واحدة مفتوحة كحد أقصى — فتح ثانية يُرفض حتى يُطبَّق
 *   الأولى أو يُلغى. التجميد بحد 5000 دفعة حماية من ضغطة خاطئة.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await requireRole("pharmacist");
  if (error) return error;

  const counts = await db.stockCount.findMany({
    orderBy: { openedAt: "desc" },
    take: 50,
    include: {
      openedBy: { select: { fullName: true } },
      closedBy: { select: { fullName: true } },
    },
  });
  return ok({ counts });
}

export async function POST(request: NextRequest) {
  const { user, error } = await requireRole("pharmacist");
  if (error) return error;

  let body: { note?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    /* بلا جسم — مسموح */
  }
  const note = typeof body.note === "string" ? body.note.trim() : null;
  const check = validateStartInput({ note });
  if (!check.ok) return fail(check.error);

  try {
    const created = await db.$transaction(async (tx) => {
      const open = await tx.stockCount.findFirst({ where: { status: "open" } });
      if (open) {
        const e = new Error(`OPEN:${open.number}`) as Error & { code?: string };
        e.code = "OPEN";
        throw e;
      }

      const batches = await tx.batch.findMany({
        where: { isActive: true, medicine: { isActive: true } },
        select: {
          id: true,
          medicineId: true,
          lotNumber: true,
          expiryDate: true,
          unitCost: true,
          quantity: true,
          medicine: { select: { name: true } },
        },
      });
      if (batches.length === 0) {
        const e = new Error("NO_BATCHES") as Error & { code?: string };
        e.code = "NO_BATCHES";
        throw e;
      }
      if (batches.length > STOCK_COUNT_MAX_BATCHES) {
        const e = new Error("TOO_MANY") as Error & { code?: string };
        e.code = "TOO_MANY";
        throw e;
      }

      const count = await tx.stockCount.create({
        data: {
          number: newStockCountNumber(),
          status: "open",
          batchesTotal: batches.length,
          note,
          openedById: user.id,
          items: {
            create: batches.map((b) => ({
              batchId: b.id,
              medicineId: b.medicineId,
              medicineName: b.medicine.name,
              lotNumber: b.lotNumber,
              expiryDate: b.expiryDate,
              unitCost: b.unitCost,
              systemQty: b.quantity,
            })),
          },
        },
      });

      // v5.4 — التوثيق ذري مع الفتح (نفس المعاملة)
      recordAudit(tx, {
        action: "stocktake.open",
        entityType: "stockCount",
        entityId: count.id,
        summary: `بدء جلسة جرد ${count.number} — تجميد ${batches.length} دفعة`,
        meta: { number: count.number, batchesTotal: batches.length, note },
        actor: user,
        ip: clientIp(request.headers),
      });

      return count;
    });

    return ok(
      { id: created.id, number: created.number, batchesTotal: created.batchesTotal },
      201
    );
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "OPEN") {
      const number = (e as Error).message.slice(5);
      return fail(`توجد جلسة جرد مفتوحة (${number}) — أكمل تطبيقها أو ألغِها أولاً`, 409);
    }
    if (code === "NO_BATCHES") return fail("لا دفعات نشطة لجردها", 400);
    if (code === "TOO_MANY")
      return fail(`عدد الدفعات يتجاوز حد الجلسة (${STOCK_COUNT_MAX_BATCHES})`, 400);
    console.error("stocktake POST failed:", e);
    return fail("تعذر فتح جلسة الجرد", 500);
  }
}
