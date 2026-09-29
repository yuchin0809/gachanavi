"""
その他のカプセルトイメーカー公式サイトの商品を収集する。

- SO-TA（スタジオソータ）      : https://www.so-ta.com/products/capsuletoy/
- トイズスピリッツ             : http://www.toysp.co.jp/info{年}.html
- ブシカプ！（ブシロードクリエイティブ）: https://capsule.bushiroad-creative.com/product/
- スタンド・ストーンズ          : https://stasto.co.jp/products_ss-sitemap.xml
- Qualia（クオリア）            : https://www.qualia-45.jp/product/view/{id}

詳細ページの仕様表（dt/dd・th/td）から、商品名・発売時期・価格・種類数・JAN を取り出す。
Qualia の詳細ページにある「販売店舗マップ」（商品ごとの取扱店）は、仕様により収集しない。
"""
from __future__ import annotations

import re
import sys

from bs4 import BeautifulSoup

from common import JsonlWriter, abs_url, clean, fetch, log, parse_full_date, parse_price, parse_year_month

LABELS = {
    "name": ["商品名"],
    "release": ["発売日", "発売月", "発売予定月", "発売時期", "発売予定"],
    "price": ["価格（税込）", "価格(税込)", "価格", "希望小売価格", "販売価格"],
    "lineup": ["種類", "種類数"],
    "jan": ["JANコード", "JAN"],
    "age": ["対象年齢"],
    "size": ["サイズ"],
    "seller": ["発売元"],
}


def spec_table(root) -> dict[str, str]:
    out: dict[str, str] = {}
    for dt in root.select("dt, th"):
        dd = dt.find_next_sibling(["dd", "td"])
        k, v = clean(dt.get_text(" ")), clean(dd.get_text(" ")) if dd else None
        if k and v and k not in out and len(k) <= 12:
            out[k] = v
    return out


def pick(spec: dict[str, str], key: str) -> str | None:
    for label in LABELS[key]:
        if spec.get(label):
            return spec[label]
    return None


def og(soup: BeautifulSoup, prop: str) -> str | None:
    el = soup.select_one(f'meta[property="og:{prop}"]')
    return clean(el.get("content")) if el and el.get("content") else None


def make_record(*, source: str, maker: str, url: str, list_url: str, fetched: str, name: str,
                spec: dict[str, str], images: list[str], description: str | None,
                series: str | None = None, tags: list[str] | None = None,
                release_text: str | None = None, price_text: str | None = None) -> dict:
    release_text = release_text or pick(spec, "release")
    price_text = price_text or pick(spec, "price")
    lineup = pick(spec, "lineup")
    if not lineup and price_text:
        m = re.search(r"全\s*\d+\s*種", price_text)
        lineup = m.group(0) if m else None
    jan = pick(spec, "jan")
    jan = re.sub(r"\D", "", jan) if jan else None
    return {
        "source": source,
        "sourceType": "official",
        "maker": maker,
        "seller": pick(spec, "seller"),
        "brand": None,
        "name": re.sub(r"\s+", " ", name).strip(),
        "series": series,
        "tags": tags or [],
        "janCode": jan or None,
        "releaseText": release_text,
        "releaseYearMonth": parse_year_month(release_text),
        "releaseDate": parse_full_date(release_text),
        "price": parse_price(re.sub(r"全\s*\d+\s*種", "", price_text or "")),
        "priceText": price_text,
        "priceTaxIncluded": True if price_text and "税込" in price_text else None,
        "lineupCount": lineup,
        "size": pick(spec, "size"),
        "targetAge": pick(spec, "age"),
        "description": description,
        "officialUrl": url,
        "imageUrl": images[0] if images else None,
        "imageUrls": images,
        "sourceUrl": url,
        "listSourceUrl": list_url,
        "fetchedAt": fetched,
    }


def uniq(xs):
    out = []
    for x in xs:
        if x and x not in out:
            out.append(x)
    return out


