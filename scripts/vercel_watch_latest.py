#!/usr/bin/env python3
"""العثور على آخر نشر لـ main الحالي ومراقبته حتى READY/ERROR — بلا كشف التوكن."""
import json
import sys
import time
import urllib.request

TOKEN = open("/home/z/my-project/.secrets/vercel_token").read().strip()
TEAM = "team_AZaLO0kiTiVUkNmNJhmWHFSu"
PROJECT = "prj_5p5n9DYCBrOnWpPwKzVB9ASU9AYE"
TARGET_COMMIT = sys.argv[1] if len(sys.argv) > 1 else None


def api(path):
    req = urllib.request.Request(
        f"https://api.vercel.com{path}", headers={"Authorization": f"Bearer {TOKEN}"}
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def find_deployment():
    data = api(f"/v6/deployments?projectId={PROJECT}&teamId={TEAM}&limit=6&target=production")
    for d in data.get("deployments", []):
        sha = d.get("meta", {}).get("githubCommitSha", "")[:7]
        if TARGET_COMMIT is None or sha == TARGET_COMMIT:
            return d["uid"], sha, d.get("readyState")
    return None, None, None


uid = sha = None
for i in range(30):
    uid, sha, state = find_deployment()
    if uid:
        print(f"النشر: {uid} (commit {sha}) — الحالة: {state}")
        break
    print(f"انتظار ظهور النشر... ({i+1})")
    time.sleep(10)
if not uid:
    print("لم يظهر نشر للكوميت المطلوب!")
    sys.exit(1)

for i in range(60):
    d = api(f"/v13/deployments/{uid}?teamId={TEAM}")
    state = d.get("readyState")
    print(f"[{i*10}s] {state}")
    if state == "READY":
        print("✅ النشر جاهز:", d.get("url"))
        sys.exit(0)
    if state in ("ERROR", "CANCELED"):
        print("❌ فشل النشر")
        # استخراج رسالة البناء
        try:
            ev = api(f"/v2/deployments/{uid}/events?teamId={TEAM}&limit=100")
            msgs = [
                e.get("payload", {}).get("text", "")
                for e in ev.get("events", [])
                if e.get("payload", {}).get("type") == "stderr"
            ]
            print("\n".join(m for m in msgs[-25:] if m))
        except Exception as e:
            print("تعذر جلب السجل:", e)
        sys.exit(1)
    time.sleep(10)
print("انتهت المهلة")
sys.exit(1)
