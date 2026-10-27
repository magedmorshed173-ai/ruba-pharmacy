/**
 * محرك إعادة الطلب الذكي — ربي فارمسي v4.3
 * دوال نقية 100% (بلا قاعدة بيانات): تحويل سرعة الصرف الفعلية إلى قرار
 * شراء قابل للتنفيذ — نقطة إعادة الطلب، المخزون المستهدف، الكمية المقترحة.
 *
 * المنهجية (نمط إدارة المخزون الكلاسيكي reorder-point policy):
 *  - dailyVelocity  = مبيعات النافذة ÷ أيامها
 *  - daysOfCover    = الرصيد ÷ السرعة (كم يوماً يكفي الرصيد؟)
 *  - reorderPoint   = السرعة × (زمن التوريد + مخزون الأمان) — نزول تحته يستوجب الطلب
 *  - targetStock    = السرعة × (أيام التغطية المستهدفة + زمن التوريد)
 *  - suggestedOrder = الرصيد ≤ نقطة الطلب؟ (المستهدف − الرصيد) : 0
 *
 * الفرق عن سلوك v3.3 الساكن: لا نطلب «الفرق حتى 30 يوماً» دائماً —
 * نطلب فقط عند نزول التغطية تحت نقطة الأمان، فنمنع التكدس ونمنع النضوب معاً.
 * بلا مبيعات: نسقط إلى حد التنبيه اليدوي (minQuantity) — سلوك محافظ موثق.
 */

export interface ReorderMetricsInput {
  quantity: number; // الرصيد الحالي
  minQuantity: number; // حد التنبيه اليدوي
  soldQty: number; // الوحدات المبيعة خلال النافذة
  windowDays: number; // عرض النافذة بالأيام (عادة 30)
  /** أيام التغطية المستهدفة بعد الاستلام (افتراضي 30) */
  targetDays?: number;
  /** زمن التوريد المتوقع من المورد بالأيام (افتراضي 7) */
  leadDays?: number;
  /** أيام مخزون الأمان ضد تذبذب الطلب (افتراضي 7) */
  safetyDays?: number;
}

export interface ReorderMetrics {
  dailyVelocity: number;
  daysOfCover: number | null;
  /** نزول الرصيد تحته يستوجب الطلب */
  reorderPoint: number;
  /** الرصيد المستهدف بعد استلام الطلب */
  targetStock: number;
  /** الكمية المقترح طلبها — صفر يعني «كافٍ» */
  suggestedOrder: number;
  /** هل القرار مبني على سرعة بيع فعلية أم سقط إلى حد التنبيه؟ */
  velocityBased: boolean;
}

function ceil(n: number): number {
  return Math.ceil(Math.max(0, n - 1e-9)); // حارس فاصلة عائمة (0.30000000004)
}

export function computeReorderMetrics(input: ReorderMetricsInput): ReorderMetrics {
  const quantity = Math.max(0, Math.floor(input.quantity || 0));
  const minQuantity = Math.max(0, Math.floor(input.minQuantity || 0));
  const soldQty = Math.max(0, input.soldQty || 0);
  const windowDays = Math.max(1, input.windowDays || 30);
  const targetDays = Math.max(1, input.targetDays ?? 30);
  const leadDays = Math.max(0, input.leadDays ?? 7);
  const safetyDays = Math.max(0, input.safetyDays ?? 7);

  const dailyVelocity = soldQty / windowDays;

  if (dailyVelocity > 0) {
    const daysOfCover = quantity / dailyVelocity;
    const reorderPoint = ceil(dailyVelocity * (leadDays + safetyDays));
    const targetStock = ceil(dailyVelocity * (targetDays + leadDays));
    const suggestedOrder =
      quantity <= reorderPoint ? Math.max(1, targetStock - quantity) : 0;
    return {
      dailyVelocity: Math.round(dailyVelocity * 1000) / 1000,
      daysOfCover: Math.round(daysOfCover * 10) / 10,
      reorderPoint,
      targetStock,
      suggestedOrder,
      velocityBased: true,
    };
  }

  // بلا مبيعات بالنافذة — سلوك محافظ: املأ حتى حد التنبيه فقط
  return {
    dailyVelocity: 0,
    daysOfCover: null,
    reorderPoint: minQuantity,
    targetStock: minQuantity,
    suggestedOrder: Math.max(0, minQuantity - quantity),
    velocityBased: false,
  };
}

/** صف جاهز للتجميع بمورد — المورد مستنتج من آخر أمر شراء للدواء */
export interface GroupableReorderRow {
  lastSupplierId?: string | null;
}

export interface ReorderSupplierGroup<T extends GroupableReorderRow> {
  /** null = أدوية بلا مورد معروف (لم تُشترَ سابقاً عبر النظام) */
  supplierId: string | null;
  rows: T[];
}

/**
 * يجمع صفوف إعادة الطلب حسب المورد الأخير لكل دواء — أساس توليد أوامر
 * شراء مسودّة دفعة واحدة: مجموعة لكل مورد + مجموعة «بلا مورد معروف».
 * ترتيب المجموعات حسب أول ظهور (حتمي)، وترتيب الصفوف محفوظ كما وردت.
 */
export function groupReorderRowsBySupplier<T extends GroupableReorderRow>(
  rows: T[]
): ReorderSupplierGroup<T>[] {
  const buckets = new Map<string | null, T[]>();
  for (const row of rows) {
    const key = row.lastSupplierId ?? null;
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  return Array.from(buckets.entries()).map(([supplierId, groupRows]) => ({
    supplierId,
    rows: groupRows,
  }));
}
