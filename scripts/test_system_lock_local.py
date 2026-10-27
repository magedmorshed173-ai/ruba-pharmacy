#!/usr/bin/env python3
"""
اختبار حي محلي لقفل النظام v4.7 — بلا كشف أي سر:
يشغّل الخادم standalone ببيئة .env المحلية، يجري دورة القفل كاملة،
ويطبع الحالات والأكواد فقط — كلمة المرور لا تُطبع ولا تُكتب في أي سجل.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = "/home/z/my-project"
PORT = "3111"
BASE = f"http://127.0.0.1:{PORT}"

passed, failures = [], []


def check(cond, label, extra=""):
    (passed if cond else failures).append(label)
    print(f"  {'✓' if cond else '✗'} {label}" + (f" — {extra}" if extra and not cond else ""))


def req(method, path, data=None, cookie=None, follow=False):
    url = BASE + path
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(url, data=body, method=method)
    if body:
        r.add_header("Content-Type", "application/json")
    if cookie:
        r.add_header("Cookie", cookie)
    if not follow:
        # لا متابعة تلقائية لإعادة التوجيه (نريد رؤية 307)
        opener = urllib.request.build_opener(NoRedirect())
        try:
            res = opener.open(r, timeout=30)
            return res.status, dict(res.headers), res.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read().decode("utf-8", "replace")
    try:
        res = urllib.request.urlopen(r, timeout=30)
        return res.status, dict(res.headers), res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", "replace")


def hget(headers, name):
    """بحث في الرؤوس بلا حساسية لحالة الأحرف"""
    for k, v in headers.items():
        if k.lower() == name.lower():
            return v
    return ""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def main():
    # ── تجهيز البيئة من .env بلا طباعة ──
    env = dict(os.environ)
    with open(f"{ROOT}/.env", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
    env.update({"PORT": PORT, "HOSTNAME": "127.0.0.1", "NODE_ENV": "production"})

    # كلمة مرور المدير من .secrets — لا تُطبع أبداً
    with open(f"{ROOT}/.secrets/admin_password", encoding="utf-8") as f:
        admin_password = f.read().strip()
    assert admin_password, "admin_password فارغ!"

    print("🚀 تشغيل الخادم standalone على المنفذ", PORT)
    log = open(f"{ROOT}/.tmp-lock-server.log", "w")
    server = subprocess.Popen(
        ["node", f"{ROOT}/.next/standalone/server.js"],
        cwd=f"{ROOT}/.next/standalone", env=env, stdout=log, stderr=log
    )
    try:
        # انتظار الجاهزية
        for _ in range(60):
            try:
                code, _, _ = req("GET", "/lock")
                if code < 600:
                    break
            except Exception:
                pass
            time.sleep(1)
        else:
            print("الخادم لم يجهز — راجع .tmp-lock-server.log")
            sys.exit(1)

        print("\n── دورة القفل ──")
        # 1) الجذر بلا مفتاح → 307 إلى /lock
        code, headers, _ = req("GET", "/")
        loc = hget(headers, "x-middleware-redirect") or hget(headers, "location")
        check(code == 307, f"GET / بلا مفتاح → 307 (فعلي: {code})")
        check("/lock" in loc, f"التوجيه إلى /lock (فعلي: {loc[:80]})")
        check("no-store" in hget(headers, "cache-control"), "رأس no-store على التوجيه")

        # 2) شاشة القفل نفسها متاحة
        code, _, html = req("GET", "/lock")
        check(code == 200, f"GET /lock → 200 (فعلي: {code})")
        check("النظام مقفل" in html and "مفتاح النظام" in html, "شاشة القفل تعرض طلب المفتاح")

        # nonce واحد فقط في سكربتات HTML (اتساق CSP)
        nonces = set(re.findall(r'nonce="([^"]+)"', html))
        check(len(nonces) <= 1, f"سكربتات HTML بنفس nonce (عددهم: {len(nonces)})")

        # 3) API بلا مفتاح → 401 locked
        code, _, body = req("GET", "/api/drugs")
        check(code == 401, f"GET /api/drugs بلا مفتاح → 401 (فعلي: {code})")
        check('"locked":true' in body.replace(" ", ""), "الاستجابة تعلن locked:true")

        # 4) /download تبقى عامة
        code, _, html = req("GET", "/download")
        check(code == 200, f"GET /download بلا مفتاح → 200 (فعلي: {code})")

        # 5) مفتاح خاطئ → 401
        code, _, body = req("POST", "/api/lock/verify", {"password": "wrong-key-test-123"})
        check(code == 401, f"مفتاح خاطئ → 401 (فعلي: {code})")
        check("المفتاح غير صحيح" in body, "رسالة الرفض العامة")

        # 6) المفتاح الصحيح → 200 + كوكي موقّع
        code, headers, body = req("POST", "/api/lock/verify", {"password": admin_password})
        check(code == 200, f"المفتاح الصحيح → 200 (فعلي: {code})")
        set_cookie = hget(headers, "set-cookie")
        check("ruba_lock=" in set_cookie, "كوكي ruba_lock صدر")
        check("HttpOnly" in set_cookie, "الكوكي HttpOnly")
        lock_token = re.search(r"ruba_lock=([^;]+)", set_cookie)
        check(bool(lock_token), "استخراج التوكن من الكوكي")

        # 7) الجذر بالمفتاح → 200
        code, _, html = req("GET", "/", cookie=f"ruba_lock={lock_token.group(1)}")
        check(code == 200, f"GET / بالمفتاح → 200 (فعلي: {code})")

        # 8) API بالمفتاح → 200
        code, _, _ = req("GET", "/api/drugs", cookie=f"ruba_lock={lock_token.group(1)}")
        check(code == 200, f"GET /api/drugs بالمفتاح → 200 (فعلي: {code})")

        # 9) توكن مفبرك → مرفوض (توقيع jose)
        fake = lock_token.group(1)[:-6] + "AAAAAA"
        code, _, _ = req("GET", "/", cookie=f"ruba_lock={fake}")
        check(code == 307, f"توكن مفبرك → 307 للقفل (فعلي: {code})")

        # 10) تدقيق: صف system-lock مسجل في القاعدة (عبر API محمي بالمفتاح فقط؟
        #     التحقق مباشر من القاعدة محلياً غير متاح هنا — يكفي نجاح المسار)
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
        log.close()

    print(f"\nالنتيجة: {len(passed)} ناجح، {len(failures)} فاشل")
    if failures:
        print("فشل:", failures)
        sys.exit(1)
    print("✅ دورة قفل النظام كاملة ناجحة محلياً")


if __name__ == "__main__":
    main()
