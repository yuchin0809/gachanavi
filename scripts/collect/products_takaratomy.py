"""
タカラトミーアーツ公式「ガチャ™発売カレンダー」の商品を収集する。

1. 発売カレンダー（?ym=YYYYMM）の全月分から商品詳細ページへのリンクを集める
2. 各商品の詳細ページから、商品名・価格・発売時期・説明・画像を取得する
"""
from __future__ import annotations

import re
import sys

from bs4 import BeautifulSoup

from common import JsonlWriter, abs_url, clean, fetch, log, parse_full_date, parse_price, parse_year_month

CAL = "https://www.takaratomy-arts.co.jp/items/gacha/calendar/"
ITEM = "https://www.takaratomy-arts.co.jp/items/item.html?n={}"


def collect_list() -> dict[str, str]:
    body, _ = fetch(CAL)
    months = sorted(set(re.findall(r'value="(\d{6})"', body or "")) | set(re.findall(r"ym=(\d{6})", body or "")), reverse=True)
    log(f"カレンダー: {len(months)} か月分")
    found: dict[str, str] = {}
    for ym in months:
        url = f"{CAL}?ym={ym}"
        b, _ = fetch(url)
        codes = re.findall(r"item\.html\?n=([A-Za-z0-9_-]+)", b or "")
        for c in codes:
            found.setdefault(c, url)
        log(f"カレンダー {ym}: {len(set(codes))} 件（累計 {len(found)}）")
    return found


def parse_detail(code: str, list_url: str) -> dict | None:
    url = ITEM.format(code)
    body, fetched = fetch(url)
    if not body:
        return None
    soup = BeautifulSoup(body, "lxml")
    detail = soup.select_one("#detail")
    if not detail:
        return None
    h2 = detail.select_one(".head h2")
    name = clean(h2.get_text(" ")) if h2 else None
    if not name:
        return None
    name = re.sub(r"\s+", " ", name)
    label = detail.select_one(".head label")
    catch = detail.select_one(".head h3")
    spec = detail.select_one(".head p")
    spec_text = clean(spec.get_text(" ")) if spec else ""
    price_text = release_text = None
    m = re.search(r"■価格[:：]\s*([^■]+)", spec_text or "")
    if m:
        price_text = m.group(1).strip()
    m = re.search(r"■発売時期[:：]\s*([^■]+)", spec_text or "")
    if m:
        release_text = m.group(1).strip()
    images = []
    for img in detail.select(".images img"):
        src = abs_url(url, img.get("src"))
        if src and src not in images:
            images.append(src)
    summary = detail.select_one(".summary")
    return {
        "source": "takaratomy-arts.co.jp",
        "sourceType": "official",
        "maker": "タカラトミーアーツ",
        "brand": clean(label.get_text()) if label else "ガチャ™",
        "name": name,
        "series": None,
        "catchCopy": clean(catch.get_text(" ")) if catch else None,
        "janCode": None,
        "makerItemCode": code,
        "releaseText": release_text,
        "releaseYearMonth": parse_year_month(release_text),
        "releaseDate": parse_full_date(release_text),
        "price": parse_price(price_text),
        "priceText": price_text,
        "priceTaxIncluded": "税込" in (price_text or ""),
        "lineupCount": None,
        "targetAge": None,
        "description": clean(summary.get_text("\n")) if summary else None,
        "officialUrl": url,
        "imageUrl": images[0] if images else None,
        "imageUrls": images,
        "sourceUrl": url,
        "listSourceUrl": list_url,
        "fetchedAt": fetched,
    }


def main() -> None:
    writer = JsonlWriter("products_takaratomy")
    found = collect_list()
    todo = [(c, u) for c, u in found.items() if ITEM.format(c) not in writer.seen]
    log(f"詳細ページ: 未取得 {len(todo)} 件")
    for i, (c, u) in enumerate(todo, 1):
        rec = parse_detail(c, u)
        if rec:
            writer.write(rec)
        if i % 200 == 0:
            log(f"詳細 {i}/{len(todo)}")
    log("完了:", len(writer.seen), "件")


if __name__ == "__main__":
    sys.exit(main())
