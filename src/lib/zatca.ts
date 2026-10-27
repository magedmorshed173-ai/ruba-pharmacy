/**
 * الطبقة النقية لفوترة ZATCA — الفاتورة الضريبية المبسطة (المرحلة الأولى: QR)
 * v4.5 (P1) — متوافقة مع هيئة الزكاة والضريبة والجمارك السعودية:
 *
 *  1) ضريبة القيمة المضافة 15% بنموذج «السعر شامل الضريبة» (المعيار في الصيدليات):
 *     الضريبة = الإجمالي × 15 ÷ 115 — تقريب عادي (half-up) لأقرب هللة.
 *  2) رمز QR بترميز TLV (Tag-Length-Value) Base64 بالحقول الإلزامية الخمسة:
 *     1: اسم البائع | 2: الرقم الضريبي (15 رقماً) | 3: الطابع الزمني ISO 8601
 *     4: إجمالي الفاتورة (شامل الضريبة) | 5: إجمالي الضريبة
 *  3) الترقيم التسلسلي الإلزامي: INV-<سنة>-<تسلسل 6 خانات> — تصاعدي بلا فراغات.
 *
 * لا قاعدة بيانات ولا Node APIs هنا — اختبار 100% بلا محاكاة.
 */

export const ZATCA_VAT_RATE = 15;

export interface ZatcaSeller {
  /** اسم البائع كما في السجل — يظهر في QR (الوسم 1) */
  name: string;
  /** الرقم الضريبي للبائع — 15 رقماً إلزاماً (الوسم 2) */
  vatNumber: string;
}

// ─── الضريبة ────────────────────────────────────────────────────────────

/**
 * الضريبة المستخرجة من إجمالي شامل الضريبة: total × rate ÷ (100 + rate)
 * تقريب عادي لأقرب هللة (المدخل والمخرج هللات صحيحة).
 */
export function vatFromInclusive(totalHalalas: number, rate: number = ZATCA_VAT_RATE): number {
  if (!Number.isFinite(totalHalalas) || totalHalalas <= 0) return 0;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round((totalHalalas * rate) / (100 + rate));
}

/** الصافي قبل الضريبة = الإجمالي الشامل − الضريبة (لا يصبح سالباً أبداً) */
export function netOfVat(totalHalalas: number, vatHalalas: number): number {
  const vat = Math.max(0, Math.round(vatHalalas));
  return Math.max(0, Math.round(totalHalalas) - vat);
}

/** هللات → نص عشري بخانتين «11500 → "115.00"» — صيغة الفاتورة الإلزامية */
export function formatInvoiceMoney(halalas: number): string {
  if (!Number.isFinite(halalas)) return "0.00";
  return (Math.round(halalas) / 100).toFixed(2);
}

// ─── TLV / QR ───────────────────────────────────────────────────────────

/** طيّ حقل واحد: وسم بايت واحد + طول (عدد بايتات UTF-8) + القيمة */
export function tlv(tag: number, value: string): Uint8Array {
  const bytes = new TextEncoder().encode(String(value ?? ""));
  if (bytes.length > 255)
    throw new Error(`قيمة الوسم ${tag} تتجاوز 255 بايتاً — TLV لا يستوعبها`);
  const out = new Uint8Array(2 + bytes.length);
  out[0] = tag;
  out[1] = bytes.length;
  out.set(bytes, 2);
  return out;
}

/** الطابع الزمني الموحّد: «YYYY-MM-DDTHH:mm:ssZ» بتوقيت UTC وثوانٍ إلزامية */
export function normalizeInvoiceTimestamp(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) throw new Error("طابع زمني غير صالح");
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function assertSeller(seller: ZatcaSeller): void {
  if (!String(seller.name ?? "").trim()) throw new Error("اسم البائع مطلوب في QR");
  if (!/^\d{15}$/.test(String(seller.vatNumber ?? "")))
    throw new Error("الرقم الضريبي يجب أن يكون 15 رقماً بالأرقام اللاتينية");
}

export interface SimplifiedInvoiceParams {
  seller: ZatcaSeller;
  /** لحظة إصدار الفاتورة */
  issuedAt: Date | string;
  /** إجمالي الفاتورة شامل الضريبة — هللات */
  totalHalalas: number;
  /** إجمالي الضريبة — هللات (يُحسب تلقائياً من الإجمالي إذا أُهمل) */
  vatHalalas?: number;
}