# ---------------------------------------------------------------- SO-TA
def sota(writer: JsonlWriter) -> None:
    base = "https://www.so-ta.com/products/capsuletoy/"
    first, _ = fetch(base, use_cache=False)
    last = max([int(p) for p in re.findall(r"/capsuletoy/page/(\d+)/", first or "")] or [1])
    urls = []
    for p in range(1, last + 1):
        body, _ = fetch(base if p == 1 else f"{base}page/{p}/", use_cache=p != 1)
        urls += re.findall(r'href="(https://www\.so-ta\.com/products_detail/capsuletoy/[^"]+)"', body or "")
    urls = uniq(urls)
    log(f"SO-TA: {len(urls)} 件")
    for u in urls:
        if u in writer.seen:
            continue
        body, fetched = fetch(u)
        if not body:
            continue
        soup = BeautifulSoup(body, "lxml")
        spec = spec_table(soup)
        title = og(soup, "title") or ""
        name = re.sub(r"\s*-\s*スタジオソータ公式.*$", "", title)
        if not name:
            continue
        imgs = uniq([abs_url(u, i.get("src")) for i in soup.select("main img, article img, .products_detail img, .slider img")
                     if i.get("src") and "/uploads/" in i.get("src")])
        desc = None
        for sel in [".products_detail_txt", ".txt", ".detail_txt", ".entry-content"]:
            el = soup.select_one(sel)
            if el and len(el.get_text(strip=True)) > 20:
                desc = clean(el.get_text("\n"))
                break
        # サイト共通メニューの「SERIES」「CREATOR」などはシリーズ名ではないため使わない
        writer.write(make_record(source="so-ta.com", maker="SO-TA", url=u, list_url=base, fetched=fetched, name=name,
                                 spec=spec, images=imgs, description=desc))
    log("SO-TA: 完了")


# ---------------------------------------------------------------- トイズスピリッツ
def toysp(writer: JsonlWriter) -> None:
    urls = []
    idx, _ = fetch("http://www.toysp.co.jp/index.html", use_cache=False)
    years = sorted(set(re.findall(r"info(\d{4})\.html", idx or "")) | {"2025", "2026"})
    for y in years:
        lst = f"http://www.toysp.co.jp/info{y}.html"
        body, _ = fetch(lst, use_cache=False)
        for h in re.findall(r'href="([^"]*?/?\d{4}[a-z0-9_]+\.html)"', body or ""):
            urls.append((abs_url(lst, h), lst))
    seen = set()
    urls = [(u, l) for u, l in urls if not (u in seen or seen.add(u))]
    log(f"トイズスピリッツ: {len(urls)} 件")
    for u, lst in urls:
        if u in writer.seen:
            continue
        body, fetched = fetch(u)
        if not body:
            continue
        soup = BeautifulSoup(body, "lxml")
        art = soup.select_one("main article")
        h2 = art.select_one("h2") if art else None
        if not h2:
            continue
        name = clean(h2.get_text(" "))
        text = clean(art.get_text("\n")) or ""
        price = re.search(r"([0-9,０-９]+\s*円[^\n]*)", text)
        rel = re.search(r"(20\d{2}\s*年\s*\d{1,2}\s*月[^\n]*)", text)
        jan = re.search(r"JANコード\s*[:：]\s*([0-9]+)", text)
        spec = {"JANコード": jan.group(1)} if jan else {}
        imgs = uniq([abs_url(u, i.get("src")) for i in art.select("img")])
        desc_el = art.select_one(".img-text1 p")
        desc = clean(desc_el.get_text("\n")) if desc_el else None
        writer.write(make_record(source="toysp.co.jp", maker="トイズスピリッツ", url=u, list_url=lst, fetched=fetched,
                                 name=name, spec=spec, images=imgs, description=desc,
                                 release_text=clean(rel.group(1)) if rel else None,
                                 price_text=clean(price.group(1)) if price else None))
    log("トイズスピリッツ: 完了")


