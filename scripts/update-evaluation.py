#!/usr/bin/env python3
"""تحديث docs/EVALUATION.md لv4.0 — مراسٍ قصيرة تتجاوز محارف bidi التحكمية."""
import io, sys

PATH = "docs/EVALUATION.md"
s = io.open(PATH, encoding="utf-8").read()

REPLACEMENTS = [
    # (old substring, new substring)
    ("250 فحصاً (66 وحدوي + 184 E2E", "310 فحصاً (83 وحدوي + 227 E2E"),
    ("ودليل الدواء — يعمل في CI", "ودليل الدواء — يعمل في CI"),  # noop guard
    ("الوضع بعد v3.6 وv3.7", "الوضع بعد v3.6 وv3.7 وv4.0"),
    ("الفجوتان 2 و3 أُغلقتا فعلياً في v3.6/v3.7، وفجوة #1 بقيت الأعمق",
     "الفجوات الثلاث أُغلقت — الأخيرة بنيوياً في v4.0"),
    ("🔴 **الأولوية التالية**",
     "✅ **أُغلقت بنيوياً في v4.0**"),
    ("بعد فجوة #1:", "بعد إغلاق فجوة #1 في v4.0:"),
    ("الفجوة الحقيقية في **عمق المحتوى الدوائي** و**النصف التأميني**",
     "الفجوة الحقيقية المتبقية في **النصف التأميني**"),
]

applied, skipped = 0, []
for old, new in REPLACEMENTS:
    if old == new:
        continue
    if old in s:
        s = s.replace(old, new, 1)
        applied += 1
    else:
        skipped.append(old[:40])

io.open(PATH, "w", encoding="utf-8").write(s)
print(f"تم تطبيق {applied} استبدالاً")
if skipped:
    print("لم تُطابق (تُفحص يدوياً):")
    for x in skipped:
        print("  -", x)
    sys.exit(1)
