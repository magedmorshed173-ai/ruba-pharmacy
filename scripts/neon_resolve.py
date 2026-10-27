#!/usr/bin/env python3
"""
حلّ أو أنشئ مشروع Neon واستخرج سلسلتي الاتصال — v4.6.3
يعمل داخل workflow «Neon Bootstrap» عبر python3 + urllib (getaddrinfo
النظامي — تجنّباً لفشل DNS الخاص بـ bun/c-ares على العدّاءين).
- يقرأ NEON_API_KEY من البيئة، يجد المشروع باسم NEON_PROJECT_NAME أو
  ينشئه (aws-us-east-2 / pg16)، ينتظر جاهزية نقطة النهاية.
- يصدّر DATABASE_URL (المجمّعة) و DIRECT_URL (المباشرة) إلى $GITHUB_ENV
  بصيغة heredoc، مع ::add-mask:: للسلسلتين وكلمة المرور والمضيف —
  سجلات المهمة عمومية ولا يجوز أن تحمل أي قيمة حساسة.
القيم لا تُطبع أبداً: الإخراج أسماء وحالات وعناصر محجوبة فقط.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get("NEON_API_BASE", "https://console.neon.tech/api/v2")
# v4.6.4 — نطاق api.neon.tech تقاعد عالمياً (NXDOMAIN من DoH متعددة)؛
# العنوان الرسمي للـ API هو console.neon.tech/api/v2
PROJECT_NAME = os.environ.get("NEON_PROJECT_NAME", "ruba-pharmacy")


def mask(value: str) -> None:
    print(f"::add-mask::{value}")


def api(path: str, data: dict | None = None, method: str | None = None, soft: bool = False) -> dict:
    key = os.environ.get("NEON_API_KEY", "")
    if not key:
        print(
            "::error::NEON_API_KEY غير مضبوط — خذه من console.neon.tech "
            "(Account → API Keys) ثم: Settings → Secrets and variables → Actions"
        )
        sys.exit(1)
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
    # إعادة محاولة للأخطاء العابرة (DNS متذبذب عند العدّاءين، 5xx، 429)
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
                print(
                    f"::error::فشل نداء Neon API {method or 'GET'} {path} — الحالة {e.code}"
                )
                print(snippet)
                sys.exit(1)
            last = e
        except urllib.error.URLError as e:
            last = e
        time.sleep(4)
    if isinstance(last, urllib.error.HTTPError):
        print(f"::error::فشل نداء Neon API {method or 'GET'} {path} — الحالة {last.code} بعد 3 محاولات")
    else:
        print(f"::error::تعذر الوصول إلى Neon API: {getattr(last, 'reason', last)}")
    sys.exit(1)


def wait_ready(project_id: str, branch_id: str) -> None:
    for _ in range(30):
        eps = api(f"/projects/{project_id}/branches/{branch_id}/endpoints").get(
            "endpoints", []
        )
        statuses = [e.get("status", "ready") for e in eps]
        if statuses and all(s in ("ready", "idle") for s in statuses):
            return
        time.sleep(3)
    print("::error::انتهت مهلة انتظار جاهزية نقطة نهاية Neon (90 ثانية)")
    sys.exit(1)


def main() -> None:
    # 1) الحساب والمنظمات — الحسابات المنظمة تتطلب org_id
    me = api("/users/me")
    print(f"المفتاح صالح — الحساب: {me.get('login') or me.get('email') or me.get('id')}")
    org_id = ""
    try:
        orgs = api("/users/me/organizations", soft=True).get("organizations", [])
        if orgs:
            org_id = orgs[0]["id"]
            print(f"المنظمة: {orgs[0].get('name')} ({org_id})")
    except ValueError:
        print("لا منظمات — حساب شخصي")

    # 2) المشروع: موجود أو جديد
    projects = api("/projects" + (f"?org_id={org_id}" if org_id else "")).get("projects", [])
    project = next((p for p in projects if p.get("name") == PROJECT_NAME), None)
    if project:
        print(
            f"مشروع موجود: {project['name']} ({project['id']}) — "
            f"pg{project.get('pg_version')} @ {project.get('region_id')}"
        )
    else:
        print(
            f"::notice::لا مشروع باسم {PROJECT_NAME} — إنشاء جديد على "
            "aws-us-east-2 (الأقرب لـ Vercel iad1)"
        )
        base = {"name": PROJECT_NAME, "pg_version": 16, "region_id": "aws-us-east-2"}
        if org_id:
            try:
                # المحاولة 1: org_id كمعامل استعلام (نفس نمط GET)
                project = api(f"/projects?org_id={org_id}", {"project": base}, method="POST", soft=True)["project"]
            except ValueError as e:
                if "managed by Vercel" in str(e):
                    print(
                        "::error::المنظمة مُدارة من Vercel — لا يمكن إنشاء المشروع من Neon API. "
                        "أنشئ القاعدة من Vercel: Dashboard → التيم → Storage → Create Database → Neon Postgres، "
                        "ثم اربطها بمشروع ruba-pharmacy (سيضيف Vercel متغيرات الاتصال تلقائياً)، "
                        "أو مرّر NEON_DATABASE_URL وNEON_DIRECT_URL كأسرار واستخدم workflow «Neon DB Setup»."
                    )
                    sys.exit(1)
                print(f"محاولة query param فشلت — {e} — تجربة org_id داخل كائن المشروع")
                # المحاولة 2: org_id داخل كائن المشروع
                project = api("/projects", {"project": {**base, "org_id": org_id}}, method="POST")["project"]
        else:
            project = api("/projects", {"project": base}, method="POST")["project"]
        print(f"أُنشئ المشروع: {project['name']} ({project['id']})")

    # 2) الفرع الافتراضي + جاهزية النهاية
    branches = api(f"/projects/{project['id']}/branches").get("branches", [])
    branch = next((b for b in branches if b.get("default")), None) or (
        branches[0] if branches else None
    )
    if not branch:
        print("::error::لا فرع افتراضي في المشروع")
        sys.exit(1)
    wait_ready(project["id"], branch["id"])

    # 3) سلسلتا الاتصال — المجمّعة (-pooler) للتشغيل والمباشرة للترحيلات
    uris = {}
    for label, pooled in (("pooled", "true"), ("direct", "false")):
        res = api(
            f"/projects/{project['id']}/branches/{branch['id']}/connection_uri"
            f"?pooled={pooled}"
        )
        uris[label] = res["uri"]

    for uri in list(uris.values()):
        mask(uri)
        try:
            parsed = urllib.parse.urlparse(uri)
            if parsed.password:
                mask(parsed.password)
            if parsed.hostname:
                mask(parsed.hostname)
        except Exception:
            pass

    # 4) تصدير heredoc آمن للرموز الخاصة
    env_file = os.environ.get("GITHUB_ENV")
    if not env_file:
        print(
            "::error::GITHUB_ENV غير متوفر — هذا السكربت داخل GitHub Actions حصراً"
        )
        sys.exit(1)
    with open(env_file, "a", encoding="utf-8") as f:
        f.write(f"DATABASE_URL<<NEON_EOF\n{uris['pooled']}\nNEON_EOF\n")
        f.write(f"DIRECT_URL<<NEON_EOF\n{uris['direct']}\nNEON_EOF\n")

    print(
        "✅ سلسلتا الاتصال حُلّتا وصُدّرتا إلى بيئة المهمة (مخفيتان في السجلات): "
        "pooled للتشغيل + direct للترحيلات"
    )


if __name__ == "__main__":
    main()
