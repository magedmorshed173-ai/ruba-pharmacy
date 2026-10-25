/**
 * مُخصِّص FEFO — First-Expired-First-Out
 * توزيع الكمية المطلوبة على الدفعات: الأقرب انتهاءً أولاً، مع تجاهل
 * الدفعات المنتهية الصلاحية (أو التي تنتهي في يوم البيع).
 * دالة نقية 100% — قابلة للاختبار الوحدوي بلا قاعدة بيانات.
 */

export interface FefoBatch {
  id: string;
  lotNumber: string;
  quantity: number;
  expiryDate: Date;
}

export interface FefoAllocation {
  batchId: string;
  lotNumber: string;
  quantity: number;
  expiryDate: Date;
}

export interface FefoResult {
  allocations: FefoAllocation[];
  /** الوحدات التي لم تُغطَّى من الطلب (نفاد فعلي بعد استبعاد المنتهي) */
  shortfall: number;
}

/** هل انتهت صلاحية الدفعة عند/قبل اليوم المحدد؟ (حدّ اليوم شامل = 00:00) */
export function isExpired(batch: { expiryDate: Date }, onDate: Date): boolean {
  const dayStart = new Date(onDate);
  dayStart.setHours(0, 0, 0, 0);
  return batch.expiryDate.getTime() <= dayStart.getTime();
}

/**
 * يوزّع الطلب على الدفعات مرتبةً بالصلاحية الأقرب.
 * الدفعات المنتهية تُستبعد كلياً (لا صرف منها قانوناً).
 */
export function allocateFefo(
  batches: FefoBatch[],
  requestedQty: number,
  onDate: Date = new Date()
): FefoResult {
  const allocations: FefoAllocation[] = [];
  let remaining = Math.max(0, Math.floor(requestedQty));

  if (remaining === 0) return { allocations, shortfall: 0 };

  const usable = batches
    .filter((b) => b.quantity > 0 && !isExpired(b, onDate))
    .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());

  for (const batch of usable) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    if (take > 0) {
      allocations.push({
        batchId: batch.id,
        lotNumber: batch.lotNumber,
        quantity: take,
        expiryDate: batch.expiryDate,
      });
      remaining -= take;
    }
  }

  return { allocations, shortfall: remaining };
}
