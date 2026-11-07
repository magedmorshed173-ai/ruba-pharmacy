import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/auth";
import { checkCentralInvariant, classifyRow } from "@/lib/stocktake";

/**
 * v5.6 — تطبيق فروقات الجرد (مدير حصراً)
 *
 * POST /api/stocktake/:id/apply — معاملة ذرية واحدة:
 *  1) قراءة البنود المجمّدة + الأرصدة الحية الطازجة للدفعات والأدوية.
 *  2) تصنيف كل بند مقابل الرصيد الحي (العدّ هو الحقيقة — ما بِيع أثناء
 *     الجلسة لا يُمحى، والفرق يقيس موقف «الآن»).
 *  3) بوابة الثابت «المخصص ≤ المركزي» لكل دواء يُخفَّض: لو خالفها عجزُ
 *     الجرد رُفض التطبيق كله (لا تطبيق جزئي) بقائمة محظورات عربية —
 *     يُرجَع من الفروع أولاً ثم يُعاد التطبيق.
 *  4) التطبيق: رصيد الدفعة = المعدود، medicine.quantity += الفرق، حركة
 *     مخزون «adjust» لكل فرق غير صفري برصيد بعده دقيق، تخزين الملخصات،
 *     وتوثيق stocktake.apply داخل نفس المعاملة.
 */

export const dynamic = "force-dynamic";

interface BlockedItem {
  medicineName: string;
  centralAfter: number;
  assigned: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireRole("admin");
  if (error) return error;

