#!/usr/bin/env python3
"""مراقبة نشر Vercel حتى الجاهزية — يطبع الحالات والإحصاءات فقط (لا أسرار)."""
import json
import sys
import time
import urllib.request

TOKEN = open("/home/z/my-project/.secrets/vercel_token").read().strip()
DEP_ID = sys.argv[1] if len(sys.argv) > 1 else "dpl_FYGSgtHpc1RNuphFDkybjg6SNpoK"
TEAM = "team_AZaLO0kiTiVUkNmNJhmWHFSu"


def get(path: str) -> dict:
    req = urllib.request.Request(
        f"https://api.vercel.com{path}", headers={"Authorization": f"Bearer {TOKEN}"}
    )
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read())


last = ""
deadline = time.time() + 600
while time.time() < deadline:
    try:
        d = get(f"/v13/deployments/{DEP_ID}?teamId={TEAM}")
    except Exception as e:  # noqa: BLE001
        print(f"  poll error: {e}")
        time.sleep(10)
        continue
    state = d.get("readyState", "?")
    if state != last:
        ts = time.strftime("%H:%M:%S")
        print(f"[{ts}] readyState={state} buildingAt={d.get('buildingAt', '-')}")
        last = state
    if state in ("READY", "ERROR", "CANCELED"):
        print(f"FINAL: {state}")
        print(f"url: {d.get('url')}")
        if state == "ERROR":
            # أحدث رسالة خطأ من أحداث البناء (نصوص البناء لا تحتوي أسراراً)
            try:
                ev = get(f"/v2/deployments/{DEP_ID}/events?teamId={TEAM}&limit=100&builds=1")
                for item in reversed(ev if isinstance(ev, list) else ev.get("events", [])):
                    payload = item.get("payload", {})
                    text = payload.get("text", "") or json.dumps(payload)[:200]
                    if "::error::" in text or '"errorMessage"' in json.dumps(payload):
                        print("BUILD ERROR TEXT:", text[:600])
                        break
            except Exception as e:  # noqa: BLE001
                print(f"(تعذر جلب أحداث البناء: {e})")
        sys.exit(0 if state == "READY" else 1)
    time.sleep(12)
print("TIMEOUT: 10 دقائق انتهت بلا حالة نهائية")
sys.exit(2)
