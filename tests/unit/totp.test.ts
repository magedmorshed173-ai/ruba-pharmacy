import { describe, it, expect } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  totpCode,
  verifyTotp,
} from "@/lib/totp";

// سرّ RFC 6238 الرسمي: "12345678901234567890" بصيغة Base32
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("Base32 (RFC 4648)", () => {
  it("بايت واحد: 0x66 → MY (بلا حشوة)", () => {
    expect(base32Encode(new Uint8Array([0x66]))).toBe("MY");
  });

  it("«foo» → MZXW6 ===", () => {
    expect(base32Encode(new TextEncoder().encode("foo"))).toBe("MZXW6");
  });

  it("دورة كاملة: عربي ثم لاتيني ثم بايتات عشوائية", () => {
    const textSamples = ["صيدلية رُبى", "admin@example.com"];
    for (const s of textSamples) {
      const bytes = new TextEncoder().encode(s);
      expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    }
    // بايتات ثنائية عشوائية (ليست نصاً)
    const raw = new Uint8Array(40).map((_, i) => (i * 37 + 11) % 256);
    expect(base32Decode(base32Encode(raw))).toEqual(raw);
  });

  it("فك متسامح: أحرف صغيرة وحشوة ومسافات وشرطات", () => {
    const raw = new Uint8Array([0x66, 0x6f, 0x6f]);
    expect(base32Decode("mzxw6===")).toEqual(raw);
    expect(base32Decode("MZ XW-6")).toEqual(raw);
  });

  it("حرف خارج الأبجدية → استثناء واضح", () => {
    expect(() => base32Decode("MZ@XW6")).toThrow();
  });
});

describe("TOTP — متجهات RFC 6238 الرسمية (SHA1)", () => {
  const cases: [number, string][] = [
    [59, "287082"], // 94287082 بصيغة 8 أرقام
    [1111111109, "081804"], // 07081804
    [1111111111, "050471"], // 14050471
    [1234567890, "005924"], // 89005924
    [2000000000, "279037"], // 69279037
    [20000000000, "353130"], // 65353130
  ];
  for (const [t, code] of cases) {
    it(`t=${t} → ${code}`, () => {
      expect(totpCode(RFC_SECRET, t)).toBe(code);
    });
  }
});

describe("توليد الأسرار", () => {
  it("32 حرفاً Base32 تُفك إلى 20 بايتاً (160 بت — توصية RFC)", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret).length).toBe(20);
  });

  it("فريدية كل توليد", () => {
    const set = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    expect(set.size).toBe(50);
  });
});

describe("التحقق المتسامح مع انحراف الساعة", () => {
  const T = 1_700_000_000; // لحظة ثابتة
  it("الكود الحالي → صحيح بانحراف صفر", () => {
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, T), T)).toEqual({
      valid: true,
      drift: 0,
    });
  });

  it("كود الخطوة السابقة → صحيح بانحراف -1 (ساعة الجهاز متأخرة)", () => {
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, T - 30), T)).toEqual({
      valid: true,
      drift: -1,
    });
  });

  it("كود الخطوة التالية → صحيح بانحراف +1", () => {
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, T + 30), T)).toEqual({
      valid: true,
      drift: 1,
    });
  });

  it("خارج النافذة (خطوتان) → رفض", () => {
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, T - 60), T).valid).toBe(false);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, T + 60), T).valid).toBe(false);
  });

  it("نافذة أضيق قابلة للتخصيص: window=0 يرفض الانحراف", () => {
    expect(
      verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, T - 30), T, 0).valid
    ).toBe(false);
  });

  it("أكواد مشوهة تُرفض بلا استثناءات: 5 أرقام / حروف / فارغ / شرطات تُنظف", () => {
    const ref = totpCode(RFC_SECRET, T);
    expect(verifyTotp(RFC_SECRET, "12345", T).valid).toBe(false);
    expect(verifyTotp(RFC_SECRET, "abcdef", T).valid).toBe(false);
    expect(verifyTotp(RFC_SECRET, "", T).valid).toBe(false);
    // التنظيف: مسافات وشرطات داخل كود صحيح مقبولة (تسامح إدخال)
    expect(verifyTotp(RFC_SECRET, ref.slice(0, 3) + " " + ref.slice(3), T).valid).toBe(true);
  });

  it("سرّ أقصر من 10 بايتات → رفض أمني حاسم", () => {
    const short = base32Encode(new Uint8Array(9));
    expect(verifyTotp(short, "123456", T).valid).toBe(false);
    expect(() => totpCode(short, T)).toThrow();
  });
});

describe("otpauth URI — توافق تطبيقات المصادقة", () => {
  it("الصيغة الكاملة: issuer:label + secret + issuer + algorithm + digits + period", () => {
    const uri = otpauthUri({
      issuer: "ربي فارمسي",
      label: "admin",
      secret: RFC_SECRET,
    });
    expect(uri).toBe(
      `otpauth://totp/${encodeURIComponent("ربي فارمسي")}:admin?secret=${RFC_SECRET}&issuer=${encodeURIComponent("ربي فارمسي")}&algorithm=SHA1&digits=6&period=30`
    );
  });

  it("المصدر يحتوي شرطة مائلة أو رموزاً خاصة → يُرمَّز أمنياً", () => {
    const uri = otpauthUri({ issuer: "a/b c", label: "u@x", secret: RFC_SECRET });
    expect(uri).not.toContain("a/b c");
    expect(uri).toContain(encodeURIComponent("a/b c"));
  });
});
