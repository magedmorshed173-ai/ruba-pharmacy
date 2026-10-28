import { describe, it, expect } from "vitest";
import {
  buildXlsx,
  colName,
  crc32,
  zipStore,
  XLSX_MIME,
  type XlsxSheet,
} from "@/lib/xlsx";

/** قارئ ZIP مصغّر للتحقق الدائري: أسماء الإدخالات + بياناتها من الدليل المركزي */
function readZipEntries(buf: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // ابحث عن توقيع EOCD من النهاية
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  expect(eocd).toBeGreaterThan(-1);
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("central dir corrupt");
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    // من الرأس المحلي: اسم متغير الطول نفسه
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataOff = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(dataOff, dataOff + size);
    expect(method).toBe(0); // STORE
    expect(crc).toBe(crc32(data));
    out.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe("xlsx — كاتب Excel صفري الاعتماد", () => {
  it("crc32 يطابق المتجه المعياري IEEE", () => {
    const v = new TextEncoder().encode("123456789");
    expect(crc32(v)).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("colName يسمي الأعمدة كما في Excel", () => {
    expect(colName(0)).toBe("A");
    expect(colName(25)).toBe("Z");
    expect(colName(26)).toBe("AA");
    expect(colName(27)).toBe("AB");
    expect(colName(701)).toBe("ZZ");
    expect(colName(702)).toBe("AAA");
  });

  it("يبني أرشيفاً صالحاً بكل أجزاء OOXML المطلوبة", () => {
    const sheet: XlsxSheet = {
      name: "اللقطات",
      rows: [
        ["النوع", "الفواتير", "صافي"],
        ["يومي", 12, 345.5],
        [null, "", undefined],
      ],
    };
    const buf = buildXlsx([sheet]);
    const entries = readZipEntries(buf);

    expect(entries.get("[Content_Types].xml")).toBeDefined();
    expect(entries.get("_rels/.rels")).toBeDefined();
    expect(entries.get("xl/workbook.xml")).toBeDefined();
    expect(entries.get("xl/_rels/workbook.xml.rels")).toBeDefined();
    expect(entries.get("xl/worksheets/sheet1.xml")).toBeDefined();

    const wb = new TextDecoder().decode(entries.get("xl/workbook.xml")!);
    expect(wb).toContain('name="اللقطات"');
    const ct = new TextDecoder().decode(entries.get("[Content_Types].xml")!);
    expect(ct).toContain("sheet.main+xml");
  });

  it("يضمن اتجاه RTL والعربية والنصوص inline المؤلفة", () => {
    const sheet: XlsxSheet = {
      name: "s",
      rows: [["علاج & وقاية <خاص>"], [42]],
    };
    const xml = new TextDecoder().decode(
      readZipEntries(buildXlsx([sheet])).get("xl/worksheets/sheet1.xml")!
    );
    expect(xml).toContain('rightToLeft="1"');
    expect(xml).toContain("علاج &amp; وقاية &lt;خاص&gt;");
    expect(xml).toContain('t="inlineStr"');
    expect(xml).toContain("<v>42</v>");
    // الخلايا الفارغة لا تُكتب
    const empty: XlsxSheet = { name: "e", rows: [[null, "", undefined, "x"]] };
    const xml2 = new TextDecoder().decode(
      readZipEntries(buildXlsx([empty])).get("xl/worksheets/sheet1.xml")!
    );
    expect(xml2).not.toContain('r="A1"');
    expect(xml2).toContain('r="D1"');
  });

  it("أوراق متعددة تُرقَّم sheet1..N بعلائقياتها", () => {
    const sheets = [
      { name: "اللقطات", rows: [["a"]] },
      { name: "أعلى الأصناف", rows: [["b"]] },
    ];
    const entries = readZipEntries(buildXlsx(sheets));
    expect(entries.get("xl/worksheets/sheet1.xml")).toBeDefined();
    expect(entries.get("xl/worksheets/sheet2.xml")).toBeDefined();
    const rels = new TextDecoder().decode(entries.get("xl/_rels/workbook.xml.rels")!);
    expect(rels).toContain("sheet1.xml");
    expect(rels).toContain("sheet2.xml");
    const ct = new TextDecoder().decode(entries.get("[Content_Types].xml")!);
    expect(ct.match(/worksheet\+xml/g)?.length).toBe(2);
  });

  it("حتمي: نفس المدخلات ⇒ نفس البايتات (طوابع DOS ثابتة)", () => {
    const sheets: XlsxSheet[] = [{ name: "s", rows: [["x", 1]] }];
    const a = buildXlsx(sheets);
    const b = buildXlsx(sheets);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("zipStore يوقّع الرؤوس ويعيد توقيع PK", () => {
    const out = zipStore([{ name: "a.txt", data: "hello" }]);
    expect(out[0]).toBe(0x50); // P
    expect(out[1]).toBe(0x4b); // K
  });

  it("XLSX_MIME هو النوع الرسمي", () => {
    expect(XLSX_MIME).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });
});
