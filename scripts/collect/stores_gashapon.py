"""
ガシャポン公式「ガシャポンどこ？」の店舗検索から、全国の設置店舗を収集する。

gashapon.jp/shop/gplus_list.php が地図表示に使っている店舗検索（getShops.php）を、
都道府県ごとに 1 回ずつ呼び出す。緯度・経度は公式データの値をそのまま使う。

店舗ごとの取扱商品・在庫状況（shop.php）は、仕様により収集しない。
"""
from __future__ import annotations

import json
import sys
import time

import requests

from common import JsonlWriter, USER_AGENT, clean, log, now_iso

API = "https://gashapon.jp/shop/leaflet/getShops.php"
PAGE = "https://gashapon.jp/shop/gplus_list.php"
PREFS = [
    "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県",
    "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県",
    "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県",
    "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県",
    "宮崎県", "鹿児島県", "沖縄県",
]


def to_float(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f != 0 else None


def main() -> None:
    writer = JsonlWriter("stores_gashapon")
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    for pref in PREFS:
        r = s.post(API, data={
            "pref": pref, "free": "", "product_code": "", "gplus_type": "gplus",
            "center_lat": "35.681236", "center_lng": "139.767125", "map_distance_flg": "false",
        }, timeout=60)
        fetched = now_iso()
        r.raise_for_status()
        shops = r.json().get("gplus_data") or []
        for x in shops:
            if str(x.get("delflg", "0")) != "0":
                continue
            code = x.get("shop_code") or f"id{x.get('id')}"
            writer.write({
                "source": "gashapon.jp",
                "sourceType": "official",
                "sourceName": "ガシャポン公式「ガシャポンどこ？」店舗検索",
                "sourceShopCode": code,
                "name": clean(x.get("shop_title")),
                "operator": clean((x.get("agent_title") or "").replace("　", " ")),
                "address": clean(x.get("shop_address")),
                "postalCode": clean(x.get("shop_zip")),
                "phone": clean(x.get("shop_phone")),
                "prefecture": clean(x.get("shop_pref")),
                "lat": to_float(x.get("latitude")),
                "lng": to_float(x.get("longitude")),
                "coordinateSource": "gashapon.jp（公式データ）",
                "openingHours": None,
                "officialUrl": f"https://gashapon.jp/shop/shop.php?shop_code={code}" if x.get("shop_code") else None,
                # 店舗情報の出典（API）。sourceUrl は重複判定のためショップコード単位にする
                "sourceUrl": f"{API}#{code}",
                "sourcePageUrl": PAGE,
                "sourceLastModified": x.get("last_modified"),
                "fetchedAt": fetched,
            })
        log(f"{pref}: {len(shops)} 件")
        time.sleep(1.5)
    log("完了:", len(writer.seen), "件")


if __name__ == "__main__":
    sys.exit(main())
