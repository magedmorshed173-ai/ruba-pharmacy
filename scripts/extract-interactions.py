#!/usr/bin/env python3
"""استخراج قاعدة التداخلات السريرية من seed.ts إلى وحدة مشتركة clinical-interactions.ts
حتى يزرعها seed-drugs.ts في أي قاعدة بيانات (تطوير/إنتاج) دون تكرار المحتوى العلمي."""
import io

SEED = "scripts/seed.ts"
OUT = "scripts/clinical-interactions.ts"

src = io.open(SEED, encoding="utf-8").read()

START = "type InteractionRow = ["
END_MARK = "\nconst PATIENTS"

i0 = src.index(START)
i1 = src.index(END_MARK)
block = src[i0:i1].rstrip()
assert block.endswith("];"), "مرساة نهاية غير متوقعة"

# 1) ملف الوحدة المشتركة
header = """/**
 * قاعدة التداخلات السريرية الموثقة — المصدر الوحيد للمحتوى (v3.5 → v4.0)
 * [المادة أ، المادة ب، الشدة، الوصف، الآلية، الأثر السريري، الإدارة، الأدلة، المصدر، البدء]
 * مصادر التصنيف: Stockley's Drug Interactions، Lexicomp، تحذيرات FDA الرسمية.
 */

"""
io.open(OUT, "w", encoding="utf-8").write(header + block + "\n")

# 2) نظافة seed.ts: استبدال الكتلة باستيراد
import_line = 'import { INTERACTIONS } from "./clinical-interactions";\n'
first_import_end = src.index("\n", src.index('import { PrismaClient }'))
src2 = src[:i0] + src[i1 + 1:]
# أدرج الاستيراد بعد أول استيراد
src2 = src2[:first_import_end + 1] + import_line + src2[first_import_end + 1:]
io.open(SEED, "w", encoding="utf-8").write(src2)

print("تم: الاستخراج إلى clinical-interactions.ts + تنظيف seed.ts")
