/**
 * v5.1 — كاتب XLSX صفري الاعتماد
 *
 * يبني ملف .xlsx صالحاً بالكامل (OOXML داخل أرشيف ZIP) بلا أي مكتبة خارجية:
 *  • الإدخالات تُخزَّن بطريقة STORE (بلا ضغط) — مقبولة رسمياً في ZIP و Excel،
 *    وتُغني عن مكتبات الضغط؛ أحجام تقاريرنا بضعة كيلوبايتات فلا أثر عملياً.
 *  • CRC32 مطبَّق يدوياً (IEEE 802.3) — متجه الاختبار المعياري "123456789" ⇒ 0xCBF43926.
 *  • الطوابع الزمنية ثابتة في الملف ⇒ نفس البيانات تعطي نفس البايتات (اختبارات حتمية).
 *  • كل ورقة مضبوطة rightToLeft="1" — فتُفتح في Excel باتجاه عربي سليم.
 *  • النصوص inline (بدون sharedStrings) — أبسط وأصحّ للعربية UTF-8.
 */

export type XlsxCell = string | number | null | undefined;
export interface XlsxSheet {
  name: string;
  rows: XlsxCell[][];
}

/* ── CRC32 ─────────────────────────────────────────────────────────── */

const CRC_TABLE = /* @__PURE__ */ (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ── أدوات كتابة بايتات ────────────────────────────────────────────── */

const enc = /* @__PURE__ */ new TextEncoder();

function put16(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
}
function put32(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
}

/** تسمية أعمدة Excel: 0→A، 25→Z، 26→AA … */
export function colName(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // أحرف تحكم XML غير المسموحة (خارج 0x20 ما عدا TAB/LF/CR)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/* ── أوراق العمل ───────────────────────────────────────────────────── */

function sheetXml(rows: XlsxCell[][]): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    // اتجاه عربي من اليمين لليسار عند فتح الملف
    '<sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews>',
    "<sheetData>",
  ];
  rows.forEach((row, ri) => {
    out.push(`<row r="${ri + 1}">`);
    row.forEach((cell, ci) => {
      if (cell === null || cell === undefined || cell === "") return;
      const ref = `${colName(ci)}${ri + 1}`;
      if (typeof cell === "number" && Number.isFinite(cell)) {
        out.push(`<c r="${ref}"><v>${cell}</v></c>`);
      } else {
        out.push(
          `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(String(cell))}</t></is></c>`
        );
      }
    });
    out.push("</row>");
  });
  out.push("</sheetData></worksheet>");
  return out.join("");
}

function workbookXml(names: string[]): string {
  const sheets = names
    .map((n, i) => `<sheet name="${escXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${sheets}</sheets></workbook>`
  );
}

function contentTypesXml(count: number): string {
  const overrides = Array.from(
    { length: count },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ` +
      `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    overrides +
    "</Types>"
  );
}

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  "</Relationships>";

function workbookRelsXml(count: number): string {
  const rels = Array.from(
    { length: count },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    rels +
    "</Relationships>"
  );
}

/* ── أرشيف ZIP (STORE) ─────────────────────────────────────────────── */

interface ZipEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  offset: number;
}

/** طابع DOS ثابت (1 يناير 2026 00:00) — حتمية البايتات للاختبارات والتخزين المؤقت */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function zipStore(files: { name: string; data: string | Uint8Array }[]): Uint8Array {
  const entries: ZipEntry[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const nameB = enc.encode(f.name);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameB.length);
    put32(local, 0, 0x04034b50); // Local file header signature
    put16(local, 4, 20); // version needed
    put16(local, 6, 0x0800); // flags: UTF-8 names
    put16(local, 8, 0); // method: STORE
    put16(local, 10, DOS_TIME);
    put16(local, 12, DOS_DATE);
    put32(local, 14, crc);
    put32(local, 18, data.length); // compressed
    put32(local, 22, data.length); // uncompressed
    put16(local, 26, nameB.length);
    put16(local, 28, 0); // extra len
    local.set(nameB, 30);

    chunks.push(local, data);
    entries.push({ name: f.name, data, crc, offset });
    offset += local.length + data.length;
  }

  const centralStart = offset;
  const central: Uint8Array[] = [];
  let centralSize = 0;

  for (const e of entries) {
    const nameB = enc.encode(e.name);
    const c = new Uint8Array(46 + nameB.length);
    put32(c, 0, 0x02014b50); // Central directory signature
    put16(c, 4, 20); // version made by
    put16(c, 6, 20); // version needed
    put16(c, 8, 0x0800); // flags
    put16(c, 10, 0); // method STORE
    put16(c, 12, DOS_TIME);
    put16(c, 14, DOS_DATE);
    put32(c, 16, e.crc);
    put32(c, 20, e.data.length);
    put32(c, 24, e.data.length);
    put16(c, 28, nameB.length);
    put16(c, 30, 0); // extra
    put16(c, 32, 0); // comment
    put16(c, 34, 0); // disk number
    put16(c, 36, 0); // internal attrs
    put32(c, 38, 0); // external attrs
    put32(c, 42, e.offset);
    c.set(nameB, 46);
    central.push(c);
    centralSize += c.length;
  }

  const eocd = new Uint8Array(22);
  put32(eocd, 0, 0x06054b50);
  put16(eocd, 4, 0);
  put16(eocd, 6, 0);
  put16(eocd, 8, entries.length);
  put16(eocd, 10, entries.length);
  put32(eocd, 12, centralSize);
  put32(eocd, 16, centralStart);
  put16(eocd, 20, 0);

  const total = centralStart + centralSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of [...chunks, ...central, eocd]) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/* ── الواجهة العامة ────────────────────────────────────────────────── */

/** يبني ملف .xlsx كاملاً من ورقة أو أكثر (بأسماء عربية مسموحة في Excel) */
export function buildXlsx(sheets: XlsxSheet[]): Uint8Array {
  const names = sheets.map((s) => s.name);
  const files: { name: string; data: string }[] = [
    { name: "[Content_Types].xml", data: contentTypesXml(sheets.length) },
    { name: "_rels/.rels", data: ROOT_RELS },
    { name: "xl/workbook.xml", data: workbookXml(names) },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRelsXml(sheets.length) },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: sheetXml(s.rows),
    })),
  ];
  return zipStore(files);
}

/** نوع MIME الرسمي لملفات Excel الحديثة */
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
