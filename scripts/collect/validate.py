"""
Firestore 投入前のデータ検証（読み取り専用。Firestore には一切アクセスしない）。

入力: data/collected/{products,locations,excluded,report}.json
出力: data/collected/validation/
  summary.json            件数の集計
  products_issues.json    問題のある商品（分類・理由付き）
  locations_issues.json   問題のある店舗（分類・理由付き）
  duplicate_candidates.json 重複候補のグループ

分類（レコード単位では最も重いものを採用）:
  ok       問題なし
  fixable  修正可能（機械的に直せる。投入スクリプトの変換で対応）
  review   要確認（人の判断が必要）
  exclude  除外推奨（投入しない方がよい）
元データの削除・書き換えは行わない。
"""
from __future__ import annotations

import html
import json
import math
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "collected"
OUT = DATA / "validation"

# 判定の基準月（日本時間の「今月」）。引数 --month=YYYY-MM で変更可
TODAY_MONTH = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--month=")), None) or date.today().strftime("%Y-%m")
CURRENT_WINDOW_MONTHS = 6  # 発売から 6 か月以内を「現在の商品（店頭にある可能性が高い）」とみなす

SEVERITY = {"ok": 0, "fixable": 1, "review": 2, "exclude": 3}
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")  # src/app/actions/stockReports.ts と同じ

EXPECTED_HOSTS = {
    "バンダイ": {"gashapon.jp"},
    "タカラトミーアーツ": {"www.takaratomy-arts.co.jp"},
    "キタンクラブ": {"kitan.jp"},
    "アイピーフォー": {"www.ip4.co.jp"},
    "ブシロードクリエイティブ": {"capsule.bushiroad-creative.com"},
    "Qualia": {"www.qualia-45.jp"},
    "スタンド・ストーンズ": {"stasto.co.jp"},
    "SO-TA": {"www.so-ta.com"},
    "トイズキャビン": {"toyscabin.com"},
    "トイズスピリッツ": {"www.toysp.co.jp"},
    "Jドリーム": {"e-jdream.co.jp"},
}
JAPAN_BBOX = (20.0, 46.0, 122.0, 154.0)  # lat_min, lat_max, lng_min, lng_max
CLOSED_WORDS = re.compile(r"営業休止|休業|閉店|閉鎖|営業終了|一時休止|移転|リニューアル")
CANCEL_WORDS = re.compile(r"発売中止|販売中止|発売延期|販売延期")


def nfkc(s):
    return unicodedata.normalize("NFKC", s or "")


def norm_name(s):
    s = nfkc(s).lower()
    s = re.sub(r"^[【\[][^】\]]*[】\]]", "", s.strip())  # 先頭の【再販】などは比較から外す
    return re.sub(r"[\s・･\-‐ー―~〜～!！?？「」『』【】()（）\[\]＜＞<>\"'’“”.,、。:：/／#＃♯&＆]", "", s)


def ym_add(ym: str, months: int) -> str:
    y, m = map(int, ym.split("-"))
    t = y * 12 + (m - 1) + months
    return f"{t // 12:04d}-{t % 12 + 1:02d}"