# ---------------------------------------------------------------- ブシカプ！
def bushikap(writer: JsonlWriter) -> None:
    base = "https://capsule.bushiroad-creative.com/product/"
    urls, page = [], 1
    while True:
        body, _ = fetch(base if page == 1 else f"{base}?pagenum={page}", use_cache=False)
        found = re.findall(r'href="(https://capsule\.bushiroad-creative\.com/product/\d+/)"', body or "")
        new = [u for u in found if u not in urls]
        if not new:
            break
        urls += new
        page += 1
    log(f"ブシカプ！: {len(urls)} 件（{page - 1} ページ）")
    for u in urls:
        if u in writer.seen:
            continue
        body, fetched = fetch(u)
        if not body:
            continue
        soup = BeautifulSoup(body, "lxml")
        main = soup.select_one("main") or soup
        spec = spec_table(main)
        title = og(soup, "title") or ""
        name = re.sub(r"｜商品情報｜.*$", "", title)
        if not name:
            continue
        imgs = uniq([og(soup, "image")] + [abs_url(u, i.get("src")) for i in main.select("img") if "/uploads/" in (i.get("src") or "")])
        desc = None
        for sel in [".product__description", ".product__text", ".product__lead"]:
            el = main.select_one(sel)
            if el and el.get_text(strip=True):
                desc = clean(el.get_text("\n"))
                break
        cat = main.select_one(".product__title, .product__series, .product__category")
        writer.write(make_record(source="capsule.bushiroad-creative.com", maker="ブシロードクリエイティブ", url=u,
                                 list_url=base, fetched=fetched, name=name, spec=spec, images=imgs, description=desc))
    log("ブシカプ！: 完了")


# ---------------------------------------------------------------- スタンド・ストーンズ
def stasto(writer: JsonlWriter) -> None:
    sm = "https://stasto.co.jp/products_ss-sitemap.xml"
    body, _ = fetch(sm, use_cache=False)
    urls = uniq(re.findall(r"<loc>(https://stasto\.co\.jp/products_ss/[^<]+)</loc>", body or ""))
    log(f"スタンド・ストーンズ: {len(urls)} 件")
    for u in urls:
        if u in writer.seen:
            continue
        b, fetched = fetch(u)
        if not b:
            continue
        soup = BeautifulSoup(b, "lxml")
        spec = spec_table(soup)
        name = pick(spec, "name")
        if not name:
            h = soup.select_one("h1, h2")
            name = clean(h.get_text(" ")) if h else None
        if not name:
            continue
        series = uniq([clean(a.get_text()) for a in soup.select('.term_cat a[href*="/cat_product/series_all/"]')])
        chars = uniq([clean(a.get_text()) for a in soup.select('.term_cat a[href*="/cat_product/charactor_all/"]')])
        tags = uniq([clean(a.get_text()) for a in soup.select('a[rel~="tag"]')])
        imgs = uniq([og(soup, "image")] + [abs_url(u, i.get("src")) for i in soup.select("article img, .entry-content img, main img")
                                           if "/uploads/" in (i.get("src") or "")])
        desc = None
        for sel in [".entry-content > p", "article p"]:
            el = soup.select_one(sel)
            if el and len(el.get_text(strip=True)) > 10:
                desc = clean(el.get_text("\n"))
                break
        writer.write(make_record(source="stasto.co.jp", maker="スタンド・ストーンズ", url=u, list_url=sm, fetched=fetched,
                                 name=name, spec=spec, images=imgs, description=desc,
                                 series=series[0] if series else None, tags=chars + tags))
    log("スタンド・ストーンズ: 完了")


