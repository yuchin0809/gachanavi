"""
GachaNavi 初期データ収集の共通処理。

- 同じホストへのアクセスは最低 REQUEST_INTERVAL 秒あける（相手サーバーに負荷をかけない）
- robots.txt で禁止されているパスは取得しない
- 取得した HTML はキャッシュし、再実行時は再取得しない（COLLECT_CACHE_DIR）
- すべてのレコードに情報源 URL と取得日時（UTC, ISO 8601）を残す
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.robotparser
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "data" / "collected"
RAW_DIR = OUT_DIR / "raw"
CACHE_DIR = Path(os.environ.get("COLLECT_CACHE_DIR", ROOT / ".collect-cache"))
REQUEST_INTERVAL = float(os.environ.get("COLLECT_INTERVAL", "1.0"))
USER_AGENT = "Mozilla/5.0 (compatible; GachaNaviDataCollector/0.1; initial catalog build)"

_session = requests.Session()
_session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "ja,en;q=0.5"})
_last_access: dict[str, float] = {}
_host_locks: dict[str, threading.Lock] = {}
_robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
_global_lock = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def log(*args) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}]", *args, file=sys.stderr, flush=True)


def _host_lock(host: str) -> threading.Lock:
    with _global_lock:
        return _host_locks.setdefault(host, threading.Lock())


def _allowed(url: str) -> bool:
    p = urlparse(url)
    base = f"{p.scheme}://{p.netloc}"
    if base not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            r = _session.get(base + "/robots.txt", timeout=20)
            # robots.txt が無い（404）・HTML が返る場合は制限なしとして扱う
            if r.status_code == 200 and "html" not in r.headers.get("content-type", ""):
                rp.parse(r.text.splitlines())
            else:
                rp = None
        except requests.RequestException:
            rp = None
        _robots[base] = rp
    rp = _robots[base]
    return True if rp is None else rp.can_fetch(USER_AGENT, url)


def _cache_path(url: str) -> Path:
    h = hashlib.sha1(url.encode()).hexdigest()
    return CACHE_DIR / urlparse(url).netloc / h[:2] / f"{h}.json"


def fetch(url: str, *, use_cache: bool = True, retries: int = 3) -> tuple[str | None, str]:
    """(本文 or None, 取得日時) を返す。404 等は None。"""
    cp = _cache_path(url)
    if use_cache and cp.exists():
        d = json.loads(cp.read_text(encoding="utf-8"))
        return d["body"], d["fetchedAt"]
    if not _allowed(url):
        log("robots.txt により取得しません:", url)
        return None, now_iso()

    host = urlparse(url).netloc
    with _host_lock(host):
        for attempt in range(retries):
            wait = REQUEST_INTERVAL - (time.monotonic() - _last_access.get(host, 0))
            if wait > 0:
                time.sleep(wait)
            _last_access[host] = time.monotonic()
            try:
                r = _session.get(url, timeout=40)
            except requests.RequestException as e:
                log(f"通信エラー({attempt + 1}/{retries}):", url, e)
                time.sleep(3 * (attempt + 1))
                continue
            if r.status_code == 200:
                if not r.encoding or r.encoding.lower() == "iso-8859-1":
                    r.encoding = r.apparent_encoding
                body, fetched = r.text, now_iso()
                cp.parent.mkdir(parents=True, exist_ok=True)
                cp.write_text(json.dumps({"url": url, "fetchedAt": fetched, "body": body}, ensure_ascii=False), encoding="utf-8")
                return body, fetched
            if r.status_code in (404, 410):
                return None, now_iso()
            log(f"HTTP {r.status_code}({attempt + 1}/{retries}):", url)
            time.sleep(5 * (attempt + 1))
    return None, now_iso()


def abs_url(base: str, href: str | None) -> str | None:
    return urljoin(base, href) if href else None


def clean(text: str | None) -> str | None:
    if text is None:
        return None
    t = re.sub(r"[ \t　]+", " ", text)
    t = re.sub(r"\s*\n\s*", "\n", t).strip()
    return t or None


def parse_price(text: str | None) -> int | None:
    """「1回500円」「300円(税込)」などから金額を取り出す。複数・範囲の場合は None（推測しない）"""
    if not text:
        return None
    nums = re.findall(r"([0-9][0-9,]*)\s*円", text)
    nums = sorted({int(n.replace(",", "")) for n in nums})
    return nums[0] if len(nums) == 1 else None


def z2h(text: str) -> str:
    return text.translate(str.maketrans("０１２３４５６７８９", "0123456789"))


def parse_year_month(text: str | None) -> str | None:
    """「2026年9月 第1週」「2025年4月中旬」→ "2026-09" """
    if not text:
        return None
    m = re.search(r"(20\d{2})\s*年\s*(\d{1,2})\s*月", z2h(text))
    return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}" if m else None


def parse_full_date(text: str | None) -> str | None:
    """日付まで明記されている場合のみ "YYYY-MM-DD" を返す"""
    if not text:
        return None
    m = re.search(r"(20\d{2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})\s*日?(?!\s*週)", z2h(text))
    if not m:
        return None
    return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"


class JsonlWriter:
    """収集結果を 1 行 1 レコードで追記する（途中で止まっても続きから再開できる）"""

    def __init__(self, name: str):
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        self.path = RAW_DIR / f"{name}.jsonl"
        self.lock = threading.Lock()
        self.seen: set[str] = set()
        if self.path.exists():
            for line in self.path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    self.seen.add(json.loads(line)["sourceUrl"])

    def write(self, rec: dict) -> None:
        with self.lock:
            if rec["sourceUrl"] in self.seen:
                return
            self.seen.add(rec["sourceUrl"])
            with self.path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
