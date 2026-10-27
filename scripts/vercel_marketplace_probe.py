#!/usr/bin/env python3
"""استكشاف تكاملات Vercel/Neon — يطبع معرّفات وأسماء وحالات فقط."""
import json
import urllib.request

TOKEN = open("/home/z/my-project/.secrets/vercel_token").read().strip()
API = "https://api.vercel.com"


def api(path: str) -> dict:
    req = urllib.request.Request(f"{API}{path}", headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


team = ""
try:
    teams = api("/v2/teams?limit=5").get("teams", [])
    team = teams[0]["id"] if teams else ""
except Exception as e:  # noqa: BLE001
    print(f"teams call failed ({e}) — deriving team from project accountId")
    team = api("/v9/projects/prj_5p5n9DYCBrOnWpPwKzVB9ASU9AYE").get("accountId", "")
tq = f"teamId={team}&" if team else ""
print(f"team: {team[:12]}…")

print("=== storage stores ===")
try:
    stores = api(f"/v1/storage/stores?{tq}limit=20").get("stores", [])
    print(f"count: {len(stores)}")
    for s in stores:
        print(
            f"  - id={s.get('id')} name={s.get('name')} provider={s.get('provider')} "
            f"status={s.get('status')} creator={s.get('creator', {}).get('username')} "
            f"createdAt={s.get('createdAt')}"
        )
except Exception as e:  # noqa: BLE001
    print(f"ERROR: {e}")

print("=== integration configurations ===")
try:
    cfgs = api(f"/v1/integrations/configurations?{tq}limit=20").get("integrations", [])
    print(f"count: {len(cfgs)}")
    for c in cfgs:
        print(
            f"  - id={c.get('id')} slug={c.get('integrationSlug')} project={c.get('integrationProductId')} "
            f"installType={c.get('installType')} createdAt={c.get('createdAt')}"
        )
except Exception as e:  # noqa: BLE001
    print(f"ERROR: {e}")

print("=== marketplace installations (native) ===")
try:
    inst = api(f"/v1/marketplace/installations?{tq}limit=20").get("installations", [])
    print(f"count: {len(inst)}")
    for i in inst:
        print(
            f"  - installationId={i.get('installationId')} product={i.get('integrationProductId')} "
            f"status={i.get('status')} name={i.get('name')}"
        )
except Exception as e:  # noqa: BLE001
    print(f"ERROR: {e}")
