import { toInt } from "./money";

// ─────────────── منطق المشتريات النقي (v3.2) ───────────────
// دوال بلا I/O — تُختبر وحدوياً وتُستخدم في مسارات API.

export interface POItemInput {
  medicineId: string;
  quantity: number;
  unitCost: number; // هللات
  lotNumber?: string | null;
  expiryDate?: string | null;
}

export interface NormalizedPOItem {
  medicineId: string;
  quantity: number;
  unitCost: number;
  lotNumber: string | null;
  expiryDate: Date | null;
}

export type NormalizeResult =
  | { ok: true; items: NormalizedPOItem[]; totalHalalas: number }
  | { ok: false; error: string };

/** إجمالي أمر الشراء بالهللات — ضبط صحيح بلا فاصلة عائمة */
export function computePOTotal(items: { quantity: number; unitCost: number }[]): number {
  return items.reduce((sum, it) => sum + Math.max(0, it.quantity) * Math.max(0, it.unitCost), 0);
}

/** تطبيع بنود أمر الشراء القادمة من الواجهة — يرمي Error برسالة عربية عند الخطأ */
export function normalizePOItems(raw: unknown): NormalizeResult {
  if (!Array.isArray(raw) || raw.length === 0)
    return { ok: false, error: "أمر الشراء يحتاج بنداً واحداً على الأقل" };
  if (raw.length > 100) return { ok: false, error: "الحد الأقصى 100 بند للأمر الواحد" };

  const items: NormalizedPOItem[] = [];
  const seen = new Set<string>();
  for (const r of raw as Record<string, unknown>[]) {
    const medicineId = String(r.medicineId ?? "").trim();
    if (!medicineId) return { ok: false, error: "كل بند يحتاج دواءً محدداً" };
    if (seen.has(medicineId))
      return { ok: false, error: "لا تكرر نفس الدواء في الأمر — ادمج الكمية في بند واحد" };
    seen.add(medicineId);

    const quantity = toInt(r.quantity, 0);
    if (quantity <= 0) return { ok: false, error: "كمية كل بند يجب أن تكون موجبة" };
    if (quantity > 1_000_000) return { ok: false, error: "كمية غير منطقية" };

    const unitCost = Math.max(0, toInt(r.unitCost, 0));

    let expiryDate: Date | null = null;
    const expRaw = String(r.expiryDate ?? "").trim();
    if (expRaw) {
      expiryDate = new Date(expRaw);
      if (isNaN(expiryDate.getTime())) return { ok: false, error: "تاريخ صلاحية غير صالح" };
    }

    items.push({
      medicineId,
      quantity,
      unitCost,
      lotNumber: String(r.lotNumber ?? "").trim() || null,
      expiryDate,
    });
  }
  return { ok: true, items, totalHalalas: computePOTotal(items) };
}

export interface BatchLike {
  lotNumber: string;
  quantity: number;
  expiryDate: Date;
  unitCost: number;
}

/** دمج استلام بند في دفعة قائمة (نفس التشغيلة) — دلالات الاستلام الواقعية:
 *  الكمية تُجمع، الصلاحية تبقى (تُفحص تطابقها)، التكلفة تُحدَّث لآخر شراء. */
export function mergeIntoBatch(
  batch: BatchLike,
  item: { quantity: number; unitCost: number }
): BatchLike {
  return {
    ...batch,
    quantity: batch.quantity + Math.max(0, item.quantity),
    unitCost: item.unitCost > 0 ? item.unitCost : batch.unitCost,
  };
}

/** اختيار رقم تشغيلة تلقائي عند غيابه: PO-<رقم الأمر>-<تسلسل البند> */
export function autoLotNumber(poNumber: number, itemIndex: number): string {
  return `PO-${poNumber}-${String(itemIndex + 1).padStart(2, "0")}`;
}
