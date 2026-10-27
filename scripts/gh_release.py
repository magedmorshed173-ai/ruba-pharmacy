#!/usr/bin/env python3
"""إنشاء إصدار GitHub v4.6.6 ورفع أصول التحميل — بلا طباعة التوكن."""
import json
import re
import subprocess
import sys
import urllib.request

REPO = "magedmorshed173-ai/ruba-pharmacy"
TAG = "v4.6.6"
ASSETS = [
    ("install.sh", "scripts/install.sh", "application/octet-stream"),
    ("install.ps1", "scripts/install.ps1", "application/octet-stream"),
    ("docker-compose.yml", "docker-compose.yml", "application/octet-stream"),
]

remote = subprocess.check_output(
    ["git", "remote", "get-url", "origin"], text=True
).strip()
m = re.search(r"https://[^:]+:([^@]+)@", remote)
if not m:
    sys.exit("✗ لا توكن في remote")
TOKEN = m.group(1)

BODY = """<div dir="rtl">

## 💊 صيدلية رُبى v4.6.6 — التطبيق على كل المنصات

نظام إدارة صيدليات عربي متكامل — نقطة بيع، مخزون FEFO، مرضى، تداخلات حية،
فوترة ZATCA — الآن **بتوزيع شامل**:

### 📥 التثبيت بأمر واحد

**Linux · macOS · WSL · Termux (أندرويد):**
```bash
curl -fsSL https://github.com/magedmorshed173-ai/ruba-pharmacy/raw/main/scripts/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://github.com/magedmorshed173-ai/ruba-pharmacy/raw/main/scripts/install.ps1 | iex
```

**Docker (خوادم/VPS):**
```bash
git clone --depth 1 https://github.com/magedmorshed173-ai/ruba-pharmacy.git
cd ruba-pharmacy && export AUTH_SECRET="$(openssl rand -hex 32)" && docker compose up -d --build
```

### 🌱 التطبيق السحابي الحي — بلا تثبيت
**https://ruba-pharmacy.vercel.app** — افتحه في أي جهاز واضغط «تثبيت التطبيق» (PWA).

### 📦 أصول هذا الإصدار
| الملف | الغرض |
|---|---|
| `install.sh` | المثبّت الشامل — يكتشف البيئة ويثبّت كل شيء (يدعم Termux عبر proot-debian وخيار خدمة systemd) |
| `install.ps1` | مثبّت ويندوز الأصلي (winget + Docker/Bun/Node) |
| `docker-compose.yml` | التشغيل الحاوي الكامل (قاعدة + ترحيلات + منصة) |

الأصول الثلاثة لا تحتوي أي أسرار — قيم الاتصال تُدخل محلياً وقت التثبيت فقط.

### 📝 أبرز التغييرات
- صفحة `/download` داخل التطبيق + اختصار في أيقونة PWA
- بناء عابر للمنصات فعلياً (بلا أوامر يونكسية في `build`/`start`)
- دليل المنصات الكامل: `docs/PLATFORMS.md`

</div>
"""


def api(url: str, data=None, method=None, content=None, ctype=None):
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "ruba-release-script",
    }
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    elif content is not None:
        body = content
        headers["Content-Type"] = ctype or "application/octet-stream"
    req = urllib.request.Request(url, data=body, headers=headers, method=method or ("POST" if body is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, (json.loads(r.read()) if (r.headers.get("Content-Type", "").startswith("application/json") and r.headers.get("Content-Length", "0") != "0") else {})
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


# 1) head sha
s, d = api(f"https://api.github.com/repos/{REPO}/commits/main")
sha = d.get("sha", "")
print(f"head: {sha[:7]} (HTTP {s})")

# 2) tag إن لم يوجد
s, d = api(f"https://api.github.com/repos/{REPO}/git/ref/tags/{TAG}")
if s == 200:
    print("tag موجود مسبقاً ✓")
else:
    s, d = api(f"https://api.github.com/repos/{REPO}/git/refs",
               {"ref": f"refs/tags/{TAG}", "sha": sha})
    print(f"tag: HTTP {s}")

# 3) الإصدار (أو استرجاعه إن موجود)
s, d = api(f"https://api.github.com/repos/{REPO}/releases/tags/{TAG}")
if s == 200:
    rel = d
    print(f"release موجود مسبقاً id={rel.get('id')}")
else:
    s, rel = api(f"https://api.github.com/repos/{REPO}/releases",
                 {"tag_name": TAG, "name": "v4.6.6 — التطبيق على كل المنصات",
                  "body": BODY, "draft": False, "prerelease": False})
    print(f"release: HTTP {s} id={rel.get('id')}")
rel_id = rel.get("id")
print(f"رابط الإصدار: https://github.com/{REPO}/releases/tag/{TAG}")

# 4) الأصول
existing = {a["name"] for a in rel.get("assets", [])}
for name, path, ctype in ASSETS:
    if name in existing:
        print(f"asset {name}: موجود مسبقاً — تخطّي")
        continue
    content = open(f"/home/z/my-project/{path}", "rb").read()
    s, _ = api(f"https://uploads.github.com/repos/{REPO}/releases/{rel_id}/assets?name={name}",
               content=content, ctype=ctype)
    print(f"asset {name}: HTTP {s} {'✓' if s == 201 else '✗'}")
print("DONE")
