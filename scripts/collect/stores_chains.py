"""
カプセルトイ専門店チェーンの公式店舗一覧から店舗を収集する。

- ガチャガチャの森（株式会社ルルアーク）  : https://www.gachagachanomori.com/shoplist/
- #C-pla（株式会社トーシン）              : https://toshin.jpn.com/shop/
- ドリームカプセル（ドリームカプセル株式会社）: https://www.dreamcapsule.co.jp/shop/
- gashacoco（ハピネット・ベンディングサービス）: https://gashacoco.jp/shop-list

緯度・経度は次のように区別して記録する（推測はしない）。
- lat/lng + coordinateSource="official-map-marker": 公式サイトの地図マーカーの座標
- mapEmbedLat/mapEmbedLng: 公式店舗ページに埋め込まれた Google マップの表示位置（参考値）
住所からの座標付与（ジオコーディング）は build.py でまとめて行う。
"""
from __future__ import annotations

import json
import re
import sys

from bs4 import BeautifulSoup

from common import JsonlWriter, abs_url, clean, fetch, log

PREF_RE = re.compile(r"^(北海道|東京都|京都府|大阪府|.{2,3}県)")


def split_postal(text: str | None) -> tuple[str | None, str | None]:
    if not text:
        return None, None
    m = re.search(r"〒?\s*(\d{3}-?\d{4})", text)
    postal = m.group(1) if m else None
    addr = text[m.end():] if m else text
    return postal, clean(re.sub(r"\s+", " ", addr))


def pref_of(addr: str | None) -> str | None:
    m = PREF_RE.match(addr or "")
    return m.group(1) if m else None


def embed_coords(html: str) -> tuple[float | None, float | None]:
    m = re.search(r"google\.com/maps/embed\?pb=[^\"']*?!2d(-?[0-9.]+)!3d(-?[0-9.]+)", html)
    return (float(m.group(2)), float(m.group(1))) if m else (None, None)


def base(chain: str, operator: str, url: str, list_url: str, fetched: str) -> dict:
    return {
        "source": re.sub(r"^https?://(www\.)?", "", list_url).split("/")[0],
        "sourceType": "official",
        "sourceName": f"{chain} 公式店舗一覧",
        "chain": chain,
        "operator": operator,
        "officialUrl": url,
        "sourceUrl": url,
        "sourcePageUrl": list_url,
        "fetchedAt": fetched,
        "lat": None,
        "lng": None,
        "coordinateSource": None,
    }


# ---------------------------------------------------------------- ガチャガチャの森
def collect_mori(writer: JsonlWriter) -> None:
    url = "https://www.gachagachanomori.com/shoplist/"
    body, fetched = fetch(url, use_cache=False)
    soup = BeautifulSoup(body or "", "lxml")
    n = 0
    for shop in soup.select("div.shop"):
        name_el = shop.select_one("h4.name")
        addr_el = shop.select_one("p.address")
        if not name_el or not addr_el:
            continue
        name = clean(name_el.get_text(" "))
        postal, address = split_postal(addr_el.get_text(" "))
        tel = shop.select_one("p.tel")
        hours = shop.select_one("p.time")
        count = shop.select_one("p.count")
        typ = shop.select_one("p.type")
        link = shop.select_one("a.btn01")
        rec = base("ガチャガチャの森", "株式会社ルルアーク", url, url, fetched)
        rec.update({
            "name": re.sub(r"\s+", " ", name),
            "storeType": clean(typ.get_text()) if typ else None,
            "postalCode": postal,
            "address": address,
            "prefecture": pref_of(address),
            "phone": clean(re.sub(r"^TEL\s*[:：]\s*", "", tel.get_text())) if tel else None,
            "openingHours": clean(re.sub(r"^営業時間\s*[:：]\s*", "", hours.get_text())) if hours else None,
            "machineCount": clean(re.sub(r"^台数\s*[:：]\s*", "", count.get_text())) if count else None,
            "facilityUrl": abs_url(url, link.get("href")) if link else None,
            # 一覧ページ内の店舗なので、重複判定用に店舗名を付けた URL にする
            "sourceUrl": f"{url}#{name}|{address}",
        })
        writer.write(rec)
        n += 1
    log(f"ガチャガチャの森: {n} 件")


