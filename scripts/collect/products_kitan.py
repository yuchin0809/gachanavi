"""
キタンクラブ公式サイト（kitan.jp）の商品を収集する。

商品ページの一覧はサイトマップ（products-sitemap.xml）から取得する。
（WordPress の REST API は公開されていないため使わない）
"""
from __future__ import annotations

import re
import sys

from bs4 import BeautifulSoup

from common import JsonlWriter, clean, fetch, log, parse_full_date, parse_price, parse_year_month

SITEMAP = "https://kitan.jp/products-sitemap.xml"


def detail_value(soup: BeautifulSoup, title: str) -> str | None:
    for dl in soup.select("dl.c-productDetail__detail-item"):
        dt = dl.select_one("dt")
        if dt and dt.get_text(strip=True) == title:
            return clean(dl.select_one("dd").get_text(" "))
    return None


def parse_detail(url: str) -> dict | None:
    body, fetched = fetch(url)
    if not body:
        return None
    soup = BeautifulSoup(body, "lxml")
    title = soup.select_one(".c-productDetail__title")
    name = detail_value(soup, "商品名") or (clean(title.get_text(" ")) if title else None)
    if not name:
        return None
    crumbs = [clean(a.get_text()) for a in soup.select(".c-breadcrumb a, .breadcrumb a, [class*=bread] a")]
    price_block = detail_value(soup, "価格") or ""
    lineup = re.search(r"全\s*\d+\s*種[^\s]*", price_block)
    release_text = detail_value(soup, "発売日")
    images = []
    thumb = soup.select_one(".c-productDetail__thum img")
    if thumb and thumb.get("src"):
        images.append(thumb["src"])
    for img in soup.select(".c-productDetail__pickup img"):
        if img.get("src") and img["src"] not in images:
            images.append(img["src"])
    text = soup.select_one(".c-productDetail__text")
    tags = [t.get_text(strip=True).lstrip("#") for t in soup.select(".c-productDetail__lead a span")]
    seller = detail_value(soup, "発売元")
    return {
        "source": "kitan.jp",
        "sourceType": "official",
        "maker": "キタンクラブ",
        "seller": seller,
        "brand": None,
        "category": crumbs[1] if len(crumbs) > 1 else None,
        "name": re.sub(r"\s+", " ", name),
        "series": None,
        "tags": [t for t in tags if t],
        "janCode": None,
        "releaseText": release_text,
        "releaseYearMonth": parse_year_month(release_text),
        "releaseDate": parse_full_date(release_text),
        "price": parse_price(price_block.replace(lineup.group(0), "") if lineup else price_block),
        "priceText": price_block or None,
        "priceTaxIncluded": None,  # 公式ページに税込・税抜の明記がない
        "lineupCount": lineup.group(0) if lineup else None,
        "size": detail_value(soup, "サイズ"),
        "targetAge": None,
        "description": clean(text.get_text("\n")) if text else None,
        "officialUrl": url,
        "imageUrl": images[0] if images else None,
        "imageUrls": images,
        "sourceUrl": url,
        "listSourceUrl": SITEMAP,
        "fetchedAt": fetched,
    }


def main() -> None:
    writer = JsonlWriter("products_kitan")
    body, _ = fetch(SITEMAP, use_cache=False)
    urls = sorted(set(re.findall(r"https://kitan\.jp/products/[^\]<\s]+/", body or "")))
    log(f"サイトマップ: {len(urls)} 件")
    todo = [u for u in urls if u not in writer.seen]
    for i, u in enumerate(todo, 1):
        rec = parse_detail(u)
        if rec:
            writer.write(rec)
        if i % 100 == 0:
            log(f"詳細 {i}/{len(todo)}")
    log("完了:", len(writer.seen), "件")


if __name__ == "__main__":
    sys.exit(main())
