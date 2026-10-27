/**
 * الطبقة النقية للتأمين الطبي — v4.6 (P2)
 * قواعد تقسيم المطلوب المالي بين المؤمن والمريض + صلاحية البوليصة
 * + آلة حالات المطالبة — بلا قاعدة بيانات ولا Node APIs
 * (نمط zatca.ts: اختبار 100% بلا محاكاة).
 *
 * معيار التغطية: أساس النقطة (bps) بأعداد صحيحة — 10000 = 100%، 7000 = 70% —
 * بلا كسور عشرية إطلاقاً (نفس فلسفة الهللات في money.ts).
 */

/** التغطية الكاملة — أساس النقطة */
export const FULL_COVERAGE_BPS = 10000;

/** لقطة حقول البوليصة اللازمة للقرار — تُمرَّر من القاعدة أو من الاختبارات */
export interface PolicySnapshot {
  isActive: boolean;
  expiryDate: Date | string | null;
  /** أساس النقطة: 0..10000 */
  coverageBps: number;
  /** مشاركة ثابتة على المريض قبل النسبة — هللات */
  copayFixed?: number | null;
}

export interface InsuranceSplit {
  /** حصة المؤمن — هللات */
  insurerDue: number;
  /** حصة المريض — هللات (insurerDue + patientDue = الإجمالي دائماً) */
  patientDue: number;
}

// ─── تقسيم المطلوب المالي ───────────────────────────────────────────────

/**
 * تقسيم الفاتورة بين المؤمن والمريض — القواعد:
 *  1) المشاركة الثابتة copayFixed (إن وُجدت) على المريض كاملةً أولاً
 *     (ولا تتجاوز الإجمالي مهما كتب الموظف).
 *  2) المتبقي يُقسم بنسبة التغطية — حصة المؤمن تُقرَّب لأسفل (floor)
 *     والمريض يتحمل الباقي — قاعدة محافظة لصالح صندوق الصيدلية
 *     (لا يتكفل الصيدلية بكسور الهللات بدل المؤمن).
 *
 * الضمان: insurerDue + patientDue = totalHalalas دائماً — بلا هالك مالي.
 */
export function splitInsurancePayment(
  totalHalalas: number,
  coverageBps: number,
  copayFixedHalalas?: number | null
): InsuranceSplit {
  const total = Math.round(totalHalalas);
  if (!Number.isFinite(total) || total <= 0) return { insurerDue: 0, patientDue: 0 };

  // نسبة التغطية خارج المدى تُقتصر (لا ترمي — البيع لا يتعطل بسبب إعداد شركة)
  const bps = Math.min(FULL_COVERAGE_BPS, Math.max(0, Math.round(coverageBps) || 0));

  const copay = Math.min(total, Math.max(0, Math.round(copayFixedHalalas ?? 0) || 0));
  const remaining = total - copay;
  const insurerDue = Math.floor((remaining * bps) / FULL_COVERAGE_BPS);
  return { insurerDue, patientDue: total - insurerDue };
}

/** «7000 → 70%» و«7250 → 72.5%» — للعرض فقط */
export function coveragePercentLabel(bps: number): string {
  const v = (Math.round(bps) || 0) / 100;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

// ─── صلاحية البوليصة ────────────────────────────────────────────────────

export type PolicyBlockReason = "inactive" | "expired" | "coverage";

export const POLICY_BLOCK_LABEL: Record<PolicyBlockReason, string> = {
  inactive: "البوليصة غير مفعّلة",
  expired: "البوليصة منتهية الصلاحية",
  coverage: "نسبة التغطية في البوليصة غير صالحة",
};

/**
 * فحص قابلية استخدام البوليصة اليوم — يعيد سبب الحجب أو null إن كانت صالحة.
 * البوليصة صالحة حتى نهاية يوم انتهائها (قاعدة عملية في شباك الصرف).
 */
export function assertPolicyUsable(
  policy: PolicySnapshot,
  today: Date = new Date()
): PolicyBlockReason | null {
  if (!policy.isActive) return "inactive";

  if (policy.expiryDate !== null && policy.expiryDate !== undefined) {
    const expiry = policy.expiryDate instanceof Date
      ? policy.expiryDate
      : new Date(policy.expiryDate);
    if (!Number.isNaN(expiry.getTime())) {
      const endOfExpiryDay = new Date(expiry);
      endOfExpiryDay.setHours(23, 59, 59, 999);
      if (endOfExpiryDay.getTime() < today.getTime()) return "expired";
    }
  }

  const bps = policy.coverageBps;
  if (!Number.isInteger(bps) || bps < 0 || bps > FULL_COVERAGE_BPS) return "coverage";

  return null;
}

// ─── آلة حالات المطالبة ─────────────────────────────────────────────────

export const CLAIM_STATUSES = ["pending", "approved", "rejected", "paid"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/**
 * الانتقالات المسموحة:
 *  - pending  → approved | rejected
 *  - approved → paid
 *  - rejected → pending (إعادة فتح بعد تدبير المستندات)
 *  - paid     → نهائية بلا رجوع (المال حُصّل)
 */
export const CLAIM_TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  pending: ["approved", "rejected"],
  approved: ["paid"],
  rejected: ["pending"],
  paid: [],
};

export function isClaimStatus(v: unknown): v is ClaimStatus {
  return typeof v === "string" && (CLAIM_STATUSES as readonly string[]).includes(v);
}

/** الانتقال مسموح؟ — يرمي خطأً عربياً واضحاً عند المخالفة (يحوّله المسار لاستجابة) */
export function assertClaimTransition(from: string, to: string): void {
  if (!isClaimStatus(from) || !isClaimStatus(to))
    throw new Error("حالة مطالبة غير معروفة");
  if (!(CLAIM_TRANSITIONS[from] as readonly string[]).includes(to))
    throw new Error(`انتقال غير مسموح: من «${claimStatusLabel(from)}» إلى «${claimStatusLabel(to)}»`);
}

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  pending: "بانتظار المراجعة",
  approved: "معتمدة",
  rejected: "مرفوضة",
  paid: "محصّلة",
};

export function claimStatusLabel(s: string | null | undefined): string {
  return isClaimStatus(s) ? CLAIM_STATUS_LABEL[s] : "—";
}
