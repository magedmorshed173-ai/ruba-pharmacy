import Decimal from "decimal.js";

// النقود تُخزَّن بالهللات (أعداد صحيحة). كل العرض والحسابات عبر هنا.
// 1 ريال = 100 هللة

export function halalasToSar(halalas: number | string): string {
  return new Decimal(halalas).div(100).toFixed(2);
}

export function sarToHalalas(sar: string | number): number {
  return new Decimal(String(sar ?? 0)).mul(100).toDecimalPlaces(0).toNumber();
}

export function formatSar(halalas: number | string): string {
  const value = new Decimal(halalas).div(100);
  return `${value.toFixed(2)} ر.س`;
}

/** جمع آمن بالهللات (أعداد صحيحة) — النتيجة عدد صحيح بلا كسور */
export function sumHalalas(...values: (number | string)[]): number {
  return values.reduce<number>(
    (acc, v) => acc + Math.round(new Decimal(v ?? 0).toNumber()),
    0
  );
}

export function toInt(value: unknown, fallback = 0): number {
  try {
    const d = new Decimal(String(value ?? fallback));
    if (!d.isFinite()) return fallback;
    return d.toDecimalPlaces(0).toNumber();
  } catch {
    // مدخل غير رقمي (مثل "abc") — لا يجوز أن يُسقط الطلب (إصلاح v3.1)
    return fallback;
  }
}
