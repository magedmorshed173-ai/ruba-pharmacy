#!/usr/bin/env python3
"""
حلّ مشروع Neon محلياً — v4.6.4
العنوان الصحيح للـ API هو console.neon.tech/api/v2 (نطاق api.neon.tech
تقاعد عالمياً — NXDOMAIN من محلّلات متعددة وDoH). هذا السكربت يعمل من
بيئة التطوير مباشرة: يتحقق من المفتاح، يجد/ينشئ المشروع، ينتظر جاهزية
النهاية، ويكتب سلسلتي الاتصال إلى ملفات الأسرار — لا قيمة تُطبع.
الاستخدام: python3 scripts/neon_local_resolve.py
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get("NEON_API_BASE", "https://console.neon.tech/api/v2")
KEY_FILE = "/home/z/my-project/.secrets/neon_api_key"
OUT_POOLED = "/home/z/my-project/.secrets/db_pooled_url"
OUT_DIRECT = "/home/z/my-project/.secrets/db_direct_url"
PROJECT_NAME = os.environ.get("NEON_PROJECT_NAME", "ruba-pharmacy")


def api(path: str, data: dict | None = None, method: str | None = None, soft: bool = False) -> dict:
    key = open(KEY_FILE).read().strip()
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        f"{API}{path}",
        data=body,
        method=method or ("POST" if body is not None else "GET"),
        headers={
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    last: Exception | None = None
    for _ in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                raw = res.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            if e.code < 500 and e.code != 429:
                snippet = e.read().decode()[:400]
                if soft:
                    raise ValueError(f"HTTP {e.code}: {snippet}")
                print(f"::error::فشل نداء Neon API {method or 'GET'} {path} — الحالة {e.code}")
                print(snippet)
                sys.exit(1)
            last = e
        except urllib.error.URLError as e:
            last = e
        time.sleep(4)
    print(f"::error::تعذر الوصول إلى Neon API: {getattr(last, 'reason', last)}")
    sys.exit(1)


def write_secret(path: str, value: str) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(value)


def wait_ready(project_id: str, branch_id: str) -> None:
    for _ in range(40):
        eps = api(f"/projects/{project_id}/branches/{branch_id}/endpoints").get("endpoints", [])
        statuses = [e.get("status", "ready") for e in eps]
        if statuses and all(s in ("ready", "idle") for s in statuses):
            return
        time.sleep(3)
    print("::error::انتهت مهلة انتظار جاهزية نقطة نهاية Neon (120 ثانية)")
    sys.exit(1)


def main() -> None:
    me = api("/users/me")
    print(f"المفتاح صالح — الحساب: {me.get('login') or me.get('email') or me.get('id')}")

    # الحسابات المنظمة تتطلب org_id في كل استعلامات المشروعات
    orgs = api("/users/me/organizations").get("organizations", [])
    org_id = ""
    if orgs:
        org_id = orgs[0]["id"]
        print(f"المنظمة: {orgs[0].get('name')} ({org_id})")

    projects = api("/projects" + (f"?org_id={org_id}" if org_id else "")).get("projects", [])
    project = next((p for p in projects if p.get("name") == PROJECT_NAME), None)
    if project:
        print(f"مشروع موجود: {project['name']} ({project['id']}) — pg{project.get('pg_version')} @ {project.get('region_id')}")
    else:
        print(f"::notice::لا مشروع باسم {PROJECT_NAME} — إنشاء جديد على aws-us-east-2 (الأقرب لـ Vercel iad1)")
        base = {"name": PROJECT_NAME, "pg_version": 16, "region_id": "aws-us-east-2"}
        if org_id:
            try:
                # المحاولة 1: org_id كمعامل استعلام (نفس نمط GET)
                project = api(f"/projects?org_id={org_id}", {"project": base}, method="POST", soft=True)["project"]
            except ValueError as e:
                print(f"محاولة query param فشلت — {e} — تجربة org_id داخل كائن المشروع")
                # المحاولة 2: org_id داخل كائن المشروع
                try:
                    project = api("/projects", {"project": {**base, "org_id": org_id}}, method="POST", soft=True)["project"]
                except ValueError as e2:
                    if "managed by Vercel" in str(e2):
                        print(
                            "::error::المنظمة مُدارة من Vercel — لا يمكن إنشاء المشروع من Neon API. "
                            "أنشئ القاعدة من Vercel: Dashboard → التيم → Storage → Create Database → Neon Postgres "
                            "واربطها بمشروع ruba-pharmacy (سيضيف Vercel متغيرات الاتصال تلقائياً)، "
                            "ثم أعد تشغيل هذا السكربت لاشتقاق السلسلتين."
                        )
                        sys.exit(1)
                    raise
        else:
            project = api("/projects", {"project": base}, method="POST")["project"]
        print(f"أُنشئ المشروع: {project['name']} ({project['id']})")

    branches = api(f"/projects/{project['id']}/branches").get("branches", [])
    branch = next((b for b in branches if b.get("default")), None) or (branches[0] if branches else None)
    if not branch:
        print("::error::لا فرع افتراضي في المشروع")
        sys.exit(1)
    wait_ready(project["id"], branch["id"])

    uris = {}
    for label, pooled in (("pooled", "true"), ("direct", "false")):
        res = api(f"/projects/{project['id']}/branches/{branch['id']}/connection_uri?pooled={pooled}")
        uris[label] = res["uri"]

    hosts = set()
    for u in uris.values():
        p = urllib.parse.urlparse(u)
        if p.hostname:
            hosts.add(p.hostname)
    write_secret(OUT_POOLED, uris["pooled"])
    write_secret(OUT_DIRECT, uris["direct"])
    print(f"سلسلتا الاتصال كُتبتا إلى {OUT_POOLED} و{OUT_DIRECT} (بلا طباعة)")
    print(f"مضيفا نقطة النهاية (لأغراض فحص الوصول فقط): {sorted(hosts)}")


if __name__ == "__main__":
    main()
