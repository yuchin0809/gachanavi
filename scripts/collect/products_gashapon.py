"""
バンダイ ガシャポン公式サイト（gashapon.jp）の商品を収集する。

1. 商品検索（発売年月で絞り込み）で 2014 年〜来年までの商品一覧（JAN コード）を集める
   ※検索結果は最大 500 件までしか表示されないため、月ごと（必要ならカテゴリ別）に分けて取得する
2. 発売スケジュール（直近・今後の発売週）も一覧に加える
3. 各商品の詳細ページから、商品名・発売時期・価格・種類数・説明・画像を取得する

詳細ページの「この商品が売っているお店」（店舗ごとの取扱状況）は、仕様により収集しない。
"""
from __future__ import annotations

import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date

from bs4 import BeautifulSoup

from common import JsonlWriter, clean, fetch, log, parse_price, parse_year_month

BASE = "https://gashapon.jp/products/"
CATEGORIES = {"2236": "ガシャポン", "2839": "プレミアムガシャポン", "2858": "フラットガシャポン", "2238": "その他"}
LIST_CAP = 500


def list_page(params: str) -> tuple[list[dict], int]:
    url = f"{BASE}result.php?free={params}"
    body, _ = fetch(url)
    if not body:
        return [], 0
    soup = BeautifulSoup(body, "lxml")
    total_el = soup.select_one(".pg-result__total--num")
    total = int(total_el.get_text(strip=True)) if total_el else 0
    items = []
    for a in soup.select(".pg-result__lists a.c-card__link[href*='jan_code=']"):
        jan = re.search(r"jan_code=(\d+)", a["href"]).group(1)
        cat = a.select_one(".c-card__category")
        items.append({"jan": jan, "listCategory": cat.get_text(strip=True) if cat else None, "listUrl": url})
    return items, total


def collect_list() -> dict[str, dict]:
    found: dict[str, dict] = {}
    this_year = date.today().year
    for year in range(this_year + 1, 2013, -1):
        for month in range(1, 13):
            params = f"&sale_year={year}&sale_month={month:02d}"
            items, total = list_page(params)
            if total >= LIST_CAP:
                # 上限に達した月はカテゴリ別に取り直す
                items = []
                for cid in CATEGORIES:
                    sub, sub_total = list_page(params + f"&category%5B%5D={cid}")
                    if sub_total >= LIST_CAP:
                        log(f"⚠ {year}-{month:02d} カテゴリ{cid} が上限 {LIST_CAP} 件に達しました（一部欠落の可能性）")
                    items += sub
            for it in items:
                it["listYearMonth"] = f"{year}-{month:02d}"
                found.setdefault(it["jan"], it)
            if total:
                log(f"一覧 {year}-{month:02d}: {total} 件（累計 {len(found)}）")

    # 発売スケジュール（直近 6 か月・今後の発売週）
    body, _ = fetch("https://gashapon.jp/schedule/")
    months = set(re.findall(r"\?ym=(\d{6})", body or ""))
    for ym in sorted(months):
        b, _ = fetch(f"https://gashapon.jp/schedule/?ym={ym}")
        for jan in re.findall(r"detail\.php\?jan_code=(\d+)", b or ""):
            found.setdefault(jan, {"jan": jan, "listCategory": None, "listUrl": f"https://gashapon.jp/schedule/?ym={ym}"})
    log(f"一覧の取得完了: {len(found)} 件")
    return found


def dd_value(soup: BeautifulSoup, title: str) -> str | None:
    for dl in soup.select("dl.pg-detailDefinition"):
        dt = dl.select_one("dt")
        if dt and title in dt.get_text():
            return clean(dl.select_one("dd").get_text(" "))
    return None


def parse_detail(jan: str, meta: dict) -> dict | None:
    url = f"{BASE}detail.php?jan_code={jan}"
    body, fetched = fetch(url)
    if not body:
        return None
    soup = BeautifulSoup(body, "lxml")
    h1 = soup.select_one("h1.pg-heading")
    name = clean(h1.get_text(" ")) if h1 else None
    if not name:
        return None
    images = []
    for img in soup.select(".pg-detail__picture img"):
        src = img.get("src")
        if src and src not in images:
            images.append(src)
    desc_el = soup.select_one(".pg-detail__description")
    release_text = dd_value(soup, "発売時期")
    price_text = dd_value(soup, "価格")
    return {
        "source": "gashapon.jp",
        "sourceType": "official",
        "maker": "バンダイ",
        "brand": meta.get("listCategory") or "ガシャポン",
        "name": name,
        "series": None,
        "janCode": jan,
        "releaseText": release_text,
        "releaseYearMonth": parse_year_month(release_text) or meta.get("listYearMonth"),
        "releaseDate": None,  # 公式は「第1週」など週単位のため日付は設定しない
        "price": parse_price(price_text),
        "priceText": price_text,
        "priceTaxIncluded": True,
        "lineupCount": dd_value(soup, "種類数"),
        "targetAge": dd_value(soup, "対象年齢"),
        "description": clean(desc_el.get_text("\n")) if desc_el else None,
        "officialUrl": url,
        "imageUrl": images[0] if images else None,
        "imageUrls": images,
        "sourceUrl": url,
        "listSourceUrl": meta.get("listUrl"),
        "fetchedAt": fetched,
    }


def main() -> None:
    writer = JsonlWriter("products_gashapon")
    found = collect_list()
    todo = [(j, m) for j, m in found.items() if f"{BASE}detail.php?jan_code={j}" not in writer.seen]
    log(f"詳細ページ: 未取得 {len(todo)} 件")
    done = 0
    with ThreadPoolExecutor(max_workers=1) as ex:
        for rec in ex.map(lambda jm: parse_detail(*jm), todo):
            done += 1
            if rec:
                writer.write(rec)
            if done % 200 == 0:
                log(f"詳細 {done}/{len(todo)}")
    log("完了:", len(writer.seen), "件")


if __name__ == "__main__":
    sys.exit(main())
