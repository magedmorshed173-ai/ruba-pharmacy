#!/usr/bin/env python3
"""
ربط Vercel داخل عدّاء GitHub Actions — v4.6.4
يقرأ من البيئة: VERCEL_TOKEN و DATABASE_URL و DIRECT_URL و AUTH_SECRET
(الثلاثة الأولى أسرار/مصدَّرة، وAUTH_SECRET يولَّد في خطوة الـ workflow).
- يحدد نطاق المشروع (شخصي أو فريق) تلقائياً.
- يرفع المتغيرات الثلاثة (مشفّرة، targets: production+preview+development).
- يطلق نشر إنتاج من main عبر gitSource.
لا يطبع أي قيمة حساسة إطلاقاً — الإخراج مفاتيح وحالات ومعرّفات فقط.
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://api.vercel.com"
PROJECT_ID = os.environ.get("VERCEL_PROJECT_ID", "prj_5p5n9DYCBrOnWpPwKzVB9ASU9AYE")
PROJECT_NAME = os.environ.get("VERCEL_PROJECT_NAME", "ruba-pharmacy")
GIT_REPO = os.environ.get("VERCEL_GIT_REPO", "magedmorshed173-ai/ruba-pharmacy")
GIT_REF = os.environ.get("VERCEL_GIT_REF", "main")
# v4.6.5 — يمكن حصر المتغيرات عبر WIRE_VARS="DIRECT_URL,AUTH_SECRET"
# (المتغيرات المحقونة من تكامل Neon Storage — كDATABASE_URL — يجب ألا تُلمس يدوياً)
VARS = [
    v.strip()
    for v in os.environ.get("WIRE_VARS", "DATABASE_URL,DIRECT_URL,AUTH_SECRET").split(",")
    if v.strip()
]
TARGETS = ["production", "preview", "development"]


def mask(v: str) -> None:
    print(f"::add-mask::{v}")


def api(path: str, data: dict | None = None, method: str | None = None) -> tuple[int, dict]:
    token = os.environ.get("VERCEL_TOKEN", "")
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        f"{API}{path}",
        data=body,
        method=method or ("POST" if body is not None else "GET"),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            raw = res.read()
            return res.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, {}


def main() -> None:
    for name in VARS:
        v = os.environ.get(name, "")
        if not v:
            print(f"::error::{name} غير مضبوط في بيئة الخطوة")
            sys.exit(1)
        mask(v)
    mask(os.environ.get("VERCEL_TOKEN", ""))

    # 1) نطاق المشروع: شخصي أم فريق؟
    scope = ""
    status, _ = api(f"/v9/projects/{PROJECT_ID}")
    if status == 200:
        scope = "personal"
    else:
        status, teams = api("/v2/teams?limit=5")
        team_id = next(
            (t["id"] for t in teams.get("teams", []) if t.get("id")), ""
        )
        if team_id:
            status, _ = api(f"/v9/projects/{PROJECT_ID}?teamId={team_id}")
            if status == 200:
                scope = team_id
    if not scope:
        print(f"::error::تعذر الوصول إلى مشروع Vercel ({PROJECT_ID}) — تحقق من صلاحية التوكن")
        sys.exit(1)
    tq = f"?teamId={scope}" if scope != "personal" else ""

    # 2) جرد المتغيرات الحالية (أسماء فقط)
    _, envs = api(f"/v9/projects/{PROJECT_ID}/env{tq}")
    existing = [e["key"] for e in envs.get("envs", [])]
    print(f"متغيرات موجودة قبل الربط: {existing or 'لا شيء'}")

    # 3) رفع المتغيرات الثلاثة (upsert)
    for key in VARS:
        status, _ = api(
            f"/v10/projects/{PROJECT_ID}/env{tq}{'&' if tq else '?'}upsert=true",
            {"key": key, "value": os.environ[key], "type": "encrypted", "target": TARGETS},
        )
        print(f"{'✅' if status in (200, 201) else '❌'} {key}: HTTP {status}")
        if status not in (200, 201):
            sys.exit(1)

    # 4) إطلاق نشر الإنتاج من main (شكلا gitSource: org+repo ثم owner/repo احتياطاً)
    org, repo = (GIT_REPO.split("/", 1) + [""])[:2]
    dep = {}
    status = 0
    for gs in (
        {"type": "github", "org": org, "repo": repo, "ref": GIT_REF},
        {"type": "github", "repo": GIT_REPO, "ref": GIT_REF},
    ):
        status, dep = api(f"/v13/deployments{tq}", {"name": PROJECT_NAME, "gitSource": gs})
        if status in (200, 201):
            break
    if status not in (200, 201):
        print(f"::error::فشل إطلاق النشر — HTTP {status}")
        sys.exit(1)
    print(f"🚀 نشر الإنتاج: id={dep.get('id')} url={dep.get('url')} state={dep.get('readyState')}")
    print(f"رابط المعاينة بعد الجاهزية: https://{dep.get('url')}")


if __name__ == "__main__":
    main()
