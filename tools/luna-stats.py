#!/usr/bin/env python3
"""Day so lieu thong ke theo du an len App Dieu Khien AI (Yeu cau 31).

Luna tong ket lich dang bai / cham soc tren Muse theo tuan roi day ve app
qua POST /api/luna/stats (cung secret X-Luna-Secret nhu cau noi YC28/YC30).
Dashboard tren tai khoan admin cua anh doc so lieu nay tu D1.

    python3 luna-stats.py push --project bluemax --kind article --period 2026-W47 --file stats.json

File stats.json:
    {
      "scheduled": 3, "posted": 3,
      "links": ["https://bluemax.vn/bai-1", "..."],
      "details": {
        "seo": {"avg": 100, "min": 100},
        "index": {"requested": 3, "indexed": 2},
        "late": [{"title": "...", "due": "2026-11-18"}],
        "missing": [],
        "articles": [
          {"date": "2026-11-16", "title": "Xang E5 va E10 khac nhau the nao?",
           "link": "https://bluemax.vn/xang-e5-va-e10-khac-nhau-the-nao",
           "seo": 100, "indexed": true}
        ]
      }
    }
Chi truong scheduled/posted la bat buoc; links/details tuy chon.
Day lai cung (project, kind, period) thi cap nhat de (upsert).

Bien moi truong (doc tu Secure Vault / env khi chay, KHONG ghi cung):
    LUNA_API_BASE   mac dinh https://ung-dung-dieu-khien-ai.pages.dev
    LUNA_API_SECRET secret chung cho /api/luna/*

KHONG in secret/token ra log hay output duoi bat ky hinh thuc nao.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_BASE = "https://ung-dung-dieu-khien-ai.pages.dev"
PROJECT_SLUGS = ["bluemax", "binhminh", "khanhnghi", "inox"]
KINDS = ["article", "page", "web"]
PERIOD_RE = re.compile(r"^20\d\d-W(0[1-9]|[1-4][0-9]|5[0-3])$")
URL_RE = re.compile(r"^https?://[^\s/$.?#].[^\s]*$", re.IGNORECASE)


def api_base():
    return os.environ.get("LUNA_API_BASE", DEFAULT_BASE).rstrip("/")


def api_secret():
    s = os.environ.get("LUNA_API_SECRET", "").strip()
    if not s:
        print("Thieu LUNA_API_SECRET trong bien moi truong.", file=sys.stderr)
        sys.exit(2)
    return s


def http_json(method, url, headers=None, body=None):
    req = urllib.request.Request(url, method=method)
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=60) as res:
            return res.status, json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode("utf-8"))
            msg = payload.get("error") or f"HTTP {e.code}"
        except Exception:
            msg = f"HTTP {e.code}"
        return e.code, {"ok": False, "error": msg}
    except Exception as e:
        return 0, {"ok": False, "error": str(e)}


def fail(msg):
    print(msg, file=sys.stderr)
    sys.exit(2)


def validate_stats(data):
    if not isinstance(data, dict):
        fail("File stats.json phai la object JSON.")
    for k in ("scheduled", "posted"):
        v = data.get(k)
        if not isinstance(v, int) or isinstance(v, bool) or v < 0:
            fail(f"{k} phai la so nguyen >= 0.")
    links = data.get("links", [])
    if not isinstance(links, list) or len(links) > 200:
        fail("links phai la mang toi da 200 URL.")
    for u in links:
        if not isinstance(u, str) or not URL_RE.match(u.strip()):
            fail("links: moi phan tu phai la URL http(s).")
    details = data.get("details", {})
    if not isinstance(details, dict):
        fail("details phai la object.")
    articles = details.get("articles", [])
    if not isinstance(articles, list) or len(articles) > 200:
        fail("details.articles phai la mang toi da 200 bai.")
    for a in articles:
        if not isinstance(a, dict) or not isinstance(a.get("title"), str) or not a["title"].strip():
            fail("details.articles: moi bai phai co title.")
        if a.get("link") and (not isinstance(a["link"], str) or not URL_RE.match(a["link"].strip())):
            fail("details.articles: link phai la URL http(s).")
        seo = a.get("seo")
        if seo is not None and (not isinstance(seo, (int, float)) or isinstance(seo, bool) or seo < 0 or seo > 100):
            fail("details.articles: seo phai la so 0-100.")
    return data


def cmd_push(args):
    if args.project not in PROJECT_SLUGS:
        fail("project phai la 1 trong: " + ", ".join(PROJECT_SLUGS))
    if args.kind not in KINDS:
        fail("kind phai la 1 trong: " + ", ".join(KINDS))
    if not PERIOD_RE.match(args.period or ""):
        fail("period phai dung dang tuan ISO 'YYYY-Www' (vd '2026-W47').")
    path = Path(args.file)
    if not path.is_file():
        fail(f"Khong tim thay file: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        fail(f"File stats.json khong doc duoc: {e}")
    data = validate_stats(data)
    body = {
        "project": args.project,
        "kind": args.kind,
        "period": args.period,
        "scheduled": data["scheduled"],
        "posted": data["posted"],
        "links": data.get("links", []),
        "details": data.get("details", {}),
    }
    status, res = http_json(
        "POST", api_base() + "/api/luna/stats",
        headers={"X-Luna-Secret": api_secret()}, body=body,
    )
    if status != 200 or not res.get("ok"):
        print(f"Day so lieu loi: {res.get('error', 'HTTP ' + str(status))}", file=sys.stderr)
        sys.exit(1)
    verb = "Cap nhat" if not res.get("created") else "Da luu"
    print(f"{verb} so lieu {res.get('project')} / {res.get('kind')} / {res.get('period')}: "
          f"theo lich {res.get('scheduled')}, da dang {res.get('posted')}.")


def main():
    ap = argparse.ArgumentParser(description="Day so lieu thong ke theo du an len App Dieu Khien AI (Yeu cau 31)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("push", help="Day ban tong ket 1 tuan cua 1 du an len app")
    p.add_argument("--project", required=True, help="bluemax | binhminh | khanhnghi | inox")
    p.add_argument("--kind", required=True, choices=KINDS, help="article | page | web")
    p.add_argument("--period", required=True, help="Tuan ISO, vd 2026-W47")
    p.add_argument("--file", required=True, help="File stats.json (scheduled, posted, links?, details?)")
    p.set_defaults(fn=cmd_push)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
