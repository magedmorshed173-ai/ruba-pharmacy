#!/usr/bin/env python3
"""توليد scripts/clinical-data.json من المصدرين النهائيين (v5.0)

المصادر: scripts/clinical-interactions.ts (الأساس 26) + scripts/clinical-interactions-v5.ts
الاستخدام: python3 scripts/gen-clinical-json.py
يُشغَّل يدوياً بعد أي تعديل على قواعد التداخلات — ويُراجع الازدواجية قبل الكتابة.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def parse(path: str):
    src = (ROOT / path).read_text(encoding="utf-8")
    m = re.search(r"=\s*\[(.*)\];", src, re.S)
    body = re.sub(r"//[^\n]*", "", m.group(1))
    rows, depth, cur, in_str = [], 0, "", False
    for ch in body:
        if in_str:
            cur += ch
            if ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
            cur += ch
            continue
        if ch == "[":
            depth += 1
            if depth == 1:
                cur = ""
            continue
        if ch == "]":
            depth -= 1
            if depth == 0:
                rows.append(cur)
                cur = ""
            continue
        if depth >= 1:
            cur += ch
    out = []
    for r in rows:
        items, d, c, ins = [], 0, "", False
        for ch in r:
            if ins:
                c += ch
                if ch == '"':
                    ins = False
                continue
            if ch == '"':
                ins = True
                c += ch
                continue
            if ch == "," and d == 0:
                items.append(c)
                c = ""
                continue
            c += ch
        if c.strip():
            items.append(c)
        out.append([json.loads(i.strip()) for i in items])
    return out


def main():
    all_rows = []
    seen = {}
    dups = 0
    for f in ["scripts/clinical-interactions.ts", "scripts/clinical-interactions-v5.ts"]:
        rows = parse(f)
        print(f, "->", len(rows))
        for r in rows:
            key = "|".join(sorted([r[0].lower(), r[1].lower()]))
            if key in seen:
                print("  تكرار مُتجاهل:", key)
                dups += 1
                continue
            seen[key] = True
            all_rows.append(r)
    assert all(len(r) == 10 for r in all_rows), "صف تالف"
    (ROOT / "scripts/clinical-data.json").write_text(
        json.dumps(all_rows, ensure_ascii=False, indent=0), encoding="utf-8"
    )
    print(f"TOTAL: {len(all_rows)} | duplicates skipped: {dups}")


if __name__ == "__main__":
    sys.exit(main())
