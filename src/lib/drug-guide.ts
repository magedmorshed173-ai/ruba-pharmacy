/**
 * دليل الدواء الوطني (v4.0) — أدوات نقية 100%:
 *  1) تطبيع البحث العربي (همزات، تاء مربوطة، تشكيل، تطويل)
 *  2) مطابقة استعلام العميل مع بطاقة الدواء (تجاري/علمي لاتيني/علمي عربي/ATC/الشركة)
 *  3) ترتيب البدائل العلاجية بنفس المادة الفعالة — الأرخص أولاً مع حساب الوفر
 * التفاعلات الدوائية تعيد استخدام محرك clinical.ts كاملاً (normalizePair/SEVERITY_*).
 */

/** تطبيع نص عربي/لاتيني للبحث — يحل الهمزات والتاء المربوطة ويقص التشكيل والتطويل */
export function normalizeArabic(input: string): string {
  let s = String(input ?? "").trim().toLowerCase();
  // التشكيل (\u064B-\u065F) + التنوين والشدة + الألف الخنجرية + التطويل
  s = s.replace(/[\u064B-\u065F\u0670\u0640]/g, "");
  // توحيد الألف بأنواعها، الواو والياء المهموزتين، الألف المقصورة، التاء المربوطة
  s = s.replace(/[أإآٱ]/g, "ا").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ى/g, "ي").replace(/ة/g, "ه");
  s = s.replace(/\s+/g, " ");
  return s;
}

/** الحقول التي يُبحث فيها داخل بطاقة الدواء */
export interface DrugSearchFields {
  tradeName: string;
  scientificName: string;
  scientificNameAr?: string | null;
  atcCode?: string | null;
  atcClass?: string | null;
  manufacturer?: string | null;
}

/**
 * هل يطابق الدواء استعلام العميل؟
 * - استعلام فارغ = مطابقة (عرض الكل)
 * - المطابقة بعد التطبيع: جزئية (contains) على أي حقل — عربي أو لاتيني
 */
export function drugMatchesQuery(d: DrugSearchFields, rawQuery: string): boolean {
  const q = normalizeArabic(rawQuery);
  if (!q) return true;
  const hay = [
    d.tradeName,
    d.scientificName,
    d.scientificNameAr,
    d.atcCode,
    d.atcClass,
    d.manufacturer,
  ]
    .map((x) => normalizeArabic(String(x ?? "")))
    .filter(Boolean);
  return hay.some((h) => h.includes(q));
}

export interface AlternativeLike {
  id: string;
  tradeName: string;
  priceHalalas: number;
}

export interface RankedAlternative<T extends AlternativeLike> extends AlternativeLike {
  drug: T;
  /** الوفر مقابل سعر الدواء المرجعي (هللات) — موجب = البديل أرخص */
  savingsHalalas: number;
  /** نسبة الوفر من سعر المرجع (%) — سالبة = البديل أغلى */
  cheaperByPct: number;
}

/**
 * يرتب البدائل العلاجية (نفس المادة الفعالة) بسعر تصاعدي ثم أبجدياً،
 * ويحسب وفر كل بديل مقابل سعر الدواء المرجعي. المرجع نفسه مستبعد مسبقاً.
 */
export function rankAlternatives<T extends AlternativeLike>(
  referencePriceHalalas: number,
  list: T[]
): RankedAlternative<T>[] {
  const ref = Number(referencePriceHalalas) || 0;
  return [...list]
    .sort((a, b) =>
      a.priceHalalas - b.priceHalalas || String(a.tradeName).localeCompare(String(b.tradeName), "ar")
    )
    .map((d) => {
      const savings = ref - d.priceHalalas;
      const pct = ref > 0 ? Math.round((savings / ref) * 100) : 0;
      return {
        id: d.id,
        tradeName: d.tradeName,
        priceHalalas: d.priceHalalas,
        drug: d,
        savingsHalalas: savings,
        cheaperByPct: pct,
      };
    });
}
