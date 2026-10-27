#!/usr/bin/env python3
"""ربط مخزن Neon (Vercel-managed) بمشروع ruba-pharmacy — v4.6.5
يجرب أشكال طلب POST على /v1/storage/stores/{id}/connections حتى نجاح واحد،
ثم يتحقق من المتغيرات المحقونة في المشروع (أسماء فقط). لا يطبع أي قيمة حساسة.
"""
import json
import urllib.error
import urllib.request

SECRETS = "/home/z/my-project/.secrets"
TOKEN = open(f"{SECRETS}/vercel_token").read().strip()
API = "https://api.vercel.com"
STORE_ID = "store_h9Q17HxQEw14rlGL"
PROJECT_ID = "prj_5p5n9DYCBrOnWpPwKzVB9ASU9AYE"


def call(path: str, data=None, method=None) -> tuple[int, str]:
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        f"{API}{path}",
        data=body,
        method=method or ("POST" if body is not None else "GET"),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:500]


# 0) نطاق الفريق
s, b = call("/v2/teams?limit=5")
team = json.loads(b)["teams"][0]["id"] if s == 200 else ""
tq = f"teamId={team}&" if team else ""
print(f"team: {team[:12]}…")

# 1) الربط الحالي (بنية فقط)
s, b = call(f"/v1/storage/stores/{STORE_ID}/connections?{tq}")
print(f"GET connections: HTTP {s}")
if s == 200 and b.startswith("{"):
    d = json.loads(b)
    conns = d.get("connections", [])
    print(f"  existing connections: {len(conns)}")
    for c in conns:
        print(f"    - id={c.get('id')} projectId={c.get('projectId')} status={c.get('status')}")

if any(c.get("projectId") == PROJECT_ID for c in (json.loads(b).get("connections", []) if s == 200 and b.startswith("{") else [])):
    print("already connected ✓")
else:
    # 2) تجربة أشكال الطلب
    shapes = [
        ("connections:[{projectId}]", {"connections": [{"projectId": PROJECT_ID}]}),
        ("projects:[{projectId}]", {"projects": [{"projectId": PROJECT_ID}]}),
        ("{projectId}", {"projectId": PROJECT_ID}),
        ("projects:[{id}]", {"projects": [{"id": PROJECT_ID}]}),
        ("connections:[{id}]", {"connections": [{"id": PROJECT_ID}]}),
    ]
    ok = False
    for label, payload in shapes:
        s, b = call(f"/v1/storage/stores/{STORE_ID}/connections?{tq}", payload)
        print(f"POST {label}: HTTP {s}" + ("" if s in (200, 201) else f" — {b[:220]}"))
        if s in (200, 201):
            ok = True
            break
    if not ok:
        print("RESULT: connect failed via all shapes — سنعتمد المتغيرات اليدوية (Path B)")
        raise SystemExit(2)

# 3) التحقق من المتغيرات المحقونة بعد الربط (أسماء فقط)
s, b = call(f"/v9/projects/{PROJECT_ID}/env?{tq}")
print(f"project envs: HTTP {s}")
if s == 200:
    for e in json.loads(b).get("envs", []):
        print(f"  - {e['key']:32} targets={e.get('target')}")