# ---------------------------------------------------------------- #C-pla
def collect_cpla(writer: JsonlWriter) -> None:
    list_base = "https://toshin.jpn.com/shop/"
    first, _ = fetch(list_base, use_cache=False)
    pages = [int(p) for p in re.findall(r"/shop/page/(\d+)/", first or "")]
    urls: list[str] = []
    for p in range(1, (max(pages) if pages else 1) + 1):
        body, _ = fetch(list_base if p == 1 else f"{list_base}page/{p}/", use_cache=p != 1)
        for u in re.findall(r'href="(https://toshin\.jpn\.com/shop/[^"/]+/)"', body or ""):
            if "/page/" not in u and u not in urls:
                urls.append(u)
    log(f"#C-pla: 店舗ページ {len(urls)} 件")
    for u in urls:
        body, fetched = fetch(u)
        if not body:
            continue
        soup = BeautifulSoup(body, "lxml")
        title = soup.select_one("h1.article-head__title")
        content = soup.select_one(".article-editor-content")
        if not title or not content:
            continue
        text = content.get_text("\n")
        postal, _ = split_postal(text)
        addr = None
        for line in [clean(l) for l in text.split("\n")]:
            if line and PREF_RE.match(line):
                addr = line
                break
        hours = re.search(r"営業時間[\s　:：]*([^\n]+)", text)
        tel = re.search(r"TEL[\s　:：]*([0-9\-]+)", text)
        boxes = re.search(r"設置ボックス数[\s　:：]*([^\n]+)", text)
        areas = [clean(a.get_text()) for a in soup.select(".article-head__cat-container a.shop-cat")]
        lat, lng = embed_coords(body)
        name = clean(title.get_text())
        rec = base("#C-pla", "株式会社トーシン", u, list_base, fetched)
        rec.update({
            "name": name if name.startswith(("#C-pla", "＃C-pla")) else f"#C-pla {name}",
            "storeType": None,
            "postalCode": postal,
            "address": addr,
            "prefecture": pref_of(addr),
            "phone": tel.group(1) if tel else None,
            "openingHours": clean(hours.group(1)) if hours else None,
            "machineCount": clean(boxes.group(1)) if boxes else None,
            "area": areas,
            "mapEmbedLat": lat,
            "mapEmbedLng": lng,
        })
        writer.write(rec)
    log("#C-pla: 完了")


# ---------------------------------------------------------------- ドリームカプセル
def collect_dream(writer: JsonlWriter) -> None:
    list_url = "https://www.dreamcapsule.co.jp/shop/"
    body, _ = fetch(list_url, use_cache=False)
    urls = sorted(set(re.findall(r'href="(https://www\.dreamcapsule\.co\.jp/shop/\d+)"', body or "")), key=lambda u: int(u.rsplit("/", 1)[1]))
    log(f"ドリームカプセル: 店舗ページ {len(urls)} 件")
    for u in urls:
        b, fetched = fetch(u)
        if not b:
            continue
        soup = BeautifulSoup(b, "lxml")
        info = {}
        for item in soup.select("dl.infoList .item"):
            dt, dd = item.select_one("dt"), item.select_one("dd")
            if dt and dd:
                info[clean(dt.get_text())] = clean(dd.get_text("\n"))
        if not info.get("店舗名") or not info.get("住所"):
            continue
        addr_lines = info["住所"].split("\n")
        address = clean(" ".join(addr_lines))
        icons = [img.get("alt") for img in soup.select("ul.icoList img") if img.get("alt")]
        lat, lng = embed_coords(b)
        rec = base("ドリームカプセル", "ドリームカプセル株式会社", u, list_url, fetched)
        rec.update({
            "name": f"ドリームカプセル {info['店舗名']}",
            "storeType": "有人店" if "有人店" in icons else None,
            "features": sorted(set(icons)),
            "postalCode": None,
            "address": address,
            "prefecture": pref_of(address),
            "phone": info.get("電話番号"),
            "openingHours": info.get("営業時間"),
            "machineCount": None,
            "mapEmbedLat": lat,
            "mapEmbedLng": lng,
        })
        writer.write(rec)
    log("ドリームカプセル: 完了")


