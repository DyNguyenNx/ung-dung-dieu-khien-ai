#!/usr/bin/env python3
"""Cau noi Luna <-> App Dieu Khien AI (Yeu cau 28 + 30).

Luna poll endpoint inbox cua app de lay brief Design Web / Cham soc web /
Cham soc page, tai anh that cua khach qua Telegram (chi Design Web),
roi tra file HTML (Design Web) hoac ket qua text (web/page) ve app.

    python3 luna-bridge.py pending [--status luna|review|all] [--all]
    python3 luna-bridge.py photos <task-id> [--out DIR]
    python3 luna-bridge.py creds <task-id>
    python3 luna-bridge.py deliver <task-id> <file.html> [--note "..."]
    python3 luna-bridge.py deliver <task-id> --kind posted|content --text-file <file.txt> [--link <url>] [--note "..."]
    python3 luna-bridge.py stats push --project <slug> --kind article|page|web --period 2026-W47 --file stats.json
        (alias cua tools/luna-stats.py push — day so lieu thong ke theo du an, Yeu cau 31)
    python3 luna-bridge.py push-result start --project <slug> --kind article|design|web --work-key <key> --title "..." [--words N]
    python3 luna-bridge.py push-result finish --work-key <key> --result-kind posted|content --text-file <file> [--link <url>] [--seo N]
    python3 luna-bridge.py progress <task-id> <0-99> [--note "..."]
        (Yeu cau 43 — day viec tu Muse vao app de bang MCP co luong that + dong bo % tien do)

Ket qua text (Yeu cau 30):
    --kind posted  = Luna da TU DANG len web/page that (du an cua anh Dy):
                     --text-file la bao cao da lam gi, --link la URL bai da dang.
    --kind content = Luna tra NOI DUNG hoan chinh (du an nhan vien dang ky):
                     --text-file la bai viet / bai dang de nhan vien tu dang.

Tai khoan admin (Yeu cau 38):
    creds <task-id>  = lay tai khoan admin cua website trong nhiem vu web
                     (GET /api/luna/tasks/<task-id>/credentials) de Luna tu
                     dang bai len web khach (kind 'posted'). In ra stdout CHI
                     DE LUNA DUNG LUC LAM VIEC — chua mat khau admin that,
                     KHONG gui vao Telegram, KHONG ghi vao log/file, KHONG
                     dan vao brief. Khong co website/mat khau da luu -> 404.

Bien moi truong (doc tu Secure Vault / env khi chay, KHONG ghi cung):
    LUNA_API_BASE           mac dinh https://ung-dung-dieu-khien-ai.pages.dev
    LUNA_API_SECRET         secret chung cho /api/luna/pending + /api/luna/delivery
    LUNA_TELEGRAM_BOT_TOKEN token bot RIENG @app_dieu_khien_ai_bot (chi de tai anh qua getFile)

State (brief nao da thay) luu NGOAI repo:
    ~/workspace/your_files/app-dieu-khien-ai/.luna-state/pending.json
Anh tai ve luu o:
    ~/workspace/your_files/app-dieu-khien-ai/luna-inbox/<task-id>/

KHONG in secret/token ra log hay output duoi bat ky hinh thuc nao.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_BASE = "https://ung-dung-dieu-khien-ai.pages.dev"
# Cloudflare Pages tra 403 voi User-Agent mac dinh cua urllib
# (Python-urllib/* bi chan) — dung UA trinh duyet de request toi duoc app.
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
STATE_PATH = Path.home() / "workspace" / "your_files" / "app-dieu-khien-ai" / ".luna-state" / "pending.json"
INBOX_DIR = Path.home() / "workspace" / "your_files" / "app-dieu-khien-ai" / "luna-inbox"


def api_base():
    return os.environ.get("LUNA_API_BASE", DEFAULT_BASE).rstrip("/")


def api_secret():
    s = os.environ.get("LUNA_API_SECRET", "").strip()
    if not s:
        print("Thieu LUNA_API_SECRET trong bien moi truong.", file=sys.stderr)
        sys.exit(2)
    return s


def tg_token():
    t = os.environ.get("LUNA_TELEGRAM_BOT_TOKEN", "").strip()
    if not t:
        print("Thieu LUNA_TELEGRAM_BOT_TOKEN trong bien moi truong.", file=sys.stderr)
        sys.exit(2)
    return t


def http_json(method, url, headers=None, body=None):
    req = urllib.request.Request(url, method=method)
    req.add_header("User-Agent", USER_AGENT)
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


def luna_get(path):
    url = api_base() + path
    status, data = http_json("GET", url, headers={"X-Luna-Secret": api_secret()})
    if status != 200 or not data.get("ok"):
        print(f"Loi goi {path}: {data.get('error', 'HTTP ' + str(status))}", file=sys.stderr)
        sys.exit(1)
    return data


def load_state():
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(state):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def fmt_task(t):
    b = t.get("brief", {})
    p = t.get("photos", {})
    feature = t.get("feature", "")
    lines = [
        f"[{t.get('id')}] {t.get('title')}",
        f"  Tinh nang: {feature} | Trang thai: {t.get('status')} | Nguoi giao: {t.get('owner', {}).get('name', '')} ({t.get('owner', {}).get('email', '')})",
        f"  AI phu trach: {t.get('ai', '')}",
    ]
    # Yeu cau 30: brief web/page la title + meta + lines (collect() cua 2 tinh nang nay).
    if feature in ("web", "page"):
        if t.get("meta"):
            lines.append(f"  Tom tat: {t.get('meta')}")
        for ln in t.get("lines", []):
            lines.append(f"  - {ln}")
        if t.get("latest_result"):
            lr = t["latest_result"]
            lines.append(f"  Ket qua moi nhat ({lr.get('version', '?')} — {lr.get('kind', '')}):")
            if lr.get("link"):
                lines.append(f"    Link: {lr.get('link')}")
            lines.append(f"    {(lr.get('text') or '')[:500]}")
        for rev in t.get("revisions", []):
            lines.append(f"  Yeu cau sua ({rev.get('at', '')} — {rev.get('by', '')}): {rev.get('note', '')}")
        vers = t.get("versions", [])
        if vers:
            lines.append("  Phien ban da tra: " + ", ".join(
                f"{v.get('v', '?')}({v.get('kind', '')})" for v in vers))
        if t.get("sendError"):
            lines.append(f"  Loi gui brief: {t.get('sendError')}")
        return "\n".join(lines)
    lines += [
        f"  Khach: {b.get('customer', '')} | Linh vuc: {b.get('field', '')}",
        f"  Mau: {b.get('color', '')} | Font: {b.get('font', '')}",
        f"  Web tham khao: {b.get('ref', '')}",
        f"  Cac muc: {', '.join(b.get('sections', []))}",
        f"  Vi tri logo: {b.get('logoPos', '')}",
        f"  Doi tuong: {b.get('audience', '')}",
        f"  Hanh dong chinh: {b.get('action', '')}",
        f"  Chat lieu: {', '.join(b.get('materials', []))}",
    ]
    c = p.get("client", {})
    lines.append(
        f"  Anh that cua khach: {c.get('count', 0)} anh"
        + (f" (da gui {c.get('sent', 0)})" if c.get("count") else "")
        + (f" — ten: {', '.join(c.get('names', []))}" if c.get("names") else "")
    )
    if p.get("tickedPhotoButEmpty"):
        lines.append("  LUU Y: da tick 'Anh that' nhung chua dinh kem anh nao.")
    r = p.get("ref", {})
    if r.get("count"):
        lines.append(f"  Anh tham khao: {r.get('count')} anh — ten: {', '.join(r.get('names', []))}")
    if b.get("note"):
        lines.append(f"  Ghi chu: {b.get('note')}")
    for rev in t.get("revisions", []):
        lines.append(f"  Yeu cau sua ({rev.get('at', '')} — {rev.get('by', '')}): {rev.get('note', '')}")
    vers = t.get("versions", [])
    if vers:
        lines.append("  Phien ban da tra: " + ", ".join(v.get("v", "?") for v in vers))
    if t.get("sendError"):
        lines.append(f"  Loi gui brief: {t.get('sendError')}")
    return "\n".join(lines)


def cmd_pending(args):
    data = luna_get(f"/api/luna/pending?status={args.status}")
    tasks = data.get("tasks", [])
    state = load_state()
    shown = 0
    for t in tasks:
        key = t["id"]
        sig = f"{t.get('status')}|{len(t.get('versions', []))}|{len(t.get('revisions', []))}"
        if not args.all and state.get(key) == sig:
            continue
        print(fmt_task(t))
        print()
        state[key] = sig
        shown += 1
    save_state(state)
    print(f"Co {len(tasks)} nhiem vu dang cho ({args.status}); moi/thay doi: {shown}.")


def tg_api_base():
    # Mac dinh Telegram that; LUNA_TELEGRAM_API_BASE chi dung khi test local
    # (gia lap Telegram) — giong TELEGRAM_API_BASE phia Worker.
    return os.environ.get("LUNA_TELEGRAM_API_BASE", "https://api.telegram.org").rstrip("/")


def tg_get_file(file_id):
    url = f"{tg_api_base()}/bot{tg_token()}/getFile?file_id={urllib.parse.quote(file_id)}"
    try:
        with urllib.request.urlopen(url, timeout=60) as res:
            data = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"getFile loi HTTP {e.code}")
    if not data.get("ok"):
        raise RuntimeError(f"getFile loi: {data.get('description', 'khong ro')}")
    return data["result"]["file_path"]


def tg_download(file_path, dest):
    url = f"{tg_api_base()}/file/bot{tg_token()}/{file_path}"
    with urllib.request.urlopen(url, timeout=120) as res:
        dest.write_bytes(res.read())


def cmd_photos(args):
    data = luna_get("/api/luna/pending?status=all&limit=200")
    task = next((t for t in data.get("tasks", []) if t["id"] == args.task_id), None)
    if not task:
        print(f"Khong tim thay nhiem vu {args.task_id} trong hang cho Luna.", file=sys.stderr)
        sys.exit(1)
    out = Path(args.out) if args.out else INBOX_DIR / args.task_id
    out.mkdir(parents=True, exist_ok=True)
    groups = [
        ("client", task.get("photos", {}).get("client", {}).get("files", [])),
        ("ref", task.get("photos", {}).get("ref", {}).get("files", [])),
    ]
    total = 0
    for prefix, files in groups:
        for i, f in enumerate(files, 1):
            file_id = f.get("file_id")
            if not file_id:
                continue
            file_path = tg_get_file(file_id)
            ext = Path(file_path).suffix or ".jpg"
            dest = out / f"{prefix}-{i:02d}{ext}"
            tg_download(file_path, dest)
            print(f"Da tai: {dest} ({f.get('name', '')})")
            total += 1
    print(f"Xong: {total} anh -> {out}")


def cmd_creds(args):
    # Yeu cau 38: lay tai khoan admin cua website trong nhiem vu web de Luna
    # tu dang bai len web khach (kind 'posted'). Output CHUA MAT KHAU THAT —
    # chi in ra stdout de Luna dung luc lam viec, KHONG gui Telegram,
    # KHONG ghi log/file, KHONG dan vao brief.
    data = luna_get(f"/api/luna/tasks/{args.task_id}/credentials")
    print(f"Website: {data.get('website', '')}")
    print(f"Link admin: {data.get('admin_url', '')}")
    print(f"ID: {data.get('admin_user', '')}")
    print(f"Pass: {data.get('admin_pass', '')}")


def cmd_deliver(args):
    # Yeu cau 30: giao ket qua text cho web/page (kind posted/content).
    if args.kind:
        if args.kind not in ("posted", "content"):
            print("kind phai la 'posted' hoac 'content'.", file=sys.stderr)
            sys.exit(2)
        if not args.text_file:
            print("Giao ket qua text can --text-file <file>.", file=sys.stderr)
            sys.exit(2)
        text_path = Path(args.text_file)
        if not text_path.is_file():
            print(f"Khong tim thay file: {text_path}", file=sys.stderr)
            sys.exit(2)
        text = text_path.read_text(encoding="utf-8")
        if len(text.encode("utf-8")) > 1024 * 1024:
            print("Noi dung ket qua nang hon 1MB — hay gui noi dung gon hon.", file=sys.stderr)
            sys.exit(2)
        body = {"task_id": args.task_id, "kind": args.kind, "text": text}
        if args.kind == "posted" and args.link:
            body["link"] = args.link
        if args.note:
            body["note"] = args.note
        status, data = http_json(
            "POST", api_base() + "/api/luna/delivery",
            headers={"X-Luna-Secret": api_secret()}, body=body,
        )
        if status != 200 or not data.get("ok"):
            print(f"Giao ket qua loi: {data.get('error', 'HTTP ' + str(status))}", file=sys.stderr)
            sys.exit(1)
        kind_label = "da tu dang" if args.kind == "posted" else "noi dung de nhan vien tu dang"
        print(f"Da giao ban {data.get('version')} ({kind_label}) cho nhiem vu {data.get('task_id')} — trang thai: {data.get('status')} (cho anh duyet).")
        return
    html_path = Path(args.file)
    if not html_path.is_file():
        print(f"Khong tim thay file: {html_path}", file=sys.stderr)
        sys.exit(2)
    html = html_path.read_text(encoding="utf-8")
    if len(html.encode("utf-8")) > 1024 * 1024:
        print("File HTML nang hon 1MB — hay gui file gon hon.", file=sys.stderr)
        sys.exit(2)
    body = {"task_id": args.task_id, "html": html}
    if args.note:
        body["note"] = args.note
    status, data = http_json(
        "POST", api_base() + "/api/luna/delivery",
        headers={"X-Luna-Secret": api_secret()}, body=body,
    )
    if status != 200 or not data.get("ok"):
        print(f"Giao file loi: {data.get('error', 'HTTP ' + str(status))}", file=sys.stderr)
        sys.exit(1)
    print(f"Da giao ban {data.get('version')} cho nhiem vu {data.get('task_id')} — trang thai: {data.get('status')} (cho anh duyet).")


def cmd_stats_push(args):
    # Yeu cau 31: alias `luna-bridge.py stats push ...` — logic that o
    # tools/luna-stats.py (cung file stats.json, cung endpoint /api/luna/stats).
    # File ten luna-stats.py (gach ngang) nen khong import truc tiep duoc:
    # nap theo duong dan bang importlib.
    import importlib.util
    from pathlib import Path
    here = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location("luna_stats", here / "luna-stats.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.cmd_push(args)


# ---------- Yeu cau 43: day viec tu Muse vao app + dong bo % tien do ----------
WORK_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,120}$")
MUSE_KINDS = ("article", "design", "web")
PROJECT_SLUGS_43 = ("bluemax", "binhminh", "khanhnghi", "inox", "tranvu", "nhatlinh")


def check_work_key(key):
    if not key or not WORK_KEY_RE.match(key):
        return "work_key chi gom chu thuong, so va dau gach ngang (3-121 ky tu, bat dau bang chu/so)."
    return ""


def verify_live_link(url):
    """Kiem chung link live TRUOC khi day ket qua posted: GET theo redirect,
    yeu cau HTTP 200. Tra (True, '') hoac (False, ly_do). Chi dung cho link
    bai da dang cong khai; link demo/artifact (kind content) khong kiem."""
    req = urllib.request.Request(url, method="GET")
    req.add_header("User-Agent", USER_AGENT)
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            if res.status == 200:
                return True, ""
            return False, f"HTTP {res.status}"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as e:
        return False, str(e)


def cmd_push_result(args):
    if args.push_cmd == "start":
        bad = check_work_key(args.work_key)
        if bad:
            print(bad, file=sys.stderr)
            sys.exit(2)
        if args.project not in PROJECT_SLUGS_43:
            print("project phai la 1 trong: " + ", ".join(PROJECT_SLUGS_43), file=sys.stderr)
            sys.exit(2)
        if args.kind not in MUSE_KINDS:
            print("kind phai la 1 trong: " + ", ".join(MUSE_KINDS), file=sys.stderr)
            sys.exit(2)
        if not args.title.strip() or len(args.title) > 300:
            print("title bat buoc, toi da 300 ky tu.", file=sys.stderr)
            sys.exit(2)
        body = {"action": "start", "project": args.project, "kind": args.kind,
                "work_key": args.work_key, "title": args.title.strip()}
        if args.words:
            body["words"] = args.words
        if args.keyword:
            body["keyword"] = args.keyword
        if args.note:
            body["note"] = args.note
        status, data = http_json(
            "POST", api_base() + "/api/luna/muse-work",
            headers={"X-Luna-Secret": api_secret()}, body=body,
        )
        if status not in (200, 201) or not data.get("ok"):
            print(f"Day viec loi: {data.get('error', 'HTTP ' + str(status))}", file=sys.stderr)
            sys.exit(1)
        verb = "Da day viec moi vao app" if data.get("created") else "Viec nay da co trong app (khong tao them)"
        print(f"{verb}: task {data.get('task_id')} — trang thai: {data.get('status')} (bang MCP dang thay luong).")
        return
    # finish
    bad = check_work_key(args.work_key)
    if bad:
        print(bad, file=sys.stderr)
        sys.exit(2)
    if args.result_kind not in ("posted", "content"):
        print("result_kind phai la 'posted' hoac 'content'.", file=sys.stderr)
        sys.exit(2)
    if not args.text_file:
        print("Giao ket qua can --text-file <file>.", file=sys.stderr)
        sys.exit(2)
    text_path = Path(args.text_file)
    if not text_path.is_file():
        print(f"Khong tim thay file: {text_path}", file=sys.stderr)
        sys.exit(2)
    text = text_path.read_text(encoding="utf-8")
    if len(text.encode("utf-8")) > 1024 * 1024:
        print("Noi dung ket qua nang hon 1MB — hay gui noi dung gon hon.", file=sys.stderr)
        sys.exit(2)
    link = (args.link or "").strip()
    if args.result_kind == "posted":
        if not link:
            print("kind 'posted' bat buoc co --link (URL bai da dang).", file=sys.stderr)
            sys.exit(2)
        ok, why = verify_live_link(link)
        if not ok:
            print(f"Link chua kiem chung live duoc ({why}) — KHONG day ket qua. "
                  f"Kiem tra lai link roi day lai.", file=sys.stderr)
            sys.exit(1)
        print(f"Link da kiem chung live (HTTP 200): {link}")
    body = {"action": "finish", "work_key": args.work_key,
            "result_kind": args.result_kind, "text": text}
    if link:
        body["link"] = link
    if args.seo is not None:
        body["seo"] = args.seo
    if args.words_done:
        body["words_done"] = args.words_done
    if args.note:
        body["note"] = args.note
    status, data = http_json(
        "POST", api_base() + "/api/luna/muse-work",
        headers={"X-Luna-Secret": api_secret()}, body=body,
    )
    if status != 200 or not data.get("ok"):
        print(f"Giao ket qua loi: {data.get('error', 'HTTP ' + str(status))}", file=sys.stderr)
        sys.exit(1)
    kind_label = "da dang live" if args.result_kind == "posted" else "tra noi dung/thiet ke"
    print(f"Da giao ban {data.get('version')} ({kind_label}) — trang thai: {data.get('status')} (cho anh duyet).")
    if data.get("link"):
        print(f"Link: {data.get('link')}")


def cmd_progress(args):
    if not 0 <= args.percent <= 99:
        print("percent phai la so nguyen 0-99 (100% chi dat khi giao ket qua).", file=sys.stderr)
        sys.exit(2)
    body = {"task_id": args.task_id, "progress": args.percent}
    if args.note:
        body["note"] = args.note
    status, data = http_json(
        "POST", api_base() + "/api/luna/progress",
        headers={"X-Luna-Secret": api_secret()}, body=body,
    )
    if status != 200 or not data.get("ok"):
        print(f"Day tien do loi: {data.get('error', 'HTTP ' + str(status))}", file=sys.stderr)
        sys.exit(1)
    print(f"Da cap nhat tien do {data.get('progress')}% cho nhiem vu {data.get('task_id')} (trang thai: {data.get('status')}).")


def main():
    ap = argparse.ArgumentParser(description="Cau noi Luna <-> App Dieu Khien AI (Yeu cau 28)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pending", help="Xem brief Design Web dang cho Luna")
    p.add_argument("--status", default="luna", choices=["luna", "review", "all"])
    p.add_argument("--all", action="store_true", help="In tat ca, ke ca brief da xem")
    p.set_defaults(fn=cmd_pending)
    ph = sub.add_parser("photos", help="Tai anh that cua khach cho mot nhiem vu")
    ph.add_argument("task_id")
    ph.add_argument("--out", default=None)
    ph.set_defaults(fn=cmd_photos)
    cr = sub.add_parser("creds", help="Lay tai khoan admin cua website trong nhiem vu web (Yeu cau 38)")
    cr.add_argument("task_id")
    cr.set_defaults(fn=cmd_creds)
    d = sub.add_parser("deliver", help="Tra file HTML (Design Web) hoac ket qua text (web/page) ve app")
    d.add_argument("task_id")
    d.add_argument("file", nargs="?", default=None, help="File HTML (Design Web). Bo qua khi dung --kind.")
    d.add_argument("--kind", default=None, choices=["posted", "content"], help="Ket qua text web/page: posted (da tu dang) | content (tra noi dung)")
    d.add_argument("--text-file", default=None, help="File text chua ket qua (dung kem --kind)")
    d.add_argument("--link", default="", help="URL bai da dang (dung kem --kind posted)")
    d.add_argument("--note", default="")
    d.set_defaults(fn=cmd_deliver)
    st = sub.add_parser("stats", help="So lieu thong ke theo du an (Yeu cau 31)")
    sts = st.add_subparsers(dest="stats_cmd", required=True)
    sp = sts.add_parser("push", help="Day ban tong ket 1 tuan cua 1 du an len app")
    sp.add_argument("--project", required=True, help="bluemax | binhminh | khanhnghi | inox")
    sp.add_argument("--kind", required=True, choices=["article", "page", "web"])
    sp.add_argument("--period", required=True, help="Tuan ISO, vd 2026-W47")
    sp.add_argument("--file", required=True, help="File stats.json (scheduled, posted, links?, details?)")
    sp.set_defaults(fn=cmd_stats_push)
    pr = sub.add_parser("push-result", help="Day viec tu Muse vao app (Yeu cau 43): start khi bat dau lam, finish khi xong")
    prs = pr.add_subparsers(dest="push_cmd", required=True)
    prs_st = prs.add_parser("start", help="Bat dau lam viec ben Muse -> nhiem vu 'luna' tren app (bang MCP thay luong)")
    prs_st.add_argument("--project", required=True, help="bluemax | binhminh | khanhnghi | inox | tranvu | nhatlinh")
    prs_st.add_argument("--kind", required=True, choices=["article", "design", "web"], help="article = bai viet | design = thiet ke hinh anh | web = Design Web")
    prs_st.add_argument("--work-key", required=True, help="Khoa chong trung, vd bluemax-2026-11-18-dap-ga-xe-i")
    prs_st.add_argument("--title", required=True, help="Tieu de bai / thiet ke (khong gom tien to 'Viet bai SEO')")
    prs_st.add_argument("--words", type=int, default=None, help="So tu mong muon (bai viet)")
    prs_st.add_argument("--keyword", default="", help="Tu khoa chinh (bai viet, tuy chon)")
    prs_st.add_argument("--note", default="")
    prs_st.set_defaults(fn=cmd_push_result)
    prs_fi = prs.add_parser("finish", help="Xong viec -> ket qua ve app (trang thai review, cho anh duyet)")
    prs_fi.add_argument("--work-key", required=True)
    prs_fi.add_argument("--result-kind", required=True, choices=["posted", "content"], help="posted (da dang live, bat buoc --link + kiem live) | content (tra noi dung/thiet ke)")
    prs_fi.add_argument("--text-file", required=True, help="File text chua bao cao ket qua")
    prs_fi.add_argument("--link", default="", help="URL bai da dang (posted) hoac link demo/thiet ke (content)")
    prs_fi.add_argument("--seo", type=int, default=None, help="Diem SEO dat duoc (0-100)")
    prs_fi.add_argument("--words-done", type=int, default=None, help="So tu thuc te da viet")
    prs_fi.add_argument("--note", default="")
    prs_fi.set_defaults(fn=cmd_push_result)
    pg = sub.add_parser("progress", help="Day phan tram tien do that cua nhiem vu dang lam (Yeu cau 43)")
    pg.add_argument("task_id")
    pg.add_argument("percent", type=int, help="So nguyen 0-99 (100 chi dat khi giao ket qua)")
    pg.add_argument("--note", default="", help="Ghi chu ngan ve tien do (vd 'da viet xong 1.549 tu, cho credential de dang')")
    pg.set_defaults(fn=cmd_progress)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
