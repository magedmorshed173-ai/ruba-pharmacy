#!/usr/bin/env python3
"""
ضبط أسرار GitHub Actions بتشفير libsodium sealed box — v4.6.3
الاستخدام: python3 scripts/gh-set-secrets.py SECRET_NAME [SECRET_NAME...]
القيم تُقرأ من متغيرات البيئة بالاسم نفسه — لا تُطبع القيم أبداً (الإخراج
أسماء وحالات فقط). يتطلب GITHUB_TOKEN بصلاحية إدارة الريبو وPyNaCl.
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.request

from nacl import encoding, public

REPO = os.environ.get("GITHUB_REPO", "magedmorshed173-ai/ruba-pharmacy")


def api(path: str, data: dict | None = None, method: str | None = None) -> dict:
    token = os.environ["GITHUB_TOKEN"]
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        data=body,
        method=method or ("POST" if body is not None else "GET"),
        headers={
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github+json",
        },
    )
    try:
        with urllib.request.urlopen(req) as res:
            raw = res.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} on {method or 'GET'} {path}: {e.read().decode()[:300]}")
        raise


def main() -> None:
    names = sys.argv[1:]
    if not names:
        print("استخدام: gh-set-secrets.py NAME [NAME...] — القيم من متغيرات البيئة")
        sys.exit(2)

    pk = api(f"/repos/{REPO}/actions/secrets/public-key")
    key = public.PublicKey(pk["key"].encode(), encoding.Base64Encoder())
    sealed = public.SealedBox(key)

    for name in names:
        value = os.environ.get(name)
        if value is None or value == "":
            print(f"✗ {name}: لا قيمة في متغيرات البيئة — تخطي")
            continue
        encrypted = sealed.encrypt(value.encode())
        api(
            f"/repos/{REPO}/actions/secrets/{name}",
            {
                "encrypted_value": base64.b64encode(encrypted).decode(),
                "key_id": pk["key_id"],
            },
            method="PUT",
        )
        print(f"✓ {name}: ضُبط كسر ريبو (مشفّر — القيمة لم تُطبع)")

    listed = api(f"/repos/{REPO}/actions/secrets")["secrets"]
    print("أسرار الريبو الآن:", sorted(s["name"] for s in listed))


if __name__ == "__main__":
    main()
