#!/usr/bin/env python3
"""
تحقق محلي حي شامل لمزايا v4.8 — العمل دون اتصال + القفل الذكي:
  المرحلة A (LOCK_MODE الافتراضي admin):
    1.  /sw.js يُخدم 200 كـ JS ويحمل الاستراتيجيات والأوامر
    2.  /offline عامة 200 بمحتوى «لا يوجد اتصال»
    3.  /api/lock/status بلا مفتاح ⇒ {locked:true} فقط
    4.  الجذر ما يزال خلف القفل (307) — البوابة لم تنكسر
    5.  فتح بالمفتاح الصحيح ⇒ status {locked:false, expiresAt, warnBeforeSec=600}
    6.  مفتاح خاطئ ⇒ 401 «المفتاح غير صحيح»
    7.  تمديد داخلي (verify ثانية) ⇒ expiresAt أحدث فعلاً
  المرحلة B (إعادة تشغيل بـ LOCK_MODE=users):
    8.  status.mode = "users"
    9.  فتح بلا اسم مستخدم ⇒ 400
    10. مستخدم مجهول ⇒ 401 «بيانات غير صحيح» (بلا كشف وجود)
    11. فتح بحساب المدير (كأي مستخدم) ⇒ نجاح
كلمة مرور المدير من .secrets — لا تُطبع أبداً. السجلات تُطبع دون قيم حساسة.
"""
import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = "3112"
BASE = f"http://127.0.0.1:{PORT}"

passed, failures = [], []


def check(cond, label, extra=""):
    (passed if cond else failures).append(label)
    print(f"  {'✓' if cond else '✗'} {label}" + (f" — {extra}" if extra and not cond else ""))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def req(method, path, data=None, cookie=None):
    url = BASE + path
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(url, data=body, method=method)
    if body:
        r.add_header("Content-Type", "application/json")
    if cookie:
        r.add_header("Cookie", cookie)
    opener = urllib.request.build_opener(NoRedirect())
    try:
        res = opener.open(r, timeout=30)
        return res.status, dict(res.headers), res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return 599, {}, str(e)


def hget(headers, name):
    for k, v in headers.items():
        if k.lower() == name.lower():
            return v
    return ""


