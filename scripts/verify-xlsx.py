"""v5.1 — تحقق خارجي من صحة ملف XLSX المولّد بمكتبة zipfile و openpyxl (إن توفرت)"""
import io, sys, zipfile
sys.path.insert(0, "/home/z/my-project")

# ولّد الملف عبر tsx سريع: bun يستورد lib مباشرة
script = """
import { buildXlsx } from "/home/z/my-project/src/lib/xlsx";
const sheets = [
  { name: "اللقطات", rows: [["النوع","صافي"],["يومي", 123.45],["شهري", 9987.6]] },
  { name: "أعلى الأصناف", rows: [["الصنف","الكمية"],["بانادول & إكسترا <250مج>", 30]] },
];
const bytes = buildXlsx(sheets);
await Bun.write("/home/z/my-project/tool-results/sample.xlsx", bytes);
console.log("written", bytes.length);
"""
open("/home/z/my-project/tool-results/gen-xlsx.ts", "w").write(script)

import subprocess
r = subprocess.run(["bun", "/home/z/my-project/tool-results/gen-xlsx.ts"],
                   capture_output=True, text=True, cwd="/home/z/my-project")
print(r.stdout.strip(), r.stderr.strip()[:300])

path = "/home/z/my-project/tool-results/sample.xlsx"
zf = zipfile.ZipFile(path)
bad = zf.testzip()  # يتحقق من CRC32 لكل إدخال
assert bad is None, f"تالف: {bad}"
names = zf.namelist()
print("ZIP OK — إدخالات:", names)
wb = zf.read("xl/workbook.xml").decode()
assert "اللقطات" in wb and "أعلى الأصناف" in wb
s1 = zf.read("xl/worksheets/sheet1.xml").decode()
assert 'rightToLeft="1"' in s1 and "يومي" in s1
s2 = zf.read("xl/worksheets/sheet2.xml").decode()
assert "بانادول &amp; إكسترا &lt;250مج&gt;" in s2
print("XLSX VALID — بنية OOXML وCRC والتهريب العربية سليمة")

try:
    import openpyxl
    wbk = openpyxl.load_workbook(path)
    ws = wbk["اللقطات"]
    vals = [[c.value for c in row] for row in ws.iter_rows()]
    print("openpyxl:", vals)
    assert vals[1][1] == 123.45
    print("OPENPYXL OK — تُقرأ القيم والنصوص العربية سليمة")
except ImportError:
    print("(openpyxl غير متاح — اكتفينا بفحص zipfile)")
