/**
 * v5.2 — منطق تحويلات المخزون بين الفروع (نقي — بلا قاعدة بيانات)
 *
 * الدلالة الموثقة (تتمة قرار v4.6 «المخزون مركزي واحد»):
 *  • الرصيد المركزي `Medicine.quantity` هو الفعلي دائماً.
 *  • `BranchStock.quantity` = الكمية المخصَّصة (الموجودة عملياً) عند الفرع —
 *    مرآة تشغيلية لا مخزون مستقل.
 *  • الثابت المحفوظ: مجموع المخصص ≤ المركزي. يحقّقه كل مسار:
 *    التحويل من المستودع يتحقق من «غير المخصص»، والبيع/الإلغاء يخصم/يرجع
 *    من المرآة والمركز معاً، والتحويل بين فرعين ينقل بين مرايا.
 *  • الأدوية بلا صفوف توزيع تباع كما كانت (توافق كامل مع الواقع الحالي).
 */

export const TRANSFER_STATUSES = ["pending", "accepted", "cancelled"] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const TRANSFER_STATUS_AR: Record<TransferStatus, string> = {
  pending: "معلّق",
  accepted: "مقبول",
  cancelled: "ملغى",
};

export interface TransferInput {
  medicineId: string;
  /** null = من المستودع المركزي (غير المخصص) */
  fromBranchId: string | null;
  toBranchId: string;
  quantity: number;
  note?: string | null;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** تحقق شكل التحويل قبل لمس القاعدة — رسائل عربية جاهزة للعرض */
export function validateTransferInput(input: TransferInput): ValidationResult {
  const qty = Math.floor(Number(input.quantity));
  if (!input.medicineId || !String(input.medicineId).trim())
    return { ok: false, error: "اختر الدواء المطلوب تحويله" };
  if (!Number.isFinite(qty) || qty <= 0)
    return { ok: false, error: "الكمية يجب أن تكون عدداً موجباً" };
  if (qty > 1_000_000) return { ok: false, error: "الكمية أكبر من الحد المعقول" };
  if (!input.toBranchId || !String(input.toBranchId).trim())
    return { ok: false, error: "اختر الفرع المستلم" };
  const from = input.fromBranchId ? String(input.fromBranchId).trim() : null;
  if (from && from === String(input.toBranchId).trim())
    return { ok: false, error: "لا يمكن التحويل من فرع إلى نفسه" };
  if (input.note && input.note.length > 300)
    return { ok: false, error: "الملاحظة أطول من 300 حرف" };
  return { ok: true };
}

/* ── خطة التنفيذ (قبول التحويل) ────────────────────────────────────── */

export interface AcceptContext {
  /** رصيد التحويل المطلوب تنفيذه */
  quantity: number;
  /** المستودع؟ (fromBranchId = null) */
  fromWarehouse: boolean;
  /** رصيد فرع المصدر (يُتجاهل إن كان من المستودع) */
  fromBranchStock: number | null;
  /** الرصيد المركزي الحالي */
  centralQuantity: number;
  /** مجموع المخصص لكل الفروع الحالي (يشمل فرع المصدر) */
  totalAssigned: number;
}

export type AcceptPlan =
  | {
      ok: true;
      /** الكميات المطبَّقة — تُنفَّذ upsert داخل المعاملة */
      ops: {
        targetBranchDelta: number;
        sourceBranchDelta: number; // 0 عند التحويل من المستودع
      };
    }
  | { ok: false; error: string };

/**
 * حساب قبول التحويل من الحالة الحية للقاعدة:
 *  • من المستودع: المتاح غير المخصص = المركزي − مجموع المخصص.
 *  • من فرع: رصيده يجب أن يكفي.
 * نقي وحتمي — يُستدعى داخل معاملة القبول بعد قراءة الأرقام الطازجة.
 */
export function planAccept(ctx: AcceptContext): AcceptPlan {
  const qty = Math.floor(Number(ctx.quantity));
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "كمية التحويل غير صحيحة" };

  if (ctx.fromWarehouse) {
    const unassigned = ctx.centralQuantity - ctx.totalAssigned;
    if (qty > unassigned) {
      return {
        ok: false,
        error: `غير المخصص في المستودع ${Math.max(unassigned, 0)} فقط — المطلوب ${qty}`,
      };
    }
    return { ok: true, ops: { targetBranchDelta: qty, sourceBranchDelta: 0 } };
  }

  const src = ctx.fromBranchStock ?? 0;
  if (qty > src) {
    return {
      ok: false,
      error: `رصيد فرع المصدر ${src} فقط — المطلوب ${qty}`,
    };
  }
  return { ok: true, ops: { targetBranchDelta: qty, sourceBranchDelta: -qty } };
}

/* ── بوابة البيع من فرع مُوزَّع ─────────────────────────────────────── */

export interface SaleGateResult {
  allowed: boolean;
  /** نص عربي جاهز للعرض عند الرفض */
  message?: string;
  /** الكمية المخصومة من مرآة الفرع (0 = لا تخصيص) */
  branchDelta: number;
}

/**
 * قرار بوابة البيع حسب واقع التوزيع:
 *  • بلا صفوف توزيع للدواء ⇒ بلا بوابة (توافق كامل — الوضع الحالي).
 *  • مع توزيع: يجب رصيد فرع البيع أن يكفي؛ والغيابه يعني صفر مخصص.
 */
export function gateSaleForBranch(args: {
  /** هل للدواء صفوف توزيع أصلاً؟ */
  hasDistribution: boolean;
  /** فرع البيع (قد يكون null لموظف بلا فرع) */
  saleBranchId: string | null | undefined;
  /** رصيد مرآة فرع البيع (undefined = لا صف له) */
  branchStock: number | undefined;
  quantity: number;
  medicineName: string;
}): SaleGateResult {
  if (!args.hasDistribution) return { allowed: true, branchDelta: 0 };
  const qty = Math.floor(Number(args.quantity));
  const avail = args.branchStock ?? 0;
  if (!args.saleBranchId) {
    return {
      allowed: false,
      message: `«${args.medicineName}» مُوزَّع على الفروع والموظف بلا فرع معرَّف — عيّن الفرع أو وزّع من الإدارة`,
      branchDelta: 0,
    };
  }
  if (avail < qty) {
    return {
      allowed: false,
      message: `«${args.medicineName}» المتاح في فرعك ${avail} فقط من ${qty} — اطلب تحويلاً من الإدارة`,
      branchDelta: 0,
    };
  }
  return { allowed: true, branchDelta: -qty };
}

/** هل يقبل إلغاء الفاتورة رجوع الكمية لمرآة فرعها؟ (يُطبَّق فقط مع توزيع قائم) */
export function shouldRestoreBranchOnVoid(args: {
  hasDistribution: boolean;
  saleBranchId: string | null | undefined;
}): boolean {
  return args.hasDistribution && Boolean(args.saleBranchId);
}
