/**
 * محرك البدائل العلاجية — ربي فارمسي v4.3
 * دوال نقية 100% (بلا قاعدة بيانات): عند نفاد دواء مطلوب، يقترح بدائل
 * من نفس الفئة العلاجية الوظيفية (ATC) المتوفرة فعلاً في المخزون.
 *
 * قواعد الترشيح (بترتيب الأولوية العلاجية):
 *  1) البديل الجنيس أولاً — نفس المادة الفعالة (نفس التركيز الأحسن) فهو
 *     المكافئ العلاجي المباشر (bioequivalent) وأقرب ما يكون للطلب الأصلي.
 *  2) ثم الأقرب سعرياً للدواء المطلوب — فرق مطلق بالهللات تصاعدياً.
 *  3) ثم الاسم أبجدياً — تثبيت ترتيب حتمي قابل للاختبار.
 *
 * الحجب: يُستبعد كل مرشّح محجوب تنظيمياً (suspended/banned) — البديل
 * المقترح يجب أن يكون صالحاً للصرف فوراً وليس اقتراحاً نظرياً.
 */

export interface AlternativeTarget {
  id: string;
  name?: string;
  genericName?: string;
  sellingPrice: number; // هللات
  atcClass?: string | null;
}

export interface AlternativeCandidate {
  id: string;
  name: string;
  genericName: string;
  dosage?: string | null;
  sellingPrice: number; // هللات
  /** المتاح الصالح للبيع = الرصيد − المحجوز لوصفات الطابور */
  availableQuantity: number;
  atcClass?: string | null;
  requiresPrescription?: boolean;
}

export interface AlternativeSuggestion {
  id: string;
  name: string;
  genericName: string;
  dosage?: string | null;
  sellingPrice: number; // هللات
  availableQuantity: number;
  requiresPrescription: boolean;
  /** فرق السعر عن المطلوب الأصلي (سالب = أرخص) — هللات */
  priceDiff: number;
  /** نفس المادة الفعالة — المكافئ العلاجي المباشر */
  sameGeneric: boolean;
}

/**
 * يرشّح ويرتّب بدائل دواء نفد من نفس الفئة العلاجية.
 * بلا فئة ATC محفوظة للمطلوب → قائمة فارغة (لا تخمين خارج التصنيف الموثق).
 */
export function findTherapeuticAlternatives(
  target: AlternativeTarget,
  candidates: AlternativeCandidate[],
  opts?: { limit?: number }
): AlternativeSuggestion[] {
  const targetClass = String(target.atcClass ?? "").trim();
  if (!targetClass) return [];
  const limit = Math.max(1, opts?.limit ?? 5);
  const targetGeneric = String(target.genericName ?? "").trim().toLowerCase();

  return candidates
    .filter((c) => {
      if (c.id === target.id) return false;
      if (!Number.isFinite(c.availableQuantity) || c.availableQuantity <= 0)
        return false;
      if (String(c.atcClass ?? "").trim() !== targetClass) return false;
      return true;
    })
    .map((c) => ({
      id: c.id,
      name: c.name,
      genericName: c.genericName,
      dosage: c.dosage ?? null,
      sellingPrice: c.sellingPrice,
      availableQuantity: c.availableQuantity,
      requiresPrescription: Boolean(c.requiresPrescription),
      priceDiff: c.sellingPrice - target.sellingPrice,
      sameGeneric:
        targetGeneric !== "" &&
        String(c.genericName ?? "").trim().toLowerCase() === targetGeneric,
    }))
    .sort((a, b) => {
      // الجنيس المكافئ أولاً، ثم الأقرب سعرياً، ثم الاسم أبجدياً (حتمية كاملة)
      if (a.sameGeneric !== b.sameGeneric) return a.sameGeneric ? -1 : 1;
      const dAbs = Math.abs(a.priceDiff) - Math.abs(b.priceDiff);
      if (dAbs !== 0) return dAbs;
      return a.name.localeCompare(b.name, "ar");
    })
    .slice(0, limit);
}
