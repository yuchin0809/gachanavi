"""
Firestore 投入計画のドライラン（Firestore には接続しない・書き込まない）。

- 提案する ID 設計で ID を作り、衝突が無いか確認する
- 提案するドキュメント形式に変換し、サイズ・件数を見積もる
- Spark プランの書き込み上限（20,000 件/日）に収まる日別の投入計画を作る
出力: data/collected/validation/import_plan.json, firestore_doc_preview.json
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path
from urllib.parse import quote, unquote, urlparse, urlunparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate import SEVERITY, check_locations, check_products, latest_month, location_duplicates, release_status, resale_month  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "collected"
OUT = DATA / "validation"

DAILY_WRITE_LIMIT = 20_000      # Spark プラン：書き込み 20,000 件/日
DAILY_WRITE_BUDGET = 15_000     # 利用者の在庫報告・再試行のために 25% 残す
BATCH_SIZE = 400                # 1 バッチ最大 500 件。余裕を持って 400
ID_OK = re.compile(r"^[A-Za-z0-9_-]{1,120}$")

MAKER_SLUG = {"バンダイ": "bandai", "タカラトミーアーツ": "tta", "キタンクラブ": "kitan", "アイピーフォー": "ip4",
              "ブシロードクリエイティブ": "bushi", "Qualia": "qualia", "スタンド・ストーンズ": "stasto", "SO-TA": "sota",
              "トイズキャビン": "toyscabin", "トイズスピリッツ": "toysp", "Jドリーム": "jdream"}


def nfkc(s):
    return unicodedata.normalize("NFKC", s or "")


def short_hash(s: str) -> str:
    return hashlib.sha1(s.encode()).hexdigest()[:12]


def product_id(p: dict) -> tuple[str, str]:
    """公式の識別子から ID を作る（再収集しても変わらない）。(id, 由来)"""
    m = MAKER_SLUG[p["maker"]]
    u = p.get("officialUrl") or ""
    if p["maker"] == "バンダイ":
        jan = re.search(r"jan_code=(\d+)", u)
        if jan:
            return f"{m}-{jan.group(1)}", "JAN（gashapon.jp の jan_code）"
    if p.get("makerItemCode"):
        return f"{m}-{p['makerItemCode']}", "メーカー商品コード"
    if p["maker"] == "Jドリーム" and p.get("janCode"):
        return f"{m}-{p['janCode']}", "JAN"
    slug = unquote(urlparse(u).path).strip("/").split("/")[-1]
    slug = re.sub(r"\.(php|html?)$", "", slug)
    if ID_OK.match(f"{m}-{slug}") and slug:
        return f"{m}-{slug}", "公式URLのスラッグ"
    return f"{m}-h{short_hash(p['sourceUrl'])}", "公式URLのハッシュ（スラッグが日本語など）"


def location_id(l: dict) -> tuple[str, str]:
    srcs = l.get("sources", [])
    for s in srcs:
        if s.get("shopCode") and "gashapon.jp" in (s.get("url") or ""):
            return f"gp-{s['shopCode']}", "ガシャポン公式の店舗コード"
    for s in srcs:
        u = s.get("url") or ""
        m = re.search(r"bandainamco-am\.co\.jp/others/(gashapon-bandai-officialshop|capsule-toy-store)/store/([^/]+)/", u)
        if m:
            return f"bnam-{'gbo' if m.group(1).startswith('gashapon') else 'dept'}-{m.group(2)}", "バンダイナムコの店舗コード"
        m = re.search(r"gashacoco\.jp/shop-list/(\d+)", u)
        if m:
            return f"coco-{m.group(1)}", "gashacoco の店舗番号"
        m = re.search(r"dreamcapsule\.co\.jp/shop/(\d+)", u)
        if m:
            return f"dream-{m.group(1)}", "ドリームカプセルの店舗番号"
    # 公式の店舗番号が無いチェーン：正規化した住所 + 店舗名のハッシュ
    key = re.sub(r"\s+", "", nfkc(l["address"])) + "|" + re.sub(r"\s+", "", nfkc(l["name"]))
    return f"loc-h{short_hash(key)}", "住所＋店舗名のハッシュ"


def fix_url(u: str | None, *, placeholder_to_null=False) -> str | None:
    if not u:
        return None
    if placeholder_to_null and re.search(r"(noimage|no_image|now_printing)", u, re.I):
        return None
    pu = urlparse(u)
    if pu.scheme == "http":
        pu = pu._replace(scheme="https")  # 対象ホストは https で取得できることを確認済み
    path = quote(unquote(pu.path), safe="/%:@&=+$,;~-_.!*'()")
    return urlunparse(pu._replace(path=path))


def product_doc(p: dict) -> dict:
    tags = list(p.get("tags") or [])
    m = re.match(r"^\s*[【\[]([^】\]]+)[】\]]\s*", p["name"])
    if m:
        tags.append(m.group(1))
    if p.get("brand"):
        tags.append(p["brand"])
    return {
        # --- 既存の ProductDoc と同じ項目
        "name": re.sub(r"\s+", " ", nfkc(p["name"]).strip()) if False else re.sub(r"[ 　]+", " ", p["name"].strip()),
        "series": p.get("series") or "",
        "maker": p["maker"],
        "price": p.get("price"),                       # null あり → 型を number | null に
        "releaseMonth": p.get("releaseYearMonth") or "",
        "imageUrl": fix_url(p.get("imageUrl"), placeholder_to_null=True),
        "description": p.get("description") or "",
        "characters": [],
        "tags": sorted(set(t for t in tags if t)),
        # --- 追加する項目
        "latestMonth": latest_month(p) or "",           # 発売・再発売の新しい方（並び替え・現行判定用）
        "resaleMonth": resale_month(p.get("releaseText")),
        "releaseText": p.get("releaseText"),
        "priceText": p.get("priceText"),
        "priceTaxIncluded": p.get("priceTaxIncluded"),
        "lineupCount": p.get("lineupCount"),
        "janCode": p.get("janCode"),
        "officialUrl": fix_url(p.get("officialUrl")),
        "source": {"type": p.get("sourceType", "official"), "site": p.get("source"), "url": fix_url(p.get("sourceUrl")),
                   "fetchedAt": p.get("fetchedAt")},
        "isSample": False,
        "importBatch": "2026-09-initial",
    }


def location_doc(l: dict) -> dict:
    return {
        "name": re.sub(r"^[＃♯]", "#", re.sub(r"[ 　]+", " ", l["name"].strip())),
        "address": re.sub(r"\s+", " ", nfkc(l["address"])).strip(),
        "area": l.get("city") or l.get("prefecture") or "",   # 既存の area（表示用エリア名）
        "lat": l.get("lat"),                                   # null あり → 型を number | null に
        "lng": l.get("lng"),
        "openingHours": l.get("openingHours"),
        "prefecture": l.get("prefecture"),
        "city": l.get("city"),
        "chain": l.get("chain"),
        "operator": re.sub(r"\s+", " ", nfkc(l.get("operator") or "")).strip() or None,
        "phone": l.get("phone"),
        "postalCode": l.get("postalCode"),
        "coordinateSource": l.get("coordinateSource"),
        "coordinatePrecision": l.get("coordinatePrecision"),
        "statusNote": l.get("statusNote"),
        "officialUrl": l.get("officialUrl"),
        "sources": [{"name": s.get("name"), "url": s.get("url"), "fetchedAt": s.get("fetchedAt")} for s in l.get("sources", [])],
        "isSample": False,
        "importBatch": "2026-09-initial",
    }


def doc_size(doc_id: str, doc: dict) -> int:
    # Firestore のドキュメントサイズの概算（UTF-8 のフィールド名・値 + 32 バイト）
    return len(doc_id.encode()) + 16 + len(json.dumps(doc, ensure_ascii=False).encode()) + 32


def main():
    P = json.loads((DATA / "products.json").read_text(encoding="utf-8"))
    L = json.loads((DATA / "locations.json").read_text(encoding="utf-8"))
    E = json.loads((DATA / "excluded.json").read_text(encoding="utf-8"))
    pr, lr = check_products(P), check_locations(L, E)
    for g in location_duplicates(L):
        for i in g["ids"]:
            lr[i].add("fixable" if g.get("fixable") else "review", "duplicate_candidate", g["kind"])

    pids, lids = {}, {}
    pid_src, lid_src = Counter(), Counter()
    for p in P:
        i, s = product_id(p)
        pids.setdefault(i, []).append(p["id"])
        pid_src[s] += 1
    for l in L:
        i, s = location_id(l)
        lids.setdefault(i, []).append(l["id"])
        lid_src[s] += 1
    p_coll = {k: v for k, v in pids.items() if len(v) > 1}
    l_coll = {k: v for k, v in lids.items() if len(v) > 1}

    # 投入対象（除外推奨は投入しない。要確認は確認後に投入）
    p_ready = [p for p in P if pr[p["id"]].level in ("ok", "fixable")]
    l_ready = [l for l in L if lr[l["id"]].level in ("ok", "fixable") and l.get("lat") is not None]

    sizes = [doc_size(product_id(p)[0], product_doc(p)) for p in p_ready]
    lsizes = [doc_size(location_id(l)[0], location_doc(l)) for l in l_ready]

    # 優先度順：店舗 → 発売予定・現在の商品 → 過去の商品（新しい順）
    ordered = sorted(p_ready, key=lambda p: ({"upcoming": 0, "current": 1, "past": 2, "unknown": 3}[release_status(latest_month(p))],
                                            "" if not latest_month(p) else ("9999" if False else "") ,), )
    ordered = sorted(p_ready, key=lambda p: (
        {"upcoming": 0, "current": 1, "past": 2, "unknown": 3}[release_status(latest_month(p))],
        -(int((latest_month(p) or "0000-00").replace("-", "")))))
    queue = [("locations", len(l_ready))] + [("products", 1)] * 0
    days, remaining_p, day = [], len(ordered), 1
    loc_left = len(l_ready)
    idx = 0
    while loc_left or idx < len(ordered):
        budget = DAILY_WRITE_BUDGET
        n_loc = min(loc_left, budget)
        budget -= n_loc
        loc_left -= n_loc
        n_prod = min(len(ordered) - idx, budget)
        chunk = ordered[idx: idx + n_prod]
        idx += n_prod
        days.append({"day": day, "locations": n_loc, "products": n_prod,
                     "productsRange": f"{latest_month(chunk[0]) or '不明'} 〜 {latest_month(chunk[-1]) or '不明'}" if chunk else None,
                     "batches": -(-(n_loc + n_prod) // BATCH_SIZE)})
        day += 1

    plan = {
        "note": "ドライラン（Firestore には接続していない）",
        "ids": {
            "products": {"total": len(pids), "collisions": len(p_coll), "bySource": dict(pid_src),
                         "examples": [product_id(p)[0] for p in P[:3]]},
            "locations": {"total": len(lids), "collisions": len(l_coll), "collisionIds": l_coll, "bySource": dict(lid_src)},
        },
        "readyToImport": {
            "products": len(p_ready), "productsOnHold": len(P) - len(p_ready),
            "locations": len(l_ready), "locationsOnHold": len(L) - len(l_ready),
        },
        "docSizeBytes": {
            "productsAvg": round(sum(sizes) / len(sizes)), "productsMax": max(sizes),
            "productsTotalMB": round(sum(sizes) / 1e6, 1),
            "locationsAvg": round(sum(lsizes) / len(lsizes)), "locationsMax": max(lsizes),
        },
        "writes": {"total": len(p_ready) + len(l_ready), "dailyLimit": DAILY_WRITE_LIMIT, "dailyBudget": DAILY_WRITE_BUDGET,
                   "batchSize": BATCH_SIZE, "days": days},
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "import_plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
    preview = {
        "products": [{"id": product_id(p)[0], **product_doc(p)} for p in (P[0], next(x for x in P if x["maker"] == "トイズスピリッツ"),
                                                                       next(x for x in P if resale_month(x.get("releaseText"))))],
        "locations": [{"id": location_id(l)[0], **location_doc(l)} for l in (L[0], next(x for x in L if x.get("coordinatePrecision") == "block"))],
    }
    (OUT / "firestore_doc_preview.json").write_text(json.dumps(preview, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(plan, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