# ---------------------------------------------------------------- gashacoco
def collect_gashacoco(writer: JsonlWriter) -> None:
    url = "https://gashacoco.jp/shop-list"
    body, fetched = fetch(url, use_cache=False)
    soup = BeautifulSoup(body or "", "lxml")
    markers = {}
    for m in re.finditer(r"position:\s*\{\s*lat:\s*(-?[0-9.]+),\s*lng:\s*(-?[0-9.]+)\s*\},\s*map:\s*map,\s*title:\s*\"([^\"]+)\"", body or ""):
        markers[m.group(3).strip()] = (float(m.group(1)), float(m.group(2)))
    n = 0
    for box in soup.select("div.shop-container"):
        a = box.select_one(".shop-title a")
        if not a:
            continue
        name = clean(a.get_text())
        info = {}
        for row in box.select(".shop-info .row"):
            k, v = row.select_one("strong"), row.select_one("div")
            if k and v:
                info[clean(k.get_text())] = clean(v.get_text(" "))
        address = info.get("住所")
        if not address:
            continue
        detail = abs_url(url, a.get("href"))
        rec = base("gashacoco", "株式会社ハピネット・ベンディングサービス", detail, url, fetched)
        latlng = markers.get(name)
        rec.update({
            "name": name,
            "storeType": None,
            "postalCode": info.get("郵便番号"),
            "address": address,
            "prefecture": pref_of(address),
            "phone": info.get("電話番号"),
            "openingHours": info.get("営業時間"),
            "machineCount": None,
            "facilityUrl": info.get("URL"),
            "lat": latlng[0] if latlng else None,
            "lng": latlng[1] if latlng else None,
            "coordinateSource": "official-map-marker" if latlng else None,
        })
        writer.write(rec)
        n += 1
    log(f"gashacoco: {n} 件（地図マーカーの座標あり {len(markers)} 件）")


# ---------------------------------------------------------------- ガチャ王国（マキシム愛媛）
def collect_oukoku(writer: JsonlWriter) -> None:
    list_url = "https://gachaoukoku.com/shop/"
    body, _ = fetch(list_url, use_cache=False)
    urls = sorted(set(re.findall(r'href="(https://gachaoukoku\.com/[a-z]+/post-\d+/)"', body or "")))
    for u in urls:
        b, fetched = fetch(u)
        if not b:
            continue
        soup = BeautifulSoup(b, "lxml")
        title = soup.select_one("title")
        name = clean(re.sub(r"\s*-\s*情報発信基地.*$", "", title.get_text())) if title else None
        text = soup.get_text("\n")
        m = re.search(r"〒\s*(\d{3}-\d{4})[\s　]*([^\n]+)", text)
        if not name or not m:
            continue
        address = clean(m.group(2).replace("　", " "))
        tel = re.search(r"TEL[\s　]*([0-9\-]+)", text)
        hours = re.search(r"営業時間[\s　]*([^\n]+)", text)
        lat, lng = embed_coords(b)
        rec = base("ガチャ王国 O's collebo", "株式会社マキシム愛媛", u, list_url, fetched)
        rec.update({
            "name": name, "storeType": None, "postalCode": m.group(1), "address": address, "prefecture": pref_of(address),
            "phone": tel.group(1) if tel else None, "openingHours": clean(hours.group(1).replace("：", ":")) if hours else None,
            "machineCount": None, "mapEmbedLat": lat, "mapEmbedLng": lng,
        })
        writer.write(rec)
    log(f"ガチャ王国: {len(urls)} 件")


