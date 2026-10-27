#!/usr/bin/env python3
"""تحقق حي من قفل النظام على الإنتاج — الأكواد والحالات فقط، بلا أي سر."""
import json
import re
import sys
import urllib.error
import urllib.request

BASE = "https://ruba-pharmacy.vercel.app"
passed, failures = [], []


def check(cond, label, extra=""):
    (passed if cond else failures).append(label)
    print(f"  {'✓' if cond else '✗'} {label}" + (f" — {extra}" if extra and not cond else ""))


def hget(headers, name):
    for k, v in headers.items():
        if k.lower() == name.lower():
            return v
    return ""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def req(method, path, data=None, cookie=None):
    r = urllib.request.Request(BASE + path, method=method)
    if data is not None:
        r.data = json.dumps(data).encode()
        r.add_header("Content-Type", "application/json")
    if cookie:
        r.add_header("Cookie", cookie)
    opener = urllib.request.build_opener(NoRedirect())
    try:
        res = opener.open(r, timeout=45)
        return res.status, dict(res.headers), res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", "replace")


admin_password = open("/home/z/my-project/.secrets/admin_password", encoding="utf-8").read().strip()
assert admin_password

print("── التحقق الحي من قفل النظام:", BASE, "──")

# 1) الجذر بلا مفتاح
code, headers, _ = req("GET", "/")
loc = hget(headers, "location")
check(code == 307, f"GET / بلا مفتاح → 307 (فعلي: {code})")
check("/lock" in loc, f"التوجيه إلى /lock (فعلي: {loc[:60]})")

# 2) شاشة القفل
code, _, html = req("GET", "/lock")
check(code == 200, f"GET /lock → 200 (فعلي: {code})")
check("النظام مقفل" in html and "مفتاح النظام" in html, "شاشة القفل بالعربية كاملة")

# 3) API محمي
code, _, body = req("GET", "/api/drugs")
check(code == 401, f"GET /api/drugs بلا مفتاح → 401 (فعلي: {code})")
check('"locked":true' in body.replace(" ", ""), "الاستجابة تعلن locked:true")

# 4) واجهة الدخول نفسها محمية
code, _, _ = req("POST", "/api/auth/login", {"username": "admin", "password": "x"})
check(code == 401, f"POST /api/auth/login بلا مفتاح → 401 (فعلي: {code})")

# 5) صفحة التحميل عامة
code, _, html = req("GET", "/download")
check(code == 200, f"GET /download → 200 (فعلي: {code})")

# 6) مفتاح خاطئ
code, _, body = req("POST", "/api/lock/verify", {"password": "wrong-live-key-1"})
check(code == 401, f"مفتاح خاطئ → 401 (فعلي: {code})")

# 7) المفتاح الصحيح
code, headers, body = req("POST", "/api/lock/verify", {"password": admin_password})
check(code == 200, f"المفتاح الصحيح (مدير النظام) → 200 (فعلي: {code})")
sc = hget(headers, "set-cookie")
m = re.search(r"ruba_lock=([^;]+)", sc)
check(bool(m) and "HttpOnly" in sc, "كوكي ruba_lock موقّع HttpOnly صدر")

# 8) النظام مفتوح بالمفتاح
token = m.group(1)
code, _, html = req("GET", "/", cookie=f"ruba_lock={token}")
check(code == 200, f"GET / بالمفتاح → 200 (فعلي: {code})")

# 9) API بالمفتاح
code, _, _ = req("GET", "/api/drugs", cookie=f"ruba_lock={token}")
check(code == 200, f"GET /api/drugs بالمفتاح → 200 (فعلي: {code})")

# 10) توكن مفبرك
code, _, _ = req("GET", "/", cookie=f"ruba_lock={token[:-6]}AAAAAA")
check(code == 307, f"توكن مفبرك → 307 للقفل (فعلي: {code})")

# 11) بقاء صفحة التحميل خارج القفل حتى بالمفتاح
code, _, _ = req("GET", "/download", cookie=f"ruba_lock={token}")
check(code == 200, f"GET /download بالمفتاح → 200 (فعلي: {code})")

print(f"\nالنتيجة: {len(passed)} ناجح، {len(failures)} فاشل")
if failures:
    print("فشل:", failures)
    sys.exit(1)
print("✅ قفل النظام حي ويعمل على الإنتاج بالكامل")