# ---------------------------------------------------------------- Qualia
def qualia(writer: JsonlWriter) -> None:
    top, _ = fetch("https://www.qualia-45.jp/", use_cache=False)
    ids = [int(i) for i in re.findall(r"/product/view/(\d+)", top or "")]
    max_id = max(ids or [0]) + 30
    log(f"Qualia: ID 1〜{max_id} を確認")
    for pid in range(max_id, 0, -1):
        u = f"https://www.qualia-45.jp/product/view/{pid}"
        if u in writer.seen:
            continue
        body, fetched = fetch(u)
        if not body:
            continue
        soup = BeautifulSoup(body, "lxml")
        spec = spec_table(soup)
        name = pick(spec, "name")
        if not name:
            continue
        imgs = uniq([abs_url(u, i.get("src")) for i in soup.select("img")
                     if "/media/" in (i.get("src") or "")])
        writer.write(make_record(source="qualia-45.jp", maker="Qualia", url=u, list_url="https://www.qualia-45.jp/",
                                 fetched=fetched, name=name, spec=spec, images=imgs, description=None))
        if pid % 100 == 0:
            log(f"Qualia: ID {pid}")
    log("Qualia: 完了")


# ---------------------------------------------------------------- Jドリーム
def jdream(writer: JsonlWriter) -> None:
    """
    Jドリームは個別ページに仕様が載っていないため、商品一覧ページの各商品の仕様欄から取得する。
    プライズ（クレーンゲーム景品）も扱うメーカーのため、「全○種 ○○円」のカプセルトイ形式の価格があるものだけを採用する。
    """
    base = "https://e-jdream.co.jp/product/"
    page = 1
    while True:
        url = base if page == 1 else f"{base}page/{page}/"
        body, fetched = fetch(url, use_cache=page != 1)
        if not body:
            break
        soup = BeautifulSoup(body, "lxml")
        items = [d for d in soup.select("div.product-slider__item") if "商品名" in d.get_text()]
        if not items:
            break
        for item in items:
            spec = spec_table(item)
            name = pick(spec, "name")
            price = spec.get("価格")
            if not name or not price or not re.search(r"全\s*\d+\s*種", price) or not re.search(r"\d+\s*円", price):
                continue
            jan = re.sub(r"\D", "", spec.get("JANコード") or "")
            im = item.select_one(".product-slider__img img")
            img = im.get("src") if im else None
            rec = make_record(source="e-jdream.co.jp", maker="Jドリーム", url=base, list_url=url, fetched=fetched,
                              name=name, spec=spec, images=[img] if img else [], description=None,
                              release_text=spec.get("販売予定") or pick(spec, "release"), price_text=price)
            # 個別ページに仕様が無いため、情報源は一覧ページ（商品は JAN コードで識別）
            rec["sourceUrl"] = f"{base}#jan={jan}" if jan else f"{base}#name={name}"
            writer.write(rec)
        page += 1
    log(f"Jドリーム: 完了（{page - 1} ページ）")


