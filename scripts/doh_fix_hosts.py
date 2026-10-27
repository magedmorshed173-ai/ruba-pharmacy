#!/usr/bin/env python3
"""
إصلاح DNS داخل عدّاء GitHub Actions — v4.6.4
بعض تشغيلات العدّاءين تفشل في حل نطاقات neon.tech بالمُحلِّل النظامي
(NXDOMAIN من getent/curl/node — مُوثَّق مرتين في v4.6.3). هذا السكربت
يحل المضيفين عبر DoH (dns.google ثم cloudflare ثم 1.1.1.1) ويكتبهم
في /etc/hosts عبر sudo عند فشل المُحلِّل النظامي فقط.
الاستخدام: python3 scripts/doh_fix_hosts.py HOST [HOST...]
"""
import json
import socket
import subprocess
import sys
import urllib.request

DOH = [
    "https://dns.google/resolve?name={h}&type={t}",
    "https://cloudflare-dns.com/dns-query?name={h}&type={t}",
    "https://1.1.1.1/dns-query?name={h}&type={t}",
]


def resolve_doh(host: str, qtype: int) -> str:
    for tpl in DOH:
        try:
            req = urllib.request.Request(
                tpl.format(h=host, t=qtype),
                headers={"accept": "application/dns-json"},
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                ans = json.loads(r.read().decode()).get("Answer") or []
            ips = [a["data"] for a in ans if a.get("type") == qtype]
            if ips:
                return ips[0]
        except Exception:  # noqa: BLE001
            continue
    return ""


def main() -> None:
    hosts = sys.argv[1:]
    if not hosts:
        print("::error::لا مضيفين — الاستخدام: doh_fix_hosts.py HOST [HOST...]")
        sys.exit(1)
    for host in hosts:
        try:
            socket.getaddrinfo(host, None)
            print(f"{host}: المُحلِّل النظامي سليم — لا حاجة للإصلاح")
            continue
        except socket.gaierror:
            pass
        ip = resolve_doh(host, 1) or resolve_doh(host, 28)
        if not ip:
            print(
                f"::error::تعذر حل {host} عبر كل مصادر DoH — "
                "العدّاء محجوب عن هذا النطاق فعلاً"
            )
            sys.exit(1)
        subprocess.run(
            ["sudo", "sh", "-c", f'echo "{ip} {host}" >> /etc/hosts'],
            check=True,
        )
        print(f"{host}: حُلّ عبر DoH وأُدرج في /etc/hosts")
    print("انتهى إصلاح DNS")


if __name__ == "__main__":
    main()