# ---------------------------------------------------------------- がちゃ処（プレステージ）
def collect_gachadokoro(writer: JsonlWriter) -> None:
    url = "https://www.prestage.co.jp/gachadokoro/gachadokoro.html"
    body, fetched = fetch(url, use_cache=False)
    text = BeautifulSoup(body or "", "lxml").get_text("\n")
    n = 0
    for m in re.finditer(r"『(がちゃ処[^』]+)』\s*\n([^\n]*)\n\s*〒\s*(\d{3}-\d{4})\s*([^\n]+)\n\s*TEL[：:]\s*([0-9\-]+)[^\n]*\n\s*設置台数[：:]\s*([^\n]+)", text):
        address = clean(m.group(4))
        rec = base("がちゃ処", "株式会社プレステージ", url, url, fetched)
        rec.update({
            "name": clean(m.group(1).replace("　", " ")), "storeType": None, "postalCode": m.group(3), "address": address,
            "prefecture": pref_of(address), "phone": m.group(5), "openingHours": None, "machineCount": clean(m.group(6)),
            "locationNote": clean(m.group(2)), "sourceUrl": f"{url}#{m.group(1)}",
        })
        writer.write(rec)
        n += 1
    log(f"がちゃ処: {n} 件")


# ---------------------------------------------------------------- バンダイナムコアミューズメント
def collect_bnam(writer: JsonlWriter) -> None:
    """
    ガシャポンバンダイオフィシャルショップ・同社のカプセルトイストアの店舗ページ（サイトマップから取得）。
    「店舗情報」欄（住所・営業時間・電話番号・設置数）だけを読み、ページ内の取扱アイテム・在庫欄は使わない。
    """
    sm = "https://bandainamco-am.co.jp/sitemap_others.xml"
    body, _ = fetch(sm, use_cache=False)
    urls = sorted(set(re.findall(r"<loc>(https://bandainamco-am\.co\.jp/others/(?:gashapon-bandai-officialshop|capsule-toy-store)/store/[^/<]+/)</loc>", body or "")))
    log(f"バンダイナムコアミューズメント: 店舗ページ {len(urls)} 件")
    for u in urls:
        b, fetched = fetch(u)
        if not b:
            continue
        soup = BeautifulSoup(b, "lxml")
        text = soup.get_text("\n")
        lines = [clean(x) for x in text.split("\n")]
        lines = [x for x in lines if x]
        def after(label: str, n: int = 1) -> list[str]:
            for i, x in enumerate(lines):
                if x == label:
                    return lines[i + 1:i + 1 + n]
            return []
        addr_lines = after("住所", 2)
        if not addr_lines:
            continue
        postal = re.sub(r"[〒\s]", "", addr_lines[0]) if addr_lines[0].startswith("〒") else None
        address = addr_lines[1] if postal else addr_lines[0]
        if not PREF_RE.match(address or ""):
            continue
        hours = after("営業時間", 1)
        phone = after("電話番号", 1)
        count = after("設置数", 2)
        title = soup.select_one("title")
        name = clean(title.get_text().split("|")[0]) if title else None
        chain = "ガシャポンバンダイオフィシャルショップ" if "gashapon-bandai-officialshop" in u else None
        rec = base(chain or "バンダイナムコ カプセルトイストア", "株式会社バンダイナムコアミューズメント", u, sm, fetched)
        rec.update({
            "chain": chain, "sourceName": "バンダイナムコアミューズメント 公式店舗ページ",
            "name": name, "storeType": None, "postalCode": postal, "address": address, "prefecture": pref_of(address),
            "phone": phone[0] if phone and re.search(r"\d", phone[0]) else None,
            "openingHours": hours[0] if hours else None,
            "machineCount": "".join(count) if count and re.match(r"\d", count[0]) else None,
        })
        writer.write(rec)
    log("バンダイナムコアミューズメント: 完了")