# ---------------------------------------------------------------- アイピーフォー
def ip4(writer: JsonlWriter) -> None:
    top = "https://www.ip4.co.jp/cupsuletoy_top/"
    body, _ = fetch(top, use_cache=False)
    months = sorted(set(re.findall(r"search_date=(\d{6})", body or "")), reverse=True)
    items: list[tuple[str, str, str]] = []
    for ym in months:
        lst = f"{top}?search_date={ym}"
        b, _ = fetch(lst, use_cache=ym < "202607")
        for u in re.findall(r'href="(https://www\.ip4\.co\.jp/cupsuletoy/[^"]+/)"', b or ""):
            if u not in [i[0] for i in items]:
                items.append((u, lst, f"{ym[:4]}年{int(ym[4:])}月"))
    log(f"アイピーフォー: {len(items)} 件（{len(months)} か月分）")
    for u, lst, month_text in items:
        if u in writer.seen:
            continue
        b, fetched = fetch(u)
        if not b:
            continue
        soup = BeautifulSoup(b, "lxml")
        h1 = soup.select_one("section h1")
        if not h1:
            continue
        chara = h1.select_one("span")
        chara_text = clean(chara.get_text()) if chara else None
        if chara:
            chara.extract()
        name = clean(h1.get_text(" "))
        if not name:
            continue
        read = soup.select_one(".data-read")
        text = clean(read.get_text("\n")) if read else ""
        lineup = re.search(r"全\s*\d+\s*種", text)
        cash = soup.select_one(".cash")
        price_text = clean(cash.get_text(" ")) if cash else None
        imgs = uniq([og(soup, "image")] + [i.get("src") for i in soup.select("article img") if "/uploads/" in (i.get("src") or "")])
        rec = make_record(source="ip4.co.jp", maker="アイピーフォー", url=u, list_url=lst, fetched=fetched,
                          name=f"{chara_text} {name}" if chara_text and chara_text not in name else name,
                          spec={"種類": lineup.group(0)} if lineup else {}, images=imgs, description=None,
                          tags=[chara_text] if chara_text else [], release_text=month_text,
                          price_text=price_text.replace("価格：", "") if price_text else None)
        rec["releaseText"] = f"{month_text}（公式サイトの月別一覧による）"
        writer.write(rec)
    log("アイピーフォー: 完了")


# ---------------------------------------------------------------- トイズキャビン
def toyscabin(writer: JsonlWriter) -> None:
    lst = "https://toyscabin.com/product/"
    body, _ = fetch(lst, use_cache=False)
    soup = BeautifulSoup(body or "", "lxml")
    n = 0
    for a in soup.select("#dataArea .textCase a[href]"):
        u = abs_url(lst, a["href"])
        lines = [clean(x) for x in a.get_text("\n").split("\n") if clean(x)]
        if len(lines) < 2 or u in writer.seen:
            continue
        b, fetched = fetch(u)
        dsoup = BeautifulSoup(b or "", "lxml")
        # 一覧では長い商品名が「…」で省略されるため、詳細ページの「Project：商品名 価格」「Client：発売月 JAN CODE」を使う
        tb, rb = dsoup.select_one("#titleBase"), dsoup.select_one("#releaseBase")
        title_line = clean(re.sub(r"^Project[：:]", "", tb.get_text(" ").strip())) if tb else lines[0]
        release_line = clean(re.sub(r"^Client[：:]", "", rb.get_text(" ").strip())) if rb else lines[1]
        m = re.match(r"^(.*?)[\s　]*([0-9,]+円.*)$", title_line or "")
        name, price_text = (clean(m.group(1)), m.group(2)) if m else (title_line, None)
        jan = re.search(r"JAN\s*CODE\s*[:：]\s*(\d+)", release_line or "")
        desc_el = dsoup.select(".textFrame > p")[-1] if dsoup.select(".textFrame > p") else None
        imgs = uniq([abs_url(u, i.get("src")) for i in dsoup.select(".imgFrame img")])
        writer.write(make_record(source="toyscabin.com", maker="トイズキャビン", url=u, list_url=lst, fetched=fetched,
                                 name=name, spec={"JANコード": jan.group(1)} if jan else {}, images=imgs,
                                 description=clean(desc_el.get_text("\n")) if desc_el and desc_el.get("id") is None else None,
                                 release_text=re.sub(r"[\s　]*JAN.*$", "", release_line or ""), price_text=price_text))
        n += 1
    log(f"トイズキャビン: {n} 件")


SITES = {"toyscabin": toyscabin, "sota": sota, "toysp": toysp, "bushikap": bushikap, "stasto": stasto, "qualia": qualia, "jdream": jdream, "ip4": ip4}


def main() -> None:
    targets = sys.argv[1:] or list(SITES)
    for t in targets:
        SITES[t](JsonlWriter(f"products_{t}"))


if __name__ == "__main__":
    sys.exit(main())