/**
 * رمز QR للفاتورة الضريبية المبسطة — المرحلة الأولى (QR فقط بلا تكامل فاتورة):
 * ت concatenated TLV بالوسوم 1-5 ثم Base64 — النص الذي يُطبع على الفاتورة.
 */
export function buildSimplifiedQr(p: SimplifiedInvoiceParams): string {
  assertSeller(p.seller);
  const total = Math.max(0, Math.round(p.totalHalalas));
  const vat =
    p.vatHalalas !== undefined
      ? Math.max(0, Math.round(p.vatHalalas))
      : vatFromInclusive(total);
  if (vat > total) throw new Error("الضريبة لا يمكن أن تتجاوز الإجمالي");

  const parts: Uint8Array[] = [
    tlv(1, p.seller.name.trim()),
    tlv(2, p.seller.vatNumber),
    tlv(3, normalizeInvoiceTimestamp(p.issuedAt)),
    tlv(4, formatInvoiceMoney(total)),
    tlv(5, formatInvoiceMoney(vat)),
  ];
  const size = parts.reduce((n, b) => n + b.length, 0);
  const merged = new Uint8Array(size);
  let at = 0;
  for (const b of parts) {
    merged.set(b, at);
    at += b.length;
  }
  return Buffer.from(merged).toString("base64");
}

export interface ParsedSimplifiedQr {
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  total: string;
  vat: string;
}

/** مفكّك تشخيصي — يتحقق من QR مطبوع (اختبارات round-trip وأدوات التدقيق) */
export function parseSimplifiedQr(b64: string): ParsedSimplifiedQr {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(String(b64 ?? ""), "base64"));
  } catch {
    throw new Error("QR ليس Base64 صالحاً");
  }
  if (bytes.length < 2) throw new Error("QR أقصر من TLV واحد");
  const out: Partial<ParsedSimplifiedQr> = {};
  let at = 0;
  while (at + 2 <= bytes.length) {
    const tag = bytes[at];
    const len = bytes[at + 1];
    if (at + 2 + len > bytes.length) throw new Error(`طول الوسم ${tag} يتجاوز حدود البيانات`);
    const value = new TextDecoder().decode(bytes.subarray(at + 2, at + 2 + len));
    if (tag === 1) out.sellerName = value;
    else if (tag === 2) out.vatNumber = value;
    else if (tag === 3) out.timestamp = value;
    else if (tag === 4) out.total = value;
    else if (tag === 5) out.vat = value;
    // وسوم مجهولة (مستقبلية) تُتخطى بصمت — توافق أمامي
    at += 2 + len;
  }
  if (out.sellerName === undefined) throw new Error("وسم اسم البائع (1) مفقود");
  return out as ParsedSimplifiedQr;
}

// ─── الترقيم التسلسلي ───────────────────────────────────────────────────

/** الرقم التسلسلي للفاتورة: INV-2026-000001 — تصاعدي بلا فراغات (إلزام الهيئة) */
export function formatInvoiceNumber(year: number, seq: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999)
    throw new Error("سنة الفاتورة غير صالحة");
  if (!Number.isInteger(seq) || seq < 0) throw new Error("التسلسل غير صالح");
  return `INV-${year}-${String(seq).padStart(6, "0")}`;
}

// ─── الإعداد من البيئة ──────────────────────────────────────────────────

/**
 * هوية البائع الضريبية من متغيرات البيئة:
 *  - ZATCA_VAT_NUMBER: الرقم الضريبي (15 رقماً) — مفتاح تفعيل الفوترة كلياً
 *  - ZATCA_SELLER_NAME: اسم الصيدلية في الفاتورة (افتراضي: صيدلية رُبى)
 * يعيد null عندما لا يوجد رقم ضريبي صالح — والبيع يستمر بلا فاتورة رسمية.
 */
export function zatcaSellerFromEnv(): ZatcaSeller | null {
  const vatNumber = String(process.env.ZATCA_VAT_NUMBER ?? "").trim();
  if (!/^\d{15}$/.test(vatNumber)) return null;
  return {
    name: String(process.env.ZATCA_SELLER_NAME ?? "").trim() || "صيدلية رُبى",
    vatNumber,
  };
}