# ---------------------------------------------------------------- カプセル楽局（ゲオグループ）
def collect_rakkyoku(writer: JsonlWriter) -> None:
    url = "https://www.warehousenet.jp/capsule/"
    body, fetched = fetch(url, use_cache=False)
    soup = BeautifulSoup(body or "", "lxml")
    n = 0
    for card in soup.select("div.card[id^=shop]"):
        name_el = card.select_one(".storename")
        if not name_el:
            continue
        ps = [clean(p.get_text(" ")) for p in name_el.find_parent("div").select("p")]
        ps = [p for p in ps if p]
        postal = next((p for p in ps if re.fullmatch(r"\d{3}-\d{4}", p)), None)
        address = next((p for p in ps if PREF_RE.match(p)), None)
        phone = next((p for p in ps if re.fullmatch(r"[0-9\-]{10,13}", p)), None)
        hours = next((p for p in ps if re.search(r"\d{1,2}[:：]\d{2}", p)), None)
        if not address:
            continue
        rec = base("カプセル楽局", "株式会社ゲオ／ウェアハウス", url, url, fetched)
        rec.update({
            "name": clean(name_el.get_text()), "storeType": None, "postalCode": postal, "address": address,
            "prefecture": pref_of(address), "phone": phone, "openingHours": hours, "machineCount": None,
            "sourceUrl": f"{url}#{card.get('id')}",
        })
        writer.write(rec)
        n += 1
    log(f"カプセル楽局: {n} 件")


# ---------------------------------------------------------------- トイズキャビン 取扱店舗様一覧
def collect_toyscabin_shops(writer: JsonlWriter) -> None:
    """
    メーカー（トイズキャビン）が公開している取扱店舗一覧。店舗の所在地としてのみ使い、
    「どの商品が置かれているか」は登録しない。
    """
    url = "https://toyscabin.com/shoplist/"
    body, fetched = fetch(url, use_cache=False)
    soup = BeautifulSoup(body or "", "lxml")
    area = soup.select_one("#dataArea") or soup
    lines = [clean(x) for x in area.get_text("\n").split("\n")]
    lines = [x for x in lines if x]
    regions = {"北海道", "東北", "関東", "中部", "北陸", "甲信越", "東海", "近畿", "関西", "中国", "四国", "中国・四国", "九州", "沖縄", "九州・沖縄"}
    addr_like = re.compile(r"(都|道|府|県|市|区|町|村|郡).*\d")
    n = 0
    i = 0
    while i < len(lines) - 1:
        name, addr = lines[i], lines[i + 1]
        if name in regions or name.startswith(("※", "当リスト", "ガチャガチャには", "店舗様", "弊社商品", "全国の")):
            i += 1
            continue
        if addr_like.search(addr) and not addr_like.search(name):
            rec = base("（トイズキャビン取扱店舗一覧）", None, url, url, fetched)
            rec.update({
                "chain": None,
                "sourceName": "トイズキャビン 取扱店舗様一覧（メーカー公表。取扱の多い店舗の一覧）",
                "name": re.sub(r"\s+", " ", name), "storeType": None, "postalCode": None, "address": addr,
                "prefecture": pref_of(addr), "phone": None, "openingHours": None, "machineCount": None,
                "sourceUrl": f"{url}#{name}|{addr}",
            })
            writer.write(rec)
            n += 1
            i += 2
        else:
            i += 1
    log(f"トイズキャビン取扱店舗: {n} 件")


def main() -> None:
    writer = JsonlWriter("stores_chains")
    targets = sys.argv[1:] or ["mori", "gashacoco", "dream", "cpla", "oukoku", "gachadokoro"]
    for t in targets:
        {"mori": collect_mori, "cpla": collect_cpla, "dream": collect_dream, "gashacoco": collect_gashacoco,
         "oukoku": collect_oukoku, "gachadokoro": collect_gachadokoro, "toyscabin": collect_toyscabin_shops, "rakkyoku": collect_rakkyoku, "bnam": collect_bnam}[t](writer)
    log("完了:", len(writer.seen), "件")


if __name__ == "__main__":
    sys.exit(main())