def haversine(a, b):
    (la1, lo1), (la2, lo2) = a, b
    p1, p2 = math.radians(la1), math.radians(la2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


class Issues:
    def __init__(self):
        self.items: list[tuple[str, str, str]] = []  # (severity, code, detail)

    def add(self, sev: str, code: str, detail: str = ""):
        self.items.append((sev, code, detail))

    @property
    def level(self) -> str:
        return max((s for s, _, _ in self.items), key=SEVERITY.get, default="ok")

    def as_list(self):
        return [{"severity": s, "code": c, "detail": d} for s, c, d in self.items]


# ================================================================ 商品
def resale_month(text: str | None) -> str | None:
    """「2026年9月28日週再発売」「再販 2026年9月」など、再発売の年月（最も新しいもの）"""
    t = nfkc(text or "")
    ms = re.findall(r"(20\d{2})年(\d{1,2})月(?:\d{1,2}日週)?(?:再発売|再販|再出荷)", t)
    return max((f"{int(y):04d}-{int(m):02d}" for y, m in ms), default=None)


def latest_month(p: dict) -> str | None:
    """発売状況の判定に使う年月：発売年月と再発売年月の新しい方"""
    return max(filter(None, [p.get("releaseYearMonth"), resale_month(p.get("releaseText"))]), default=None)


def release_status(ym: str | None) -> str:
    if not ym:
        return "unknown"
    if ym > TODAY_MONTH:
        return "upcoming"      # 発売予定
    if ym >= ym_add(TODAY_MONTH, -(CURRENT_WINDOW_MONTHS - 1)):
        return "current"       # 現在の商品（発売から 6 か月以内）
    return "past"              # 過去の商品


def check_products(P: list[dict]):
    results = {}
    image_users = defaultdict(list)
    for p in P:
        if p.get("imageUrl"):
            image_users[p["imageUrl"]].append(p["id"])

    for p in P:
        iss = Issues()
        name = p.get("name") or ""
        # ---- 必須項目
        for k in ("id", "name", "maker", "sourceUrl", "officialUrl", "fetchedAt"):
            if not p.get(k):
                iss.add("exclude" if k in ("id", "name", "maker", "sourceUrl") else "review", f"missing_{k}", f"{k} が空")
        # ---- 商品名
        if name != name.strip() or re.search(r"[\n\t]| {2,}|　{2,}", name):
            iss.add("fixable", "name_whitespace", "前後の空白・改行・連続空白")
        if re.search(r"&(amp|lt|gt|quot|#\d+|#x[0-9a-f]+);", name, re.I):
            iss.add("fixable", "name_html_entity", "HTML 実体参照が残っている")
        if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f�]", name):
            iss.add("review", "name_control_char", "制御文字・文字化け")
        if len(name) > 100:
            iss.add("review", "name_too_long", f"{len(name)} 文字")
        if 0 < len(nfkc(name).strip()) < 2:
            iss.add("ok", "name_short", f"1 文字の商品名（公式表記どおり）: {name}")
        if re.search(r"[0-9０-９,，]+\s*円\s*$", name):
            iss.add("fixable", "name_contains_price", "商品名の末尾に価格")
        if re.search(r"(\.\.\.)$", name):
            iss.add("review", "name_truncated", "末尾が ... （一覧での省略の可能性）")
        m = re.match(r"^\s*[【\[]([^】\]]+)[】\]]", name)
        if m:
            iss.add("fixable", "name_prefix_label", f"先頭の区分【{m.group(1)}】（タグに移すと検索・表示が整う）")
        # ---- 価格
        price, pt = p.get("price"), p.get("priceText") or ""
        if price is None:
            iss.add("review", "price_missing", pt or "価格の記載なし（アプリは 0 円と表示してしまう）")
        else:
            if price < 100 or price > 3000:
                iss.add("review", "price_outlier", f"{price} 円（{pt}）")
            elif price > 1500:
                iss.add("ok", "price_high", f"{price} 円（プレミアム系）")
            if price % 10 != 0 and p.get("priceTaxIncluded") is not False:
                iss.add("review", "price_not_round", f"{price} 円（{pt}）")
        if p.get("priceTaxIncluded") is False:
            iss.add("ok", "price_tax_excluded", f"税抜表記（{pt}）。表示時に「税抜」と併記する")
        if re.search(r"各|〜|～|-\d|／|/|または|or", pt) and price is not None:
            iss.add("review", "price_multiple", pt)
        # ---- 発売時期
        ym, rd, rt = p.get("releaseYearMonth"), p.get("releaseDate"), p.get("releaseText") or ""
        if not ym:
            iss.add("review", "release_missing", rt or "発売時期の記載なし")
        elif not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", ym) or not ("2000-01" <= ym <= "2027-12"):
            iss.add("review", "release_out_of_range", ym)
        if rd and ym and not rd.startswith(ym):
            # 「2026年9月28日週再発売」の日付を発売日として取り込んでいた（収集時の解析誤り）→ releaseDate を null にする
            iss.add("fixable", "release_date_wrong", f"releaseDate {rd} は再発売・再掲の日付（発売年月 {ym}）")
        resale = resale_month(rt)
        if resale:
            iss.add("ok", "resale", f"再発売 {resale}")
        if CANCEL_WORDS.search(rt) or CANCEL_WORDS.search(name):
            iss.add("exclude" if "中止" in rt + name else "review", "release_cancelled_or_delayed", rt)
        # ---- URL
        for k in ("officialUrl", "sourceUrl"):
            u = p.get(k) or ""
            pu = urlparse(u)
            if u and (pu.scheme not in ("http", "https") or not pu.netloc):
                iss.add("review", f"{k}_invalid", u)
            elif u and pu.scheme == "http":
                iss.add("fixable", f"{k}_http", "http → https に置き換え可（https で取得できることを確認済み）")
            if u and pu.netloc not in EXPECTED_HOSTS.get(p.get("maker"), {pu.netloc}):
                iss.add("review", f"{k}_host_mismatch", f"{p.get('maker')} なのに {pu.netloc}")
        if (p.get("sourceUrl") or "").find("#") >= 0:
            iss.add("ok", "source_is_list_page", "個別ページが無く一覧ページ + 識別子")
        # ---- 画像
        img = p.get("imageUrl") or ""
        if not img:
            iss.add("review", "image_missing", "画像なし（プレースホルダー表示になる）")
        else:
            pu = urlparse(img)
            if pu.scheme not in ("http", "https") or not pu.netloc:
                iss.add("review", "image_invalid", img)
            elif pu.scheme == "http":
                iss.add("fixable", "image_http", "http 画像（https ページで混在コンテンツになる）")
            if re.search(r"[^\x21-\x7e]", img):  # next/image・ブラウザでは動くが、保存前にエンコードしておく
                iss.add("fixable", "image_unencoded", "URL に日本語・空白が未エンコードで含まれる")
            if re.search(r"(noimage|no_image|now_printing|dummy|/ogp\.jpg|favicon|spacer\.gif)", img, re.I):
                iss.add("fixable", "image_placeholder", f"仮画像（imageUrl を null にする）: {img}")
            if not re.search(r"\.(jpe?g|png|gif|webp|avif)(\?|$)", img, re.I):
                iss.add("review", "image_no_extension", "拡張子が画像でない")
            if len(image_users[img]) >= 3:
                iss.add("review", "image_shared", f"同じ画像を {len(image_users[img])} 商品で使用")
        # ---- ID
        if not ID_PATTERN.match(p.get("id") or ""):
            iss.add("exclude", "id_invalid", p.get("id"))
        results[p["id"]] = iss
    return results


