import { NextRequest } from "next/server";
import { Batch } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, ok, requireAuth, requireRole } from "@/lib/api-guard";
import { parseRegistryStatus, REGISTRY_STATUS_LABEL } from "@/lib/registry";

/**
 * GET /api/registry — حالة السجل الوطني للدواء
 * الأدوية مع حالة تسجيلها + الإجراءات التنظيمية النشطة (سجل اليقظة الدوائية)
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const [medicines, actions] = await Promise.all([
      db.medicine.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          genericName: true,
          barcode: true,
          manufacturer: true,
          registrationNo: true,
          registryStatus: true,
          maxRetailPrice: true,
          sellingPrice: true,
        },
        orderBy: { name: "asc" },
      }),
      db.regulatoryAction.findMany({
        where: { isActive: true },
        include: {
          medicine: { select: { name: true, genericName: true, barcode: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    return ok({ medicines, actions });
  } catch {
    return fail("تعذر جلب السجل الوطني", 500);
  }
}

/**
 * POST /api/registry — إصدار قرار تنظيمي (مدير فقط — نمط الهيئة المختصة)
 * actionType:
 *  - suspension: تعليق وقائي (يحجب الصرف فوراً بلا تجاوز)
 *  - ban: حظر نهائي (يحجب الصرف بلا تجاوز)
 *  - recall: سحب دفعة LOT (scope=lot + lotNumber إلزامي) — الدفعة تخرج من
 *    التداول فوراً ويُفعَّل التتبع الأمامي لمرضى أصابهم الصرف منها
 *  - reinstatement: رفع القرار/إعادة التسجيل — يطفئ الإجراءات السابقة
 *  - price_cap: سقف سعر بيع وطني (value بالهللات إلزامي)
 * السبب إلزامي في كل الحالات — التوثيق أساس اليقظة الدوائية.
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireRole("admin");
  if (error) return error;

  try {
    const body = await request.json();
    const medicineId = String(body.medicineId ?? "").trim();
    const actionType = String(body.actionType ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    const source = String(body.source ?? "").trim() || "SFDA";
    const scope = String(body.scope ?? "product").trim() === "lot" ? "lot" : "product";
    const lotNumber = String(body.lotNumber ?? "").trim();
    const value = Number.isFinite(Number(body.value)) ? Math.round(Number(body.value)) : null;

    if (!medicineId) return fail("معرّف الدواء مطلوب");
    if (!reason) return fail("سبب القرار التنظيمي إلزامي — لا قرار بلا توثيق");
    if (!["suspension", "ban", "recall", "reinstatement", "price_cap"].includes(actionType))
      return fail("نوع الإجراء غير معروف");
    if (actionType === "recall") {
      if (scope !== "lot") return fail("سحب الدفعات يتم بنطاق lot");
      if (!lotNumber) return fail("رقم التشغيلة (LOT) مطلوب لسحب دفعة");
    }
    if (actionType === "price_cap" && (!value || value <= 0))
      return fail("سقف السعر (value بالهللات) مطلوب");

    const medicine = await db.medicine.findUnique({ where: { id: medicineId } });
    if (!medicine) return fail("الدواء غير موجود", 404);

    const result = await db.$transaction(async (tx) => {
      // سحب دفعة: علّم الدفعة + أفرغها من الصرف
      let recalledBatch: Batch | null = null;
      if (actionType === "recall") {
        const batch = await tx.batch.findUnique({
          where: { medicineId_lotNumber: { medicineId, lotNumber } },
        });
        if (!batch) throw new Error("BATCH_NOT_FOUND");
        if (batch.isRecalled) throw new Error("ALREADY_RECALLED");
        recalledBatch = await tx.batch.update({
          where: { id: batch.id },
          data: { isRecalled: true, recalledAt: new Date() },
        });
      }

      // إعادة التسجيل تُطفئ الإجراءات النشطة السابقة (رفع القرار)
      if (actionType === "reinstatement") {
        await tx.regulatoryAction.updateMany({
          where: { medicineId, isActive: true },
          data: { isActive: false },
        });
      }

      const action = await tx.regulatoryAction.create({
        data: {
          medicineId,
          actionType,
          scope: actionType === "recall" ? "lot" : scope,
          lotNumber: actionType === "recall" ? lotNumber : null,
          reason,
          source,
          value: actionType === "price_cap" ? value : null,
          createdBy: user.id,
          isActive: actionType !== "reinstatement",
        },
      });

      // مزامنة حالة التسجيل على الدواء
      let registryStatus: string | undefined;
      if (actionType === "suspension") registryStatus = "suspended";
      else if (actionType === "ban") registryStatus = "banned";
      else if (actionType === "reinstatement") registryStatus = "registered";
      else if (actionType === "price_cap") {
        await tx.medicine.update({
          where: { id: medicineId },
          data: { maxRetailPrice: value! },
        });
      }
      if (registryStatus) {
        await tx.medicine.update({
          where: { id: medicineId },
          data: { registryStatus },
        });
      }

      await tx.notification.create({
        data: {
          kind: "info",
          title: `قرار تنظيمي (${source}): ${medicine.name}`,
          body: reason,
          dedupeKey: `reg:${action.id}`,
        },
      });

      return { action, recalledBatch };
    });

    const labels: Record<string, string> = {
      suspension: "تعليق وقائي",
      ban: "حظر",
      recall: "سحب دفعة",
      reinstatement: "رفع القرار",
      price_cap: "سقف سعر",
    };

    return ok(
      {
        action: result.action,
        recalledBatch: result.recalledBatch,
        message: `صدر قرار «${labels[actionType]}» على ${medicine.name}${actionType === "recall" ? ` — دفعة ${lotNumber} خارج التداول` : ""}`,
      },
      201
    );
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "BATCH_NOT_FOUND") return fail("الدفعة غير موجودة لهذا الدواء", 404);
      if (e.message === "ALREADY_RECALLED") return fail("الدفعة مسحوبة مسبقاً", 409);
    }
    return fail("تعذر إصدار القرار التنظيمي", 500);
  }
}

// ملاحظة: parseRegistryStatus و REGISTRY_STATUS_LABEL متاحان للواجهات عبر @/lib/registry
export const _registryHelpers = { parseRegistryStatus, REGISTRY_STATUS_LABEL };
