"""
収集した生データ（data/collected/raw/*.jsonl）を統合し、検証・重複排除して中間データを作る。

出力（data/collected/）:
  products.json   ガチャ商品
  locations.json  ガチャ店舗・設置スポット
  excluded.json   除外したレコードと理由（重複・情報不足・対象外）
  report.json     件数の集計

座標について（推測はしない）:
  1. 公式データの座標（ガシャポン公式の店舗検索・公式サイトの地図マーカー）があればそれを使う
  2. 無い場合は、国土地理院「住所検索 API」で住所から座標を求める（coordinateSource で区別）
     一致した住所が番地・号まで届かない場合は精度を "town"（町・丁目レベル）として記録する
  3. どちらも得られない場合は lat/lng を null のままにする
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import requests

from common import OUT_DIR, RAW_DIR, USER_AGENT, log, now_iso

GSI = "https://msearch.gsi.go.jp/address-search/AddressSearch"
GEOCODE_CACHE = OUT_DIR / "cache" / "gsi_geocode.json"

MAKER_SLUG = {
    "バンダイ": "bandai", "タカラトミーアーツ": "takaratomy-arts", "キタンクラブ": "kitan", "SO-TA": "so-ta",
    "トイズスピリッツ": "toys-spirits", "ブシロードクリエイティブ": "bushiroad-creative",
    "スタンド・ストーンズ": "stand-stones", "Qualia": "qualia",
}
PREF_RE = re.compile(r"^(北海道|東京都|京都府|大阪府|[^\s]{2,3}県)")
DESIGNATED_CITIES = ("札幌市", "仙台市", "さいたま市", "千葉市", "横浜市", "川崎市", "相模原市", "新潟市", "静岡市", "浜松市",
                     "名古屋市", "京都市", "大阪市", "堺市", "神戸市", "岡山市", "広島市", "北九州市", "福岡市", "熊本市")
SPECIAL_CITIES = ("四日市市", "廿日市市", "野々市市", "市川市", "市原市", "大町市", "町田市", "十日町市", "村山市", "東村山市",
                  "武蔵村山市", "羽村市", "田村市", "大村市", "村上市", "玉村町")
CITY_RE = re.compile(r"^([^\s]+?郡[^\s]+?[町村]|[^\s]+?市|[^\s]+?区|[^\s]+?[町村])")


# ---------------------------------------------------------------- 共通
def load(pattern: str) -> list[dict]:
    """raw/*.jsonl（無ければ圧縮版 raw/*.jsonl.gz）を読む"""
    import gzip
    rows = []
    paths = {p.name: p for p in RAW_DIR.glob(pattern + ".gz")}
    paths.update({p.name + ".gz": p for p in RAW_DIR.glob(pattern)})
    for _, p in sorted(paths.items()):
        text = gzip.decompress(p.read_bytes()).decode("utf-8") if p.suffix == ".gz" else p.read_text(encoding="utf-8")
        for line in text.splitlines():
            if line.strip():
                rows.append(json.loads(line))
    return rows


def nfkc(s: str | None) -> str:
    return unicodedata.normalize("NFKC", s or "")


def norm_name(s: str | None) -> str:
    s = nfkc(s).lower()
    s = re.sub(r"[\s・･\-‐ー―~〜～!！?？「」『』【】()（）\[\]＜＞<>\"'’“”.,、。:：/／#＃♯&＆]", "", s)
    return s


def stable_id(prefix: str, key: str) -> str:
    return f"{prefix}-{hashlib.sha1(key.encode()).hexdigest()[:10]}"


def filled(rec: dict) -> int:
    return sum(1 for v in rec.values() if v not in (None, "", [], {}))


# ---------------------------------------------------------------- 商品
# 商品名の先頭に公式が付けている区分のうち、カプセル自販機での販売ではないもの
OUT_OF_SCOPE_PREFIX = r"^\s*[【\[](箱売|物販商品|店頭販売商品|BOX限定商品|BOX限定カラー|ガシャポンボックス|ジャンボカードダス)[】\]]"


def lineup_from_text(text: str | None) -> str | None:
    """公式の説明文に「全○種」とある場合はそれを種類数とする（説明文に無ければ null）"""
    m = re.search(r"全\s*([0-9０-９]+)\s*種", text or "")
    return f"全{nfkc(m.group(1))}種" if m else None


def build_products() -> tuple[list[dict], list[dict], dict]:
    raw = load("products_*.jsonl")
    log(f"商品（生データ）: {len(raw)} 件")
    excluded: list[dict] = []
    stats = Counter()
    # 収集段階で詳細を取得できなかった商品（年齢確認ページなど）
    for s in load("skipped_*.jsonl"):
        excluded.append(s)
        stats["excluded_insufficient"] += 1

    ok = []
    for r in raw:
        name = (r.get("name") or "").strip()
        reason = None
        if not name:
            reason = "商品名が取得できない"
        elif not r.get("sourceUrl"):
            reason = "情報源URLがない"
        elif re.match(OUT_OF_SCOPE_PREFIX, nfkc(name)):
            reason = "対象外（箱売り・物販・店頭販売など、ガチャの筐体で販売される商品ではない）"
        elif r.get("price") == 0:
            reason = "対象外（価格0円の景品・非売品）"
        elif not r.get("price") and not r.get("releaseYearMonth"):
            reason = "価格・発売時期のどちらも確認できない"
        if reason:
            stats["excluded_insufficient" if "対象外" not in reason else "excluded_out_of_scope"] += 1
            excluded.append({"kind": "product", "reason": reason, "name": name or None, "sourceUrl": r.get("sourceUrl")})
            continue
        ok.append(r)

    # 重複排除：① JAN コードが同じ ② 同じメーカー・同じ商品名・同じ発売年月
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in ok:
        jan = re.sub(r"\D", "", r.get("janCode") or "")
        jan13 = jan[:13] if len(jan) >= 13 else jan
        key = f"jan:{jan13}" if len(jan13) in (8, 13) else f"nm:{r['maker']}|{norm_name(r['name'])}|{r.get('releaseYearMonth') or r.get('priceText')}"
        groups[key].append(r)

    products = []
    for key, rs in groups.items():
        rs.sort(key=filled, reverse=True)
        best = dict(rs[0])
        if len(rs) > 1:
            stats["duplicates_removed"] += len(rs) - 1
            for d in rs[1:]:
                excluded.append({"kind": "product", "reason": "重複（" + ("JANコード一致" if key.startswith("jan:") else "同じメーカー・商品名・発売時期") + "）",
                                 "name": d["name"], "sourceUrl": d["sourceUrl"], "keptSourceUrl": best["sourceUrl"]})
            best["alsoListedAt"] = sorted({d["sourceUrl"] for d in rs[1:]})
        products.append(best)

    out = []
    for r in products:
        maker = r["maker"]
        imgs = r.get("imageUrls") or []
        out.append({
            "id": stable_id(MAKER_SLUG.get(maker, "maker"), r["sourceUrl"]),
            "name": r["name"],
            "maker": maker,
            "brand": r.get("brand"),
            "series": r.get("series"),
            "tags": r.get("tags") or [],
            "janCode": r.get("janCode"),
            "makerItemCode": r.get("makerItemCode"),
            "releaseDate": r.get("releaseDate"),
            "releaseYearMonth": r.get("releaseYearMonth"),
            "releaseText": (r.get("releaseText") or "").replace("\n", " ") or None,
            "price": r.get("price"),
            "priceText": (r.get("priceText") or "").replace("\n", " ") or None,
            "priceTaxIncluded": False if re.search(r"税抜|本体価格", r.get("priceText") or "") else r.get("priceTaxIncluded"),
            "lineupCount": r.get("lineupCount") or lineup_from_text(r.get("description")),
            "size": r.get("size"),
            "targetAge": r.get("targetAge"),
            "description": r.get("description"),
            "catchCopy": r.get("catchCopy"),
            "officialUrl": r.get("officialUrl"),
            "imageUrl": r.get("imageUrl"),
            "imageUrls": imgs[:12],
            "sourceType": r.get("sourceType", "official"),
            "source": r.get("source"),
            "sourceUrl": r["sourceUrl"],
            "alsoListedAt": r.get("alsoListedAt", []),
            "fetchedAt": r.get("fetchedAt"),
        })
    out.sort(key=lambda x: (x["releaseYearMonth"] or "0000-00", x["maker"], x["name"]), reverse=True)
    stats["products"] = len(out)
    return out, excluded, dict(stats)


# ---------------------------------------------------------------- 店舗
def norm_phone(p: str | None) -> str | None:
    d = re.sub(r"\D", "", nfkc(p))
    return d if len(d) >= 10 else None


KANJI_NUM = str.maketrans("〇一二三四五六七八九", "0123456789")


def norm_addr(a: str | None) -> str:
    s = nfkc(a).replace(" ", "")
    s = re.sub(r"[‐‑‒–—―ｰ−ー-]", "-", s)
    s = re.sub(r"([一二三四五六七八九十]+)(丁目|条|番)", lambda m: kanji_to_int(m.group(1)) + m.group(2), s)
    s = re.sub(r"(\d+)丁目", r"\1-", s)
    s = re.sub(r"(\d+)番地?", r"\1-", s)
    s = re.sub(r"(\d+)号", r"\1", s)
    s = re.sub(r"-+", "-", s)
    return s


def kanji_to_int(k: str) -> str:
    if "十" in k:
        a, _, b = k.partition("十")
        return str((int(a.translate(KANJI_NUM)) if a else 1) * 10 + (int(b.translate(KANJI_NUM)) if b else 0))
    return k.translate(KANJI_NUM)


def addr_core(a: str | None) -> str:
    """建物名・階数を除いた「都道府県〜番地」部分（比較・住所検索用）"""
    raw = nfkc(a).strip()
    # 建物名は多くの場合スペースの後に書かれている（スペースより前に番地の数字がある場合のみ切る）
    head, sep, _ = raw.partition(" ")
    if sep and re.search(r"\d", head):
        raw = head
    s = norm_addr(raw)
    s = re.sub(r"(B?\d+F|\d+階|地下\d+階)", "", s).replace("-の", "-")
    # 「丁目-番地-号」の数字の並びまで（その後ろの建物名などは含めない）
    m = re.match(r"^(.*?\d+(?:-\d+)+|.*?\d+)", s)
    return (m.group(1) if m else s).rstrip("-")


def addr_key(a: str | None) -> str:
    """重複判定用の住所キー（都道府県を省略した表記とも一致させるため、都道府県を除く）"""
    core = addr_core(a)
    return PREF_RE.sub("", core, count=1)


def split_region(addr: str | None) -> tuple[str | None, str | None]:
    a = nfkc(addr).strip()
    m = PREF_RE.match(a)
    if not m:
        return None, None
    rest = re.sub(r"^\s+", "", a[m.end():])
    for city in DESIGNATED_CITIES:
        if rest.startswith(city):
            ward = re.match(r"^([^\s]+?区)", rest[len(city):])
            return m.group(1), city + (ward.group(1) if ward else "")
    for city in SPECIAL_CITIES:
        if rest.startswith(city):
            return m.group(1), city
    c = CITY_RE.match(rest)
    return m.group(1), c.group(1) if c else None


def haversine_m(a, b) -> float:
    (lat1, lng1), (lat2, lng2) = a, b
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


class Geocoder:
    def __init__(self):
        GEOCODE_CACHE.parent.mkdir(parents=True, exist_ok=True)
        self.cache = json.loads(GEOCODE_CACHE.read_text(encoding="utf-8")) if GEOCODE_CACHE.exists() else {}
        self.s = requests.Session()
        self.s.headers["User-Agent"] = USER_AGENT
        self.calls = 0

    def lookup(self, address: str) -> dict | None:
        q = addr_core(address)
        if q not in self.cache:
            time.sleep(1.0)
            self.calls += 1
            try:
                r = self.s.get(GSI, params={"q": q}, timeout=30)
                self.cache[q] = {"fetchedAt": now_iso(), "results": r.json() if r.status_code == 200 else []}
            except (requests.RequestException, ValueError):
                return None
            if self.calls % 50 == 0:
                self.save()
                log(f"ジオコーディング {self.calls} 件")
        res = self.cache[q]["results"]
        if not res:
            return None
        top = res[0]
        title = top["properties"]["title"]
        lng, lat = top["geometry"]["coordinates"]
        # 一致した住所が問い合わせた住所のどこまで一致しているか
        # 番地まで含めて数字が全て一致した場合のみ "street"。それ以外（町・丁目止まり）は "town"
        t = norm_addr(title)
        qn = norm_addr(q)
        pref_q = PREF_RE.match(qn)
        if pref_q and not t.startswith(pref_q.group(1)):
            return None
        nums_q = re.findall(r"\d+", qn)
        nums_t = re.findall(r"\d+", t)
        if nums_q and nums_q == nums_t:
            precision = "street"   # 番地・号まで一致
        elif nums_t and len(nums_q) >= 2 and nums_q[:len(nums_t)] == nums_t and len(nums_t) >= len(nums_q) - 1:
            precision = "block"    # 番地まで一致（枝番・号のみ未一致）
        else:
            precision = "town"     # 町・丁目・条までしか一致しない（座標には使わない）
        return {"lat": lat, "lng": lng, "matchedAddress": title, "precision": precision, "fetchedAt": self.cache[q]["fetchedAt"]}

    def save(self):
        GEOCODE_CACHE.write_text(json.dumps(self.cache, ensure_ascii=False), encoding="utf-8")


def store_record(r: dict) -> dict:
    return {
        "name": r.get("name"),
        "chain": r.get("chain"),
        "operator": r.get("operator"),
        "storeType": r.get("storeType"),
        "postalCode": r.get("postalCode"),
        "address": r.get("address"),
        "phone": r.get("phone"),
        "openingHours": r.get("openingHours"),
        "machineCount": r.get("machineCount"),
        "features": r.get("features"),
        "officialUrl": r.get("officialUrl"),
        "facilityUrl": r.get("facilityUrl"),
        "lat": r.get("lat"),
        "lng": r.get("lng"),
        "coordinateSource": ("gashapon.jp店舗検索（公式データ）" if r.get("source") == "gashapon.jp" and r.get("lat") is not None
                             else ("公式サイトの地図マーカー" if r.get("coordinateSource") == "official-map-marker" else None)),
        "mapEmbedLat": r.get("mapEmbedLat"),
        "mapEmbedLng": r.get("mapEmbedLng"),
        "sources": [{
            "name": r.get("sourceName"),
            "type": r.get("sourceType", "official"),
            "url": r.get("officialUrl") or r.get("sourcePageUrl"),
            "listUrl": r.get("sourcePageUrl"),
            "shopCode": r.get("sourceShopCode"),
            "lastModified": r.get("sourceLastModified"),
            "fetchedAt": r.get("fetchedAt"),
        }],
        "fetchedAt": r.get("fetchedAt"),
    }


BRANDS = [
    ("cpla", r"c-?pla"), ("mori", r"ガチャガチャの森"), ("pon", r"pon[!！]"), ("gashacoco", r"gashacoco|ガシャココ"),
    ("dream", r"ドリームカプセル"), ("gbo", r"ガシャポンバンダイオフィシャルショップ|gashapon[®]?officialshop"),
    ("depart", r"ガシャポンのデパート"), ("namco", r"namco|ナムコ"),
]
# 店舗名にこれらの語の違いがあれば別店舗（号店・サブブランド・別フロアなど）
DIFF_WORDS = (r"(\d|2nd|3rd|ii|号|別館|新館|本館|南館|北館|東館|西館|スピンオフ|プラス|\+|アネックス|annex|キッズ|kids|east|west|north|south|plus|プラス"
              r"|branche|ブランシュ|oshi-?pla|pictale|okawari|labo|produced|ガシャポンshop|オフィシャルショップ|デパート)")


def brands_of(name: str) -> set[str]:
    n = nfkc(name).lower().replace(" ", "")
    return {b for b, pat in BRANDS if re.search(pat, n)}


def name_core(name: str) -> str:
    n = nfkc(name).lower().replace(" ", "")
    for _, pat in BRANDS:
        n = re.sub(pat, "", n)
    n = norm_name(n)
    return re.sub(r"店$", "", n)


def same_store_name(a: str, b: str, phone_match: bool = False) -> bool:
    ba, bb = brands_of(a), brands_of(b)
    if ba and bb and not (ba & bb):
        return False
    ca, cb = name_core(a), name_core(b)
    if not ca or not cb:
        return False
    # 「2号店」「2nd」などの違いがある場合は別店舗
    if sorted(re.findall(DIFF_WORDS, ca)) != sorted(re.findall(DIFF_WORDS, cb)):
        return False
    if ca == cb:
        return True
    short, long_ = sorted([ca, cb], key=len)
    if short in long_:
        diff = long_.replace(short, "", 1)
        # 電話番号・住所とも一致している場合は、地名などの付け足しの違いを許容する
        if phone_match or diff in ("", "ショップ", "shop", "店舗", "mini", "ミニ"):
            return True
    # 同じチェーンで住所（番地まで）が同じ場合は、表記ゆれ（「イオン名寄」と「イオンモール名寄」など）を類似度で判定する
    if ba and ba == bb:
        from difflib import SequenceMatcher
        return SequenceMatcher(None, ca.replace("mini", ""), cb.replace("mini", "")).ratio() >= 0.6
    return False


CHAIN_BY_OPERATOR = [
    ("トーシン", "#C-pla"), ("ルルアーク", "ガチャガチャの森"), ("ハピネット", "gashacoco"), ("ドリームカプセル", "ドリームカプセル"),
]


def infer_chain_from_name(name: str, operator: str | None) -> str | None:
    n = nfkc(name)
    if re.search(r"C-?pla", n, re.I):
        return "#C-pla"
    if "ガチャガチャの森" in n:
        return "ガチャガチャの森"
    if "gashacoco" in n.lower() or "ガシャココ" in n:
        return "gashacoco"
    if "ドリームカプセル" in n:
        return "ドリームカプセル"
    if "ガシャポンバンダイオフィシャルショップ" in n:
        return "ガシャポンバンダイオフィシャルショップ"
    if "ガシャポンのデパート" in n:
        return "ガシャポンのデパート"
    return None


def build_locations(geocode: bool = True) -> tuple[list[dict], list[dict], dict]:
    gashapon = load("stores_gashapon.jsonl")
    chains = load("stores_chains.jsonl")
    log(f"店舗（生データ）: ガシャポン公式 {len(gashapon)} 件・専門店チェーン {len(chains)} 件")
    excluded: list[dict] = []
    stats = Counter()

    recs = []
    for r in chains + gashapon:
        if not r.get("name") or not r.get("address"):
            stats["excluded_insufficient"] += 1
            excluded.append({"kind": "location", "reason": "店舗名または住所がない", "name": r.get("name"), "sourceUrl": r.get("sourceUrl")})
            continue
        rec = store_record(r)
        # 店舗名に休業・閉店の記載がある場合は、その記載を残す（営業状況の判断は投入前の確認で行う）
        m = re.search(r"[（(]?(営業休止中|休業中|閉店[^）)]*|一時休業[^）)]*)[）)]?", rec["name"] or "")
        rec["statusNote"] = m.group(1) if m else None
        if not rec["chain"]:
            rec["chain"] = infer_chain_from_name(rec["name"], rec["operator"])
        recs.append(rec)

    # 重複排除（チェーン公式の情報を優先し、ガシャポン公式の座標で補う）
    # 同じ店舗とみなすのは「住所（番地まで）または電話番号が一致」かつ「店舗名が同じ店を指す」場合のみ
    merged: list[dict] = []
    by_phone: dict[str, list[dict]] = defaultdict(list)
    by_addr: dict[str, list[dict]] = defaultdict(list)
    for rec in recs:
        ph = norm_phone(rec["phone"])
        core = addr_key(rec["address"])
        target = next((c for c in by_phone.get(ph, []) if addr_key(c["address"]) == core
                       and same_store_name(c["name"], rec["name"], phone_match=True)), None)
        target = target or next((c for c in by_addr.get(core, []) if same_store_name(c["name"], rec["name"])), None)
        if target:
            stats["duplicates_removed"] += 1
            excluded.append({"kind": "location", "reason": "重複（住所または電話番号と、店舗名が一致）", "name": rec["name"],
                             "sourceUrl": rec["sources"][0]["url"], "mergedInto": target["name"]})
            target["sources"] += rec["sources"]
            if target["lat"] is None and rec["lat"] is not None:
                target["lat"], target["lng"], target["coordinateSource"] = rec["lat"], rec["lng"], rec["coordinateSource"]
            for k in ("postalCode", "phone", "openingHours", "operator", "chain", "officialUrl"):
                if not target.get(k) and rec.get(k):
                    target[k] = rec[k]
            continue
        merged.append(rec)
        if ph:
            by_phone[ph].append(rec)
        by_addr[core].append(rec)

    # メーカー（トイズキャビン）の取扱店舗一覧だけに載っている専門店チェーンの店舗は、
    # チェーン公式の一覧・ガシャポン公式で確認できないため除外する（閉店・改称の可能性）
    OFFICIAL_LIST_CHAINS = {"#C-pla", "ガチャガチャの森", "ドリームカプセル", "gashacoco", "カプセル楽局",
                            "ガシャポンバンダイオフィシャルショップ", "ガシャポンのデパート"}
    kept = []
    for rec in merged:
        only_maker_list = all("トイズキャビン" in (s["name"] or "") for s in rec["sources"])
        if only_maker_list and rec["chain"] in OFFICIAL_LIST_CHAINS:
            stats["excluded_unconfirmed"] += 1
            excluded.append({"kind": "location", "reason": "チェーン公式の店舗一覧で確認できない（メーカーの取扱店舗一覧のみに掲載。閉店・改称の可能性）",
                             "name": rec["name"], "sourceUrl": rec["sources"][0]["url"]})
            continue
        kept.append(rec)
    merged = kept

    geo = Geocoder() if geocode else None
    for rec in merged:
        pref, city = split_region(rec["address"])
        rec["prefecture"], rec["city"] = pref, city
        rec["coordinatePrecision"] = "official" if rec["lat"] is not None else None
        rec["geocode"] = None
        if geo and (rec["lat"] is None or not pref):
            g = geo.lookup(rec["address"])
            if g:
                rec["geocode"] = g
                # 町・丁目レベルの一致では数 km ずれることがあるため、座標としては採用しない（参考情報として geocode に残す）
                if rec["lat"] is None and g["precision"] in ("street", "block"):
                    rec["lat"], rec["lng"] = g["lat"], g["lng"]
                    rec["coordinateSource"] = "国土地理院 住所検索API（住所から算出）"
                    rec["coordinatePrecision"] = g["precision"]
                if not pref:
                    # 住所に都道府県が書かれていない場合のみ、住所検索の結果から補う
                    p2, c2 = split_region(g["matchedAddress"])
                    rec["prefecture"], rec["city"] = p2, city or c2
                    rec["prefectureSource"] = "国土地理院 住所検索API"
        if rec["lat"] is not None and rec.get("mapEmbedLat") is not None:
            rec["mapEmbedDistanceM"] = round(haversine_m((rec["lat"], rec["lng"]), (rec["mapEmbedLat"], rec["mapEmbedLng"])))
    if geo:
        geo.save()

    out = []
    for rec in merged:
        key = rec["sources"][0]["url"] + "|" + rec["name"]
        rec = {"id": stable_id("loc", key), **rec}
        out.append(rec)
    out.sort(key=lambda x: (x["prefecture"] or "", x["city"] or "", x["name"]))
    stats["locations"] = len(out)
    stats["with_official_coordinates"] = sum(1 for r in out if r["coordinatePrecision"] == "official")
    stats["with_geocoded_coordinates"] = sum(1 for r in out if r["coordinatePrecision"] in ("street", "block"))
    stats["without_coordinates"] = sum(1 for r in out if r["lat"] is None)
    return out, excluded, dict(stats)


SOURCES = [
    {"name": "ガシャポン公式サイト（バンダイ）", "url": "https://gashapon.jp/products/", "type": "official", "use": "商品"},
    {"name": "タカラトミーアーツ ガチャ™発売カレンダー", "url": "https://www.takaratomy-arts.co.jp/items/gacha/calendar/", "type": "official", "use": "商品"},
    {"name": "キタンクラブ公式サイト", "url": "https://kitan.jp/", "type": "official", "use": "商品"},
    {"name": "アイピーフォー カプセルトイ", "url": "https://www.ip4.co.jp/cupsuletoy_top/", "type": "official", "use": "商品"},
    {"name": "ブシカプ！（ブシロードクリエイティブ）", "url": "https://capsule.bushiroad-creative.com/product/", "type": "official", "use": "商品"},
    {"name": "Qualia 公式サイト", "url": "https://www.qualia-45.jp/", "type": "official", "use": "商品"},
    {"name": "スタンド・ストーンズ公式サイト", "url": "https://stasto.co.jp/", "type": "official", "use": "商品"},
    {"name": "SO-TA（スタジオソータ）公式サイト", "url": "https://www.so-ta.com/products/capsuletoy/", "type": "official", "use": "商品"},
    {"name": "トイズキャビン公式サイト", "url": "https://toyscabin.com/product/", "type": "official", "use": "商品・店舗（取扱店舗様一覧）"},
    {"name": "トイズスピリッツ公式サイト", "url": "http://www.toysp.co.jp/", "type": "official", "use": "商品"},
    {"name": "Jドリーム公式サイト", "url": "https://e-jdream.co.jp/product/", "type": "official", "use": "商品"},
    {"name": "ガシャポン公式「ガシャポンどこ？」店舗検索", "url": "https://gashapon.jp/shop/gplus_list.php", "type": "official", "use": "店舗（公式座標）"},
    {"name": "バンダイナムコアミューズメント 店舗ページ（ガシャポンバンダイオフィシャルショップ・ガシャポンのデパート）", "url": "https://bandainamco-am.co.jp/others/gashapon-bandai-officialshop/", "type": "official", "use": "店舗"},
    {"name": "#C-pla（トーシン）店舗紹介", "url": "https://toshin.jpn.com/shop/", "type": "official", "use": "店舗"},
    {"name": "ガチャガチャの森 店舗一覧", "url": "https://www.gachagachanomori.com/shoplist/", "type": "official", "use": "店舗"},
    {"name": "gashacoco 店舗一覧", "url": "https://gashacoco.jp/shop-list", "type": "official", "use": "店舗（公式地図マーカー座標）"},
    {"name": "ドリームカプセル 運営店舗", "url": "https://www.dreamcapsule.co.jp/shop/", "type": "official", "use": "店舗"},
    {"name": "カプセル楽局 店舗一覧", "url": "https://www.warehousenet.jp/capsule/", "type": "official", "use": "店舗"},
    {"name": "ガチャ王国 店舗一覧", "url": "https://gachaoukoku.com/shop/", "type": "official", "use": "店舗"},
    {"name": "がちゃ処（プレステージ）", "url": "https://www.prestage.co.jp/gachadokoro/gachadokoro.html", "type": "official", "use": "店舗"},
    {"name": "国土地理院 住所検索API", "url": "https://msearch.gsi.go.jp/address-search/AddressSearch", "type": "government", "use": "住所からの座標算出"},
]


def main() -> None:
    geocode = "--no-geocode" not in sys.argv
    products, ex_p, st_p = build_products()
    locations, ex_l, st_l = build_locations(geocode)

    (OUT_DIR / "products.json").write_text(json.dumps(products, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT_DIR / "locations.json").write_text(json.dumps(locations, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT_DIR / "excluded.json").write_text(json.dumps(ex_p + ex_l, ensure_ascii=False, indent=1), encoding="utf-8")

    fetched = [p["fetchedAt"] for p in products if p.get("fetchedAt")] + [l["fetchedAt"] for l in locations if l.get("fetchedAt")]
    report = {
        "generatedAt": now_iso(),
        "sources": SOURCES,
        "fetchedFrom": min(fetched) if fetched else None,
        "fetchedTo": max(fetched) if fetched else None,
        "products": {
            "total": len(products),
            "byMaker": dict(Counter(p["maker"] for p in products).most_common()),
            "bySource": dict(Counter(p["source"] for p in products).most_common()),
            "byReleaseYear": dict(sorted(Counter((p["releaseYearMonth"] or "不明")[:4] for p in products).items(), reverse=True)),
            "missing": {k: sum(1 for p in products if not p.get(k)) for k in
                        ["price", "releaseYearMonth", "description", "imageUrl", "series", "janCode"]},
            **st_p,
        },
        "locations": {
            "total": len(locations),
            "byPrefecture": dict(Counter(l["prefecture"] or "不明" for l in locations).most_common()),
            "byChain": dict(Counter(l["chain"] or "（チェーン不明・その他）" for l in locations).most_common()),
            "missing": {k: sum(1 for l in locations if not l.get(k)) for k in ["openingHours", "phone", "officialUrl", "city"]},
            **st_l,
        },
        "excluded": {
            "duplicates": st_p.get("duplicates_removed", 0) + st_l.get("duplicates_removed", 0),
            "insufficient": st_p.get("excluded_insufficient", 0) + st_l.get("excluded_insufficient", 0),
            "unconfirmed": st_l.get("excluded_unconfirmed", 0),
            "outOfScope": st_p.get("excluded_out_of_scope", 0),
        },
    }
    (OUT_DIR / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    log(json.dumps({"products": len(products), "locations": len(locations), "excluded": report["excluded"]}, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
