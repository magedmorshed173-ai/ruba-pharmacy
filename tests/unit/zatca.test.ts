import { describe, it, expect, afterEach, vi } from "vitest";
import {
  buildSimplifiedQr,
  formatInvoiceMoney,
  formatInvoiceNumber,
  netOfVat,
  normalizeInvoiceTimestamp,
  parseSimplifiedQr,
  tlv,
  vatFromInclusive,
  zatcaSellerFromEnv,
  ZATCA_VAT_RATE,
  type ZatcaSeller,
} from "@/lib/zatca";

const SELLER: ZatcaSeller = { name: "صيدلية رُبى", vatNumber: "300012345600003" };

describe("ضريبة القيمة المضافة (شاملة الضريبة)", () => {
  it("230 ريال شاملة → ضريبة 30 ريالاً بالضبط", () => {
    expect(vatFromInclusive(23000)).toBe(3000);
  });

  it("115 ريال شاملة → 15 ريالاً", () => {
    expect(vatFromInclusive(11500)).toBe(1500);
  });

  it("التقريب العادي لأقرب هللة: 99.99 → ضريبة 13.04", () => {
    expect(vatFromInclusive(9999)).toBe(1304);
  });

  it("هللة واحدة → ضريبة 0 (لا كسور)", () => {
    expect(vatFromInclusive(1)).toBe(0);
  });

  it("4 هللات → ضريبة 1 هللة (0.5217 تقرب لـ 1)", () => {
    expect(vatFromInclusive(4)).toBe(1);
  });

  it("1000 ريال → 130.43 ريالاً", () => {
    expect(vatFromInclusive(100000)).toBe(13043);
  });

  it("صفر وسالب وغير نهي → صفر بلا استثناءات", () => {
    expect(vatFromInclusive(0)).toBe(0);
    expect(vatFromInclusive(-500)).toBe(0);
    expect(vatFromInclusive(Number.NaN)).toBe(0);
    expect(vatFromInclusive(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("نسبة مخصصة: 5% على 10500 → 500", () => {
    expect(vatFromInclusive(10500, 5)).toBe(500);
  });

  it("نسبة غير صالحة → 0", () => {
    expect(vatFromInclusive(10000, 0)).toBe(0);
    expect(vatFromInclusive(10000, -15)).toBe(0);
  });

  it("الثابت الرسمي 15%", () => {
    expect(ZATCA_VAT_RATE).toBe(15);
  });

  it("الصافي قبل الضريبة = الإجمالي − الضريبة (لا كسور ولا سالب)", () => {
    expect(netOfVat(23000, 3000)).toBe(20000);
    expect(netOfVat(100, 500)).toBe(0); // حماية من السالب
    expect(netOfVat(-50, 0)).toBe(0);
  });
});

describe("تنسيق مبالغ الفاتورة", () => {
  it("هللات → نص عشري بخانتين", () => {
    expect(formatInvoiceMoney(11500)).toBe("115.00");
    expect(formatInvoiceMoney(5)).toBe("0.05");
    expect(formatInvoiceMoney(0)).toBe("0.00");
    expect(formatInvoiceMoney(3000)).toBe("30.00");
  });

  it("غير الرقمي → 0.00", () => {
    expect(formatInvoiceMoney(Number.NaN)).toBe("0.00");
  });
});

describe("TLV — البنية الثنائية", () => {
  it("ASCII: وسم 1 قيمة ABC → [01 03 41 42 43]", () => {
    expect(Array.from(tlv(1, "ABC"))).toEqual([0x01, 0x03, 0x41, 0x42, 0x43]);
  });

  it("العربية: الطول بايتات UTF-8 لا عدد الحروف — «شركة» = 8 بايتات", () => {
    const bytes = Array.from(tlv(1, "شركة"));
    expect(bytes[0]).toBe(1);
    expect(bytes[1]).toBe(8); // 4 حروف × بايتان
    expect(bytes.length).toBe(10);
  });

  it("أطول من 255 بايتاً مرفوض — حد TLV الصارم", () => {
    expect(() => tlv(1, "أ".repeat(128))).toThrow(); // 256 بايتاً
    expect(() => tlv(1, "أ".repeat(127))).not.toThrow(); // 254 بايتاً
  });

  it("قيمة null/undefined تُطبع كنص فارغ بطول 0", () => {
    expect(Array.from(tlv(9, null as unknown as string))).toEqual([9, 0]);
  });
});

describe("الطابع الزمني", () => {
  it("Date → ISO بلا أجزاء أجزاء الثانية", () => {
    expect(normalizeInvoiceTimestamp(new Date("2026-01-15T09:30:00.123Z"))).toBe(
      "2026-01-15T09:30:00Z"
    );
  });

  it("نص ISO يُطبع الموحد", () => {
    expect(normalizeInvoiceTimestamp("2026-03-01T10:00:00Z")).toBe(
      "2026-03-01T10:00:00Z"
    );
  });

  it("نص غير صالح → استثناء واضح", () => {
    expect(() => normalizeInvoiceTimestamp("ليس تاريخاً")).toThrow();
  });
});

describe("بناء رمز QR للفاتورة المبسطة", () => {
  it("Base64 قابل للفك ويُفكك بحقوله الخمسة الصحيحة", () => {
    const b64 = buildSimplifiedQr({
      seller: SELLER,
      issuedAt: new Date("2026-02-01T12:00:00Z"),
      totalHalalas: 23000,
    });
    const parsed = parseSimplifiedQr(b64);
    expect(parsed.sellerName).toBe("صيدلية رُبى");
    expect(parsed.vatNumber).toBe("300012345600003");
    expect(parsed.timestamp).toBe("2026-02-01T12:00:00Z");
    expect(parsed.total).toBe("230.00");
    expect(parsed.vat).toBe("30.00"); // محسوبة تلقائياً 15/115
  });

  it("ضريبة صريحة تُحترم ولا تُعاد حسابها", () => {
    const parsed = parseSimplifiedQr(
      buildSimplifiedQr({
        seller: SELLER,
        issuedAt: new Date(),
        totalHalalas: 10000,
        vatHalalas: 2000, // منحلة يدوياً (مثلاً خلط نسب)
      })
    );
    expect(parsed.vat).toBe("20.00");
  });

  it("ضريبة صريحة أعلى من الإجمالي → رفض", () => {
    expect(() =>
      buildSimplifiedQr({
        seller: SELLER,
        issuedAt: new Date(),
        totalHalalas: 1000,
        vatHalalas: 2000,
      })
    ).toThrow();
  });

  it("الرقم الضريبي غير سليم (14 رقماً / حروف) → رفض صارم", () => {
    expect(() =>
      buildSimplifiedQr({
        seller: { name: "ص", vatNumber: "30001234560000" },
        issuedAt: new Date(),
        totalHalalas: 100,
      })
    ).toThrow();
    expect(() =>
      buildSimplifiedQr({
        seller: { name: "ص", vatNumber: "3000123456OOOO3" },
        issuedAt: new Date(),
        totalHalalas: 100,
      })
    ).toThrow();
  });

  it("اسم بائع فارغ → رفض", () => {
    expect(() =>
      buildSimplifiedQr({
        seller: { name: "  ", vatNumber: SELLER.vatNumber },
        issuedAt: new Date(),
        totalHalalas: 100,
      })
    ).toThrow();
  });
});

describe("فكك QR — المتانة", () => {
  it("نص ليس Base64 → استثناء", () => {
    expect(() => parseSimplifiedQr("%%%ليس-base64%%%")).toThrow();
  });

  it("بيانات أقصر من TLV واحد → استثناء", () => {
    // "AA==" يفك إلى بايت واحد
    expect(() => parseSimplifiedQr("AA==")).toThrow();
  });

  it("وسم اسم البائع مفقود → استثناء (فاتورة بلا بائع غير قانونية)", () => {
    const noSeller = Buffer.from([2, 2, 0x33, 0x30]).toString("base64");
    expect(() => parseSimplifiedQr(noSeller)).toThrow();
  });

  it("وسوم مجهولة مستقبلية تُتخطى بلا فشل (توافق أمامي)", () => {
    const future = Buffer.concat([
      Buffer.from([1, 2, 0xd8, 0xa3]), // "أ" باسم البائع
      Buffer.from([0x63, 3, 1, 2, 3]), // وسم 99 المستقبلي
    ]).toString("base64");
    const parsed = parseSimplifiedQr(future);
    expect(parsed.sellerName).toBe("أ");
  });
});

describe("الترقيم التسلسلي الإلزامي", () => {
  it("الصيغة: INV-<سنة>-<6 خانات>", () => {
    expect(formatInvoiceNumber(2026, 1)).toBe("INV-2026-000001");
    expect(formatInvoiceNumber(2026, 42)).toBe("INV-2026-000042");
    expect(formatInvoiceNumber(2026, 123456)).toBe("INV-2026-123456");
  });

  it("تسلسل يتجاوز 999999 لا ينهار — يوسع الخانات", () => {
    expect(formatInvoiceNumber(2026, 1000000)).toBe("INV-2026-1000000");
  });

  it("مدخلات غير صالحة → رفض", () => {
    expect(() => formatInvoiceNumber(199, 1)).toThrow();
    expect(() => formatInvoiceNumber(2026, -1)).toThrow();
    expect(() => formatInvoiceNumber(2026, 1.5)).toThrow();
  });
});

describe("إعداد البائع من البيئة", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("رقم ضريبي سليم → بائع مكتمل مع اسم افتراضي", () => {
    vi.stubEnv("ZATCA_VAT_NUMBER", "300012345600003");
    vi.stubEnv("ZATCA_SELLER_NAME", "");
    const seller = zatcaSellerFromEnv();
    expect(seller?.vatNumber).toBe("300012345600003");
    expect(seller?.name).toBe("صيدلية رُبى");
  });

  it("رقم مفقود أو مشوه → null والبيع يستمر بلا فاتورة رسمية", () => {
    vi.stubEnv("ZATCA_VAT_NUMBER", "");
    expect(zatcaSellerFromEnv()).toBeNull();
    vi.stubEnv("ZATCA_VAT_NUMBER", "12345");
    expect(zatcaSellerFromEnv()).toBeNull();
  });

  it("اسم مخصص من البيئة يُحترم", () => {
    vi.stubEnv("ZATCA_VAT_NUMBER", "300012345600003");
    vi.stubEnv("ZATCA_SELLER_NAME", "صيدليات رُبى الفرع الرئيسي");
    expect(zatcaSellerFromEnv()?.name).toBe("صيدليات رُبى الفرع الرئيسي");
  });
});
