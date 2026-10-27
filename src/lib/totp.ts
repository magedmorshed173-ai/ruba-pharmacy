/**
 * طبقة التحقق بخطوتين TOTP — RFC 6238 (HMAC-SHA1، خطوة 30 ثانية، 6 أرقام)
 * v4.5 (P1) — للتحقق من هوية المدير والمستخدمين الحساسين.
 *
 * متوافقة مع Google Authenticator / Authy / أي تطبيق مصادقة:
 * URI بصيغة otpauth://totp/<issuer>:<label>?secret=<BASE32>&issuer=<issuer>
 *
 * لا قاعدة بيانات هنا — اختبار 100% بمتجهات RFC الرسمية بلا محاكاة.
 */

import { createHmac, randomBytes } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** ترميز Base32 (RFC 4648) — بلا حشوة '=' (صيغة otpauth القياسية) */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** فك Base32 — يتجاهل الحشوة والمسافات والأحرف الصغيرة (تسامح إدخال المستخدم) */
export function base32Decode(s: string): Uint8Array {
  const clean = String(s ?? "").toUpperCase().replace(/[=\s-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`حرف Base32 غير صالح: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// ─── HOTP/TOTP الأساس ───────────────────────────────────────────────────

function hotpSha1(keyBytes: Uint8Array, counter: number, digits: number): string {
  // العداد 8 بايتات big-endian (RFC 4226 §5.3)
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const hmac = createHmac("sha1", Buffer.from(keyBytes))
    .update(Buffer.from(msg))
    .digest();
  // القص الديناميكي (RFC 4226 §5.4)
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const TOTP_STEP_SEC = 30;

/** توليد TOTP لسرّ Base32 عند لحظة زمنية بالثواني */
export function totpCode(
  secretBase32: string,
  timeSec: number,
  step: number = TOTP_STEP_SEC,
  digits: number = 6
): string {
  const key = base32Decode(secretBase32);
  if (key.length < 10) throw new Error("سرّ TOTP أقصر من الحد الآمن (10 بايتات)");
  const counter = Math.floor(timeSec / step);
  return hotpSha1(key, counter, digits);
}

/** سرّ جديد عشوائي — 20 بايتاً (160 بت، توصية RFC) بصيغة Base32 */
export function generateTotpSecret(): string {
  return base32Encode(new Uint8Array(randomBytes(20)));
}

export interface VerifyTotpResult {
  valid: boolean;
  /** عدد الخطوات التي انحرف عنها الكود المتطابق — 0 = محاذاة تامة */
  drift: number;
}

/**
 * تحقق متسامح مع انحراف الساعة: يقبل الكود الحالي ±window خطوة
 * (window=1 ⇒ نافذة قبول 90 ثانية — المعيار الصناعي).
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  timeSec: number,
  window: number = 1,
  step: number = TOTP_STEP_SEC
): VerifyTotpResult {
  const normalized = String(code ?? "").replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(normalized)) return { valid: false, drift: 0 };
  const key = base32Decode(secretBase32);
  if (key.length < 10) return { valid: false, drift: 0 };
  const counter = Math.floor(timeSec / step);
  for (let d = -window; d <= window; d++) {
    if (hotpSha1(key, counter + d, 6) === normalized)
      return { valid: true, drift: d };
  }
  return { valid: false, drift: 0 };
}

/** URI التهيئة لتطبيقات المصادقة — issuer وlabel يظهران في التطبيق */
export function otpauthUri(params: {
  issuer: string;
  label: string;
  secret: string;
}): string {
  const issuer = encodeURIComponent(String(params.issuer ?? "").trim());
  const label = encodeURIComponent(String(params.label ?? "").trim());
  const secret = String(params.secret ?? "").replace(/[=\s]/g, "");
  return `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}