def start_server(extra_env=None):
    env = dict(os.environ)
    with open(f"{ROOT}/.env", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
    env.update({
        "PORT": PORT,
        "HOSTNAME": "127.0.0.1",
        "NODE_ENV": "production",
        "SYSTEM_LOCK": "on",
    })
    if extra_env:
        env.update(extra_env)
    log = open(f"{ROOT}/.tmp-v48-server.log", "w")
    proc = subprocess.Popen(
        ["node", f"{ROOT}/.next/standalone/server.js"],
        cwd=f"{ROOT}/.next/standalone", env=env, stdout=log, stderr=log,
    )
    for _ in range(60):
        code, _, _ = req("GET", "/offline")
        if 200 <= code < 500:  # استجابة HTTP حقيقية (599 = رفض اتصال)
            return proc
        time.sleep(1)
    proc.send_signal(signal.SIGTERM)
    raise RuntimeError("الخادم لم يجهز — راجع .tmp-v48-server.log")


def stop_server(proc):
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def extract_lock_cookie(headers):
    sc = hget(headers, "set-cookie")
    for part in sc.split(";"):
        part = part.strip()
        if part.startswith("ruba_lock="):
            return part
    return None


def main():
    with open(f"{ROOT}/.secrets/admin_password", encoding="utf-8") as f:
        admin_password = f.read().strip()
    assert admin_password, "admin_password فارغ!"

    print("━━━ المرحلة A: الوضع الافتراضي admin + مزايا دون اتصال ━━━")
    server = start_server()
    try:
        code, headers, body = req("GET", "/sw.js")
        check(code == 200, "1. /sw.js تُخدم 200 والقفل مشدود", f"code={code}")
        check("javascript" in hget(headers, "content-type").lower(),
              "   content-type = javascript", hget(headers, "content-type"))
        check("PURGE_PAGES" in body and "networkFirstPage" in body and "v4.8.0" in body,
              "   تحتوي استراتيجيات v4.8 (SWR/network-first/purge/إصدار)")

        code, _, body = req("GET", "/offline")
        check(code == 200, "2. /offline عامة 200 حتى والقفل مشدود", f"code={code}")
        check("لا يوجد اتصال" in body, "   محتوى صفحة السقوط صحيح")

        code, headers, body = req("GET", "/api/lock/status")
        st = json.loads(body) if code == 200 else {}
        check(code == 200 and st.get("locked") is True and st.get("expiresAt") is None,
              "3. status بلا مفتاح ⇒ {locked:true} فقط", body[:120])
        check(hget(headers, "cache-control").lower().startswith("no-store"),
              "   status بلا خبز (no-store)", hget(headers, "cache-control"))
        check(st.get("warnBeforeSec") == 600 and st.get("mode") == "admin",
              "   التنبيه 10 دقائق والوضع admin", body[:120])

        code, _, _ = req("GET", "/?v48=1")
        check(code == 307, "4. الجذر ما يزال خلف بوابة القفل (307)", f"code={code}")

        code, headers, body = req("POST", "/api/lock/verify", {"password": admin_password})
        ck = extract_lock_cookie(headers)
        check(code == 200 and ck, "5. الفتح بالمفتاح الصحيح يصدر كوكي ruba_lock", f"code={code}")

        code, _, body = req("GET", "/api/lock/status", cookie=ck)
        st2 = json.loads(body) if code == 200 else {}
        check(code == 200 and st2.get("locked") is False and st2.get("expiresAt"),
              "   status بعد الفتح ⇒ {locked:false, expiresAt}", body[:120])
        check(st2.get("warnBeforeSec") == 600, "   موعد التنبيه 600ث", body[:120])

        code, _, body = req("POST", "/api/lock/verify", {"password": "wrong-key-xyz"})
        check(code == 401 and "المفتاح غير صحيح" in body,
              "6. مفتاح خاطئ ⇒ 401 برسالة عامة", f"{code} {body[:80]}")

        # إعادة الطلب لالتقاط كوكي تمديد جديد (التوكن الثاني exp أحدث)
        code2, h2, _ = req("POST", "/api/lock/verify", {"password": admin_password})
        ck2 = extract_lock_cookie(h2)
        code, _, body = req("GET", "/api/lock/status", cookie=ck2)
        st3 = json.loads(body) if code == 200 else {}
        check(code == 200 and st3.get("expiresAt", "") > st2.get("expiresAt", ""),
              "7. التمديد الداخلي يصدر صلاحية أحدث فعلاً",
              f"{st2.get('expiresAt')} → {st3.get('expiresAt')}")

        code, headers, body = req("GET", "/offline")
        check(code == 200, "   /offline بعد الفتح 200 (متاحة دائماً)", f"code={code}")
    finally:
        stop_server(server)

    print("━━━ المرحلة B: LOCK_MODE=users — مفاتيح فردية ━━━")
    server = start_server({"LOCK_MODE": "users"})
    try:
        code, _, body = req("GET", "/api/lock/status")
        st = json.loads(body) if code == 200 else {}
        check(code == 200 and st.get("mode") == "users",
              "8. status.mode = users عند ضبط البيئة", body[:120])

        code, _, body = req("POST", "/api/lock/verify", {"password": admin_password})
        check(code == 400, "9. وضع users بلا اسم مستخدم ⇒ 400", f"code={code}")

        code, _, body = req("POST", "/api/lock/verify",
                            {"password": "no-such-user-pass", "username": "ghost404"})
        check(code == 401 and "بيانات غير صحيحة" in body,
              "10. مستخدم مجهول ⇒ 401 رسالة عامة بلا كشف وجود", f"{code} {body[:80]}")

        code, h, body = req("POST", "/api/lock/verify",
                            {"password": admin_password, "username": "admin"})
        ck = extract_lock_cookie(h)
        check(code == 200 and ck, "11. فتح بحساب نشط (admin) في وضع users", f"code={code}")

        code, _, body = req("GET", "/api/lock/status", cookie=ck)
        st = json.loads(body) if code == 200 else {}
        check(code == 200 and st.get("locked") is False,
              "    status يؤكد الفتح في وضع users", body[:120])
    finally:
        stop_server(server)

    print("━━━ النتيجة ━━━")
    print(f"نجح: {len(passed)} — فشل: {len(failures)}")
    if failures:
        print("الإخفاقات:")
        for f_ in failures:
            print("  ✗", f_)
        sys.exit(1)
    print("🎉 v4.8 — كل الفحوص المحلية الحية خضراء")


if __name__ == "__main__":
    main()