def product_duplicates(P):
    groups = []
    by_maker_name = defaultdict(list)
    by_name = defaultdict(list)
    for p in P:
        by_maker_name[(p["maker"], norm_name(p["name"]))].append(p)
        by_name[norm_name(p["name"])].append(p)
    for (maker, n), ps in by_maker_name.items():
        if len(ps) > 1 and n:
            yms = sorted({x.get("releaseYearMonth") or "?" for x in ps})
            kind = "同一メーカー・同名（再販・再掲載の可能性）" if len(yms) > 1 else "同一メーカー・同名・同発売月"
            groups.append({"kind": kind, "maker": maker, "name": ps[0]["name"], "releaseYearMonths": yms,
                           "ids": [x["id"] for x in ps], "urls": [x["officialUrl"] for x in ps]})
    for n, ps in by_name.items():
        makers = {x["maker"] for x in ps}
        if len(makers) > 1 and len(n) >= 6:
            groups.append({"kind": "別メーカー・同名", "name": ps[0]["name"], "makers": sorted(makers),
                           "ids": [x["id"] for x in ps], "urls": [x["officialUrl"] for x in ps]})
    return groups


# ================================================================ 店舗
def check_locations(L, E=None):
    results = {}
    # 統合で消えた側のレコードに「(営業休止中)」などの記載があった店舗（build.py が statusNote を引き継いでいない）
    merged_notes = defaultdict(list)
    for e in E or []:
        if e.get("kind") == "location" and e.get("mergedInto") and CLOSED_WORDS.search(e.get("name") or ""):
            merged_notes[e["mergedInto"]].append(e["name"])
    # 都道府県ごとの座標の中央値（大きく外れる店舗の検出用）
    pref_pts = defaultdict(list)
    for l in L:
        if l.get("lat") is not None and l.get("prefecture"):
            pref_pts[l["prefecture"]].append((l["lat"], l["lng"]))
    pref_center = {k: (sorted(a for a, _ in v)[len(v) // 2], sorted(b for _, b in v)[len(v) // 2]) for k, v in pref_pts.items()}

    for l in L:
        iss = Issues()
        name = l.get("name") or ""
        for k in ("id", "name", "address"):
            if not l.get(k):
                iss.add("exclude", f"missing_{k}", "")
        addr = l.get("address") or ""
        if re.search(r"[\n\t]|[\uff61-\uff9f]| {2,}", addr) or addr != addr.strip():
            iss.add("fixable", "address_notation", "住所に改行・半角カナ・連続空白（NFKC 正規化で整える）")
        if not l.get("prefecture"):
            iss.add("fixable", "missing_prefecture", l.get("address"))
        if not l.get("city"):
            iss.add("fixable", "missing_city", l.get("address"))
        # ---- 座標
        lat, lng = l.get("lat"), l.get("lng")
        if lat is None or lng is None:
            iss.add("review", "coords_missing", "座標なし（アプリは 0,0 として扱い距離がおかしくなる）")
        else:
            if not (JAPAN_BBOX[0] <= lat <= JAPAN_BBOX[1] and JAPAN_BBOX[2] <= lng <= JAPAN_BBOX[3]):
                iss.add("exclude", "coords_outside_japan", f"{lat},{lng}")
            c = pref_center.get(l.get("prefecture"))
            limit = 450_000 if l.get("prefecture") == "北海道" else 180_000
            if c and haversine((lat, lng), c) > limit:
                iss.add("review", "coords_far_from_prefecture", f"{l.get('prefecture')} の中心から {haversine((lat, lng), c) / 1000:.0f} km")
            if l.get("coordinatePrecision") in ("street", "block"):
                iss.add("ok", "coords_geocoded", f"住所から算出（{l['coordinatePrecision']}）")
            d = l.get("mapEmbedDistanceM")
            if d is not None and d > 1000:
                iss.add("review", "coords_conflict_with_official_map", f"公式ページの地図と {d} m 差")
        # ---- 営業状況
        if l.get("statusNote") or CLOSED_WORDS.search(name):
            iss.add("review", "closed_or_suspended", l.get("statusNote") or name)
        if merged_notes.get(name):
            iss.add("review", "closed_or_suspended", f"統合元の情報源に記載: {merged_notes[name]}")
        # ---- 情報源の信頼度・鮮度
        src_names = [s.get("name") or "" for s in l.get("sources", [])]
        if all("トイズキャビン" in s for s in src_names):
            iss.add("review", "maker_list_only", "メーカーの取扱店舗一覧のみ（営業時間・電話なし、最新性未確認）")
        mods = [s.get("lastModified") for s in l.get("sources", []) if s.get("lastModified")]
        if mods and max(mods) < "2024-01-01" and len(src_names) == 1:
            iss.add("ok", "old_source_update", f"情報源の店舗情報の最終更新 {max(mods)[:10]}（公式検索には現在も掲載）")
        # ---- 表記
        if name.strip() in ("店舗情報", "店舗一覧", "TOP", "ホーム", "店舗詳細"):
            iss.add("fixable", "name_parse_error", f"店舗名がページ見出しの「{name}」になっている（収集時の解析誤り。公式ページの店名で置き換える）")
        if re.match(r"^[＃♯]", name) or re.search(r" {2,}|　", name) or name != name.strip():
            iss.add("fixable", "name_notation", "＃・♯・全角空白・連続空白の表記ゆれ")
        if (l.get("operator") or "") != re.sub(r"\s+", " ", nfkc(l.get("operator") or "")).strip():
            iss.add("fixable", "operator_notation", l.get("operator"))
        if not l.get("openingHours"):
            iss.add("ok", "hours_missing", "営業時間なし（null で投入可）")
        if not ID_PATTERN.match(l.get("id") or ""):
            iss.add("exclude", "id_invalid", l.get("id"))
        results[l["id"]] = iss
    return results


def location_duplicates(L):
    from difflib import SequenceMatcher
    from build import DIFF_WORDS, brands_of, name_core
    groups = []
    pts = [l for l in L if l.get("lat") is not None]
    # 50m 以内の店舗の組（同じ施設内の別店舗も含まれるため「候補」）
    cell = defaultdict(list)
    for l in pts:
        cell[(round(l["lat"], 3), round(l["lng"], 3))].append(l)
    seen = set()
    for l in pts:
        la, lo = round(l["lat"], 3), round(l["lng"], 3)
        for dla in (-0.001, 0, 0.001):
            for dlo in (-0.001, 0, 0.001):
                for o in cell.get((round(la + dla, 3), round(lo + dlo, 3)), []):
                    if o["id"] <= l["id"] or (l["id"], o["id"]) in seen:
                        continue
                    d = haversine((l["lat"], l["lng"]), (o["lat"], o["lng"]))
                    if d > 50:
                        continue
                    seen.add((l["id"], o["id"]))
                    sim = SequenceMatcher(None, norm_name(l["name"]), norm_name(o["name"])).ratio()
                    same_chain = l.get("chain") and l.get("chain") == o.get("chain")
                    ba, bb = brands_of(l["name"]), brands_of(o["name"])
                    if ba and bb and not (ba & bb):
                        continue  # 同じ施設内の別チェーン
                    if sorted(re.findall(DIFF_WORDS, name_core(l["name"]))) != sorted(re.findall(DIFF_WORDS, name_core(o["name"]))):
                        continue  # 2号店・2nd・Branche など、同じ施設内の別店舗
                    ca, cb = name_core(l["name"]), name_core(o["name"])
                    contained = bool(ca and cb and (ca in cb or cb in ca))
                    if (same_chain and (sim >= 0.6 or contained)) or sim >= 0.8 or contained:
                        groups.append({"kind": "近接（50m以内）" + ("・同チェーン" if same_chain else "・名前が類似"),
                                       "distanceM": round(d), "nameSimilarity": round(sim, 2),
                                       "ids": [l["id"], o["id"]], "names": [l["name"], o["name"]],
                                       "addresses": [l["address"], o["address"]]})
    by_url = defaultdict(list)
    for l in L:
        # 一覧ページ（全店舗が同じ URL）は除き、店舗ごとの個別ページだけで比べる
        for u in {s.get("url") for s in l.get("sources", []) if s.get("url") and s.get("url") != s.get("listUrl") and "#" not in s.get("url")}:
            by_url[u].append(l)
    for u, ls in by_url.items():
        if len(ls) > 1:
            groups.append({"kind": "同じ公式ページを情報源に持つ（統合推奨）", "fixable": True, "url": u,
                           "ids": [x["id"] for x in ls], "names": [x["name"] for x in ls], "addresses": [x["address"] for x in ls]})
    by_full_addr = defaultdict(list)
    for l in L:
        a = re.sub(r"\s+", "", nfkc(l.get("address")))
        if re.search(r"(区画|号室)", a):  # 区画・部屋番号まで書かれている住所だけで比べる（同じ階の隣接店舗は別店舗）
            by_full_addr[a].append(l)
    for a, ls in by_full_addr.items():
        if len(ls) > 1 and len({frozenset(brands_of(x["name"])) for x in ls}) > 1:
            groups.append({"kind": "同一区画に別ブランド（改装・ブランド変更の可能性）",
                           "ids": [x["id"] for x in ls], "names": [x["name"] for x in ls], "addresses": [x["address"] for x in ls]})
    by_name = defaultdict(list)
    for l in L:
        by_name[norm_name(l["name"])].append(l)
    for n, ls in by_name.items():
        if len(ls) > 1 and n not in ("店舗情報",):
            same_city = len({(x.get("prefecture"), x.get("city")) for x in ls}) == 1
            groups.append({"kind": "同名・同じ市区町村（統合推奨）" if same_city else "同名・別の市区町村",
                           "fixable": same_city, "ids": [x["id"] for x in ls], "names": [x["name"] for x in ls],
                           "addresses": [x["address"] for x in ls]})
    return groups


# ================================================================ 整合性
def reconcile(P, L, E, R):
    out = {}
    out["report_products_total_matches"] = R["products"]["total"] == len(P)
    out["report_locations_total_matches"] = R["locations"]["total"] == len(L)
    out["product_ids_unique"] = len({p["id"] for p in P}) == len(P)
    out["location_ids_unique"] = len({l["id"] for l in L}) == len(L)
    out["product_source_urls_unique"] = len({p["sourceUrl"] for p in P}) == len(P)
    kept_urls = {p["sourceUrl"] for p in P}
    ex_urls = [e.get("sourceUrl") for e in E if e.get("kind") == "product"]
    out["excluded_products_not_in_products"] = not any(u in kept_urls for u in ex_urls if "重複" not in "")
    out["excluded_reason_counts"] = dict(Counter(e["reason"] for e in E))
    # モックデータの ID（p-001 / l-001 形式）との衝突
    out["collides_with_mock_ids"] = any(re.fullmatch(r"[pl]-\d{3}", x["id"]) for x in P + L)
    return out


def main():
    P = json.loads((DATA / "products.json").read_text(encoding="utf-8"))
    L = json.loads((DATA / "locations.json").read_text(encoding="utf-8"))
    E = json.loads((DATA / "excluded.json").read_text(encoding="utf-8"))
    R = json.loads((DATA / "report.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)

    pr = check_products(P)
    lr = check_locations(L, E)
    pdup = product_duplicates(P)
    ldup = location_duplicates(L)
    pdup_ids = {i for g in pdup for i in g["ids"]}
    ldup_ids = {i for g in ldup for i in g["ids"]}
    for g in pdup:
        for i in g["ids"]:
            pr[i].add("review", "duplicate_candidate", g["kind"])
    for g in ldup:
        for i in g["ids"]:
            lr[i].add("fixable" if g.get("fixable") else "review", "duplicate_candidate", g["kind"])

    def summarize(res):
        levels = Counter(v.level for v in res.values())
        codes = Counter()
        code_sev = {}
        for v in res.values():
            for s, c, _ in v.items:
                codes[c] += 1
                code_sev[c] = s
        return {"byLevel": {k: levels.get(k, 0) for k in SEVERITY},
                "byIssue": {c: {"count": n, "severity": code_sev[c]} for c, n in codes.most_common()}}

    status = Counter(release_status(latest_month(p)) for p in P)
    status_by_maker = defaultdict(Counter)
    status_by_year = defaultdict(Counter)
    for p in P:
        st = release_status(latest_month(p))
        status_by_maker[p["maker"]][st] += 1
        status_by_year[(latest_month(p) or "不明")[:4]][st] += 1

    summary = {
        "baseMonth": TODAY_MONTH,
        "currentWindowMonths": CURRENT_WINDOW_MONTHS,
        "products": {"total": len(P), **summarize(pr), "duplicateCandidateGroups": len(pdup),
                     "duplicateCandidateRecords": len(pdup_ids),
                     "releaseStatus": dict(status),
                     "releaseStatusByYear": {k: dict(v) for k, v in sorted(status_by_year.items(), reverse=True)},
                     "resaleCount": sum(1 for p in P if resale_month(p.get("releaseText"))),
                     "releaseStatusByMaker": {k: dict(v) for k, v in status_by_maker.items()},
                     "makers": dict(Counter(p["maker"] for p in P)),
                     "sellersDifferentFromMaker": dict(Counter(p.get("seller") for p in P if p.get("seller") and
                                                                 nfkc(p["maker"]).replace(" ", "") not in nfkc(p["seller"]).replace(" ", "")))},
        "locations": {"total": len(L), **summarize(lr), "duplicateCandidateGroups": len(ldup),
                      "duplicateCandidateRecords": len(ldup_ids),
                      "coordinatePrecision": dict(Counter(l.get("coordinatePrecision") or "none" for l in L)),
                      "operators": dict(Counter(l.get("operator") for l in L).most_common(30))},
        "reconcile": reconcile(P, L, E, R),
    }

    def dump_issues(res, rows, fields):
        out = []
        for r in rows:
            v = res[r["id"]]
            if v.level == "ok":
                continue
            out.append({"id": r["id"], "level": v.level, **{f: r.get(f) for f in fields},
                        "issues": [i for i in v.as_list() if i["severity"] != "ok"]})
        return sorted(out, key=lambda x: -SEVERITY[x["level"]])

    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "products_issues.json").write_text(json.dumps(
        dump_issues(pr, P, ["name", "maker", "releaseYearMonth", "price", "priceText", "officialUrl"]), ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "locations_issues.json").write_text(json.dumps(
        dump_issues(lr, L, ["name", "chain", "address", "prefecture", "lat", "lng", "coordinatePrecision", "statusNote"]), ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "duplicate_candidates.json").write_text(json.dumps({"products": pdup, "locations": ldup}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: summary[k] if k in ("baseMonth", "currentWindowMonths", "reconcile") else {kk: vv for kk, vv in summary[k].items() if kk in ("total", "byLevel", "duplicateCandidateGroups", "duplicateCandidateRecords", "releaseStatus")} for k in summary}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
