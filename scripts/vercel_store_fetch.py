#!/usr/bin/env python3
"""استخراج سلاسل اتصال Neon من مخزن Vercel Storage — v4.6.5
يكتب النتائج في .secrets/neon_conn.json (chmod 600) ولا يطبع أي قيمة حساسة.
يطبع: بنية الاستجابة (مفاتيح)، حالة الربط بالمشروع، أسماء متغيرات البيئة فقط.
"""
import json
import os
import stat
import urllib.error
import urllib.request

SECRETS = "/home/z/my-project/.secrets"
TOKEN = open(f"{SECRETS}/vercel_token").read().strip()
API = "https://api.vercel.com"
STORE_ID = "store_h9Q17HxQEw14rlGL"
PROJECT_ID = "prj_5p5n9DYCBrOnWpPwKzVB9ASU9AYE"
TEAM_ID = ""

SECRET_MARKERS = ("postgres://", "postgresql://", "neondb", "PASSWORD", "secret")


def api(path: str) -> tuple[int, dict]:
    req = urllib.request.Request(
        f"{API}{path}", headers={"Authorization": f"Bearer {TOKEN}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, (json.loads(r.read()) if r.read and r.headers else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")[:300]
        return e.code, {"__raw__": raw}


def get_body(path: str) -> tuple[int, bytes]:
    req = urllib.request.Request(
        f"{API}{path}", headers={"Authorization": f"Bearer {TOKEN}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:300]


# 1) team scope
_, body = get_body("/v2/teams?limit=5")
teams = json.loads(body).get("teams", []) if body[:1] == b"{" else []
TEAM_ID = teams[0]["id"] if teams else ""
tq = f"teamId={TEAM_ID}&" if TEAM_ID else ""
print(f"team: {TEAM_ID[:12]}…")


def mask_dump(obj, path="root", found=None):
    """يطبع بنية الكائن مع إخفاء القيم الحساسة، ويجمع السلاسل الحقيقية في found."""
    if found is None:
        found = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            mask_dump(v, f"{path}.{k}", found)
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:5]):
            mask_dump(v, f"{path}[{i}]", found)
    elif isinstance(obj, str):
        if any(m in obj for m in SECRET_MARKERS) or len(obj) > 80:
            found[path] = obj
            host = ""
            m = None
            import re

            m = re.match(r"\w+://[^@/]*@([^/?]+)", obj)
            host = m.group(1) if m else ""
            print(f"    {path} = <SECRET len={len(obj)}> host={host or '-'}")
        else:
            print(f"    {path} = {obj!r}")
    elif obj is None or isinstance(obj, (int, float, bool)):
        print(f"    {path} = {obj}")
    return found


# 2) تفاصيل المخزن
print("=== store details ===")
status, body = get_body(f"/v1/storage/stores/{STORE_ID}?{tq}limit=100")
print(f"HTTP {status}")
conn_strings = {}
if status == 200 and body[:1] == b"{":
    d = json.loads(body)
    conn_strings = mask_dump(d, "store")
else:
    print(body.decode(errors="replace")[:200])

# 3) نقاط نهاية محتملة لسلاسل الاتصال
for ep in (
    f"/v1/storage/stores/{STORE_ID}/connection?{tq}",
    f"/v1/storage/stores/{STORE_ID}/connections?{tq}",
    f"/v1/storage/stores/{STORE_ID}/secrets?{tq}",
):
    s, b = get_body(ep)
    print(f"endpoint {ep.split('/v1/storage/stores/')[1].split('?')[0]}: HTTP {s}")
    if s == 200 and b[:1] == b"{":
        conn_strings.update(mask_dump(json.loads(b), ep.split('/')[-1]))

# 4) متغيرات بيئة المشروع (أسماء فقط + هل توجد قيمة معادة)
print("=== project env vars ===")
s, b = get_body(f"/v9/projects/{PROJECT_ID}/env?{tq}")
print(f"HTTP {s}")
if s == 200:
    for e in json.loads(b).get("envs", []):
        has_val = "value" in e and bool(e.get("value"))
        print(f"  - {e['key']:32} type={e.get('type'):10} targets={e.get('target')} valueReturned={has_val}")
        if has_val and any(m in str(e.get("value", "")) for m in SECRET_MARKERS):
            conn_strings[f"env.{e['key']}"] = e["value"]

# 5) حفظ كل السلاسل المجموعة في .secrets/neon_conn.json
if conn_strings:
    path = f"{SECRETS}/neon_conn.json"
    with open(path, "w") as f:
        json.dump(conn_strings, f, indent=1)
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    print(f"saved {len(conn_strings)} candidate strings -> .secrets/neon_conn.json")
else:
    print("no connection strings found in store response")