  const { id } = await params;
  try {
    const summary = await db.$transaction(async (tx) => {
      const count = await tx.stockCount.findUnique({ where: { id } });
      if (!count) throw new Error("NOT_FOUND");
      if (count.status !== "open") throw new Error("NOT_OPEN");

      const items = await tx.stockCountItem.findMany({ where: { countId: id } });
      const liveBatches = await tx.batch.findMany({
        where: { id: { in: items.map((i) => i.batchId) } },
        select: { id: true, medicineId: true, quantity: true },
      });
      const batchById = new Map(liveBatches.map((b) => [b.id, b]));

      // الأدوية المتأثرة فعلاً: بنود معدهّة دفعتها حية — تجميع فروقها لكل دواء
      const deltas = new Map<string, number>(); // medicineId → مجموع الفروق
      type Prepared = {
        item: (typeof items)[number];
        batch: { id: string; medicineId: string; quantity: number };
        countedQty: number;
        delta: number;
        costDelta: number;
        kind: "match" | "increase" | "decrease";
      };
      const prepared: Prepared[] = [];
      let skipped = 0;

      for (const item of items) {
        if (item.countedQty === null) {
          skipped += 1;
          continue;
        }
        const batch = batchById.get(item.batchId);
        if (!batch || batch.medicineId !== item.medicineId) {
          skipped += 1; // الدفعة حُذفت أثناء الجلسة — لا ما يُصحَّح
          continue;
        }
        const row = classifyRow({
          systemQty: batch.quantity, // الرصيد الحي وقت التطبيق
          countedQty: item.countedQty,
          unitCost: item.unitCost,
        });
        if (row.kind === "skipped") {
          skipped += 1;
          continue;
        }
        prepared.push({
          item,
          batch,
          countedQty: item.countedQty,
          delta: row.delta,
          costDelta: row.costDelta,
          kind: row.kind,
        });
        deltas.set(batch.medicineId, (deltas.get(batch.medicineId) ?? 0) + row.delta);
      }

      // بوابة الثابت — قراءة طازجة لكل دواء متأثر + مرايا فروعه
      const medIds = [...deltas.keys()];
      const medicines = await tx.medicine.findMany({
        where: { id: { in: medIds } },
        select: { id: true, name: true, quantity: true },
      });
      const medById = new Map(medicines.map((m) => [m.id, m]));
      const branchRows = await tx.branchStock.findMany({
        where: { medicineId: { in: medIds } },
        select: { medicineId: true, quantity: true },
      });
      const assignedBy = new Map<string, number>();
      for (const r of branchRows)
        assignedBy.set(r.medicineId, (assignedBy.get(r.medicineId) ?? 0) + r.quantity);

      const blocked: BlockedItem[] = [];
      for (const [medicineId, delta] of deltas) {
        const med = medById.get(medicineId);
        if (!med) continue; // الدواء حُذف — بنوده ستُتخطى أدناه بدقة أكثر
        const gate = checkCentralInvariant({
          centralQuantity: med.quantity,
          delta,
          totalAssigned: assignedBy.get(medicineId) ?? 0,
        });
        if (!gate.ok) {
          blocked.push({
            medicineName: med.name,
            centralAfter: med.quantity + delta,
            assigned: assignedBy.get(medicineId) ?? 0,
          });
        }
      }
      if (blocked.length > 0) {
        const e = new Error("INVARIANT") as Error & { blocked?: BlockedItem[] };
        e.blocked = blocked;
        throw e;
      }

      // التطبيق — رصيد «بعده» متتبَّع لكل دواء (تُكتب بحركة كل فرق)
      const balance = new Map<string, number>(); // medicineId → الرصيد الحي الجاري
      for (const m of medicines) balance.set(m.id, m.quantity);

      let matched = 0;
      let increased = 0;
      let decreased = 0;
      let netQtyDelta = 0;
      let netCostDelta = 0;

      for (const p of prepared) {
        const med = medById.get(p.batch.medicineId);
        if (!med) {
          skipped += 1;
          continue;
        }
        if (p.kind !== "match") {
          const newBalance = (balance.get(med.id) ?? med.quantity) + p.delta;
          balance.set(med.id, newBalance);

          await tx.batch.update({
            where: { id: p.batch.id },
            data: { quantity: p.countedQty }, // العدّ هو الحقيقة — قيمة مطلقة
          });
          await tx.medicine.update({
            where: { id: med.id },
            data: { quantity: { increment: p.delta } },
          });
          await tx.stockMovement.create({
            data: {
              medicineId: med.id,
              type: "adjust",
              delta: p.delta,
              balanceAfter: newBalance,
              reference: count.number,
              userId: user.id,
            },
          });
        }
        if (p.kind === "match") matched += 1;
        else if (p.kind === "increase") increased += 1;
        else decreased += 1;
        netQtyDelta += p.delta;
        netCostDelta += p.costDelta;
      }

      const updated = await tx.stockCount.update({
        where: { id },
        data: {
          status: "closed",
          closedById: user.id,
          closedAt: new Date(),
          countedItems: matched + increased + decreased,
          matchedItems: matched,
          increasedItems: increased,
          decreasedItems: decreased,
          skippedItems: skipped,
          netQtyDelta,
          netCostDelta,
        },
      });

      // v5.4 — التوثيق ذري مع التطبيق
      recordAudit(tx, {
        action: "stocktake.apply",
        entityType: "stockCount",
        entityId: id,
        summary: `تطبيق فروقات الجرد ${count.number}: ${matched + increased + decreased} بنداً (زيادة ${increased}، عجز ${decreased}، مطابق ${matched}، متخطى ${skipped}) — صافي ${netQtyDelta} وحدة`,
        meta: {
          number: count.number,
          batchesTotal: count.batchesTotal,
          countedItems: matched + increased + decreased,
          matched,
          increased,
          decreased,
          skipped,
          netQtyDelta,
          netCostDelta,
        },
        actor: user,
        ip: clientIp(request.headers),
      });

      return {
        number: updated.number,
        countedItems: updated.countedItems,
        matchedItems: matched,
        increasedItems: increased,
        decreasedItems: decreased,
        skippedItems: skipped,
        netQtyDelta,
        netCostDelta,
      };
    });

    return ok({ ok: true, summary });
  } catch (e) {
    const err = e as Error & { blocked?: BlockedItem[] };
    if (err.message === "NOT_FOUND") return fail("جلسة الجرد غير موجودة", 404);
    if (err.message === "NOT_OPEN")
      return fail("الجلسة ليست مفتوحة — سبق تطبيقها أو إلغاؤها", 409);
    if (err.message === "INVARIANT" && err.blocked) {
      const names = err.blocked.map((b) => `«${b.medicineName}»`).join("، ");
      return fail(
        `عجز الجرد يجعل رصيد المستودع أقل من المخصص للفروع: ${names} — أعد الكميات من الفروع أولاً ثم أعد التطبيق`,
        409,
        { blocked: err.blocked }
      );
    }
    console.error("stocktake apply failed:", e);
    return fail("تعذر تطبيق فروقات الجرد", 500);
  }
}
