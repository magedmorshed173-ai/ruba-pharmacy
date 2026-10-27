#!/usr/bin/env python3
"""بناء .env المحلي من .secrets/neon_conn.json — v4.6.5 — بلا طباعة أي قيمة.
يكتب أيضاً AUTH_SECRET المولَّد في .secrets/auth_secret لاستخدامه في رفع Vercel.
"""
import json
import os
import re
import stat
import secrets as pysecrets

SECRETS = "/home/z/my-project/.secrets"
conn = json.load(open(f"{SECRETS}/neon_conn.json"))


def find(suffix: str) -> str:
    for k, v in conn.items():
        if k.endswith(suffix):
            return v
    raise KeyError(suffix)


pooled = find(".data_DATABASE_URL")
direct = find(".data_DATABASE_URL_UNPOOLED")
assert "-pooler." in pooled, "pooled URL must contain -pooler"
assert "-pooler." not in direct, "direct URL must NOT contain -pooler"
assert "sslmode=require" in pooled and "sslmode=require" in direct, "sslmode=require required"

auth = pysecrets.token_hex(32)
with open(f"{SECRETS}/auth_secret", "w") as f:
    f.write(auth)
os.chmod(f"{SECRETS}/auth_secret", stat.S_IRUSR | stat.S_IWUSR)

admin = open(f"{SECRETS}/admin_password").read().strip()

env = (
    "# صيدلية رُبى — بيئة محلية مولّدة آلياً (v4.6.5) — gitignored — لا تُنشر أبداً\n"
    f'DATABASE_URL="{pooled}"\n'
    f'DIRECT_URL="{direct}"\n'
    f'AUTH_SECRET="{auth}"\n'
    f'RUBA_ADMIN_PASSWORD="{admin}"\n'
    'NEON_PROJECT_ID="rapid-dawn-57152759"\n'
)
with open("/home/z/my-project/.env", "w") as f:
    f.write(env)
os.chmod("/home/z/my-project/.env", stat.S_IRUSR | stat.S_IWUSR)

mask = lambda u: re.sub(r"\w+://[^@/]*@", "***@", u.split("?")[0])  # noqa: E731
print(".env built (600):", mask(pooled), "|", mask(direct))
print("auth_secret saved to .secrets/ (64 hex)")
