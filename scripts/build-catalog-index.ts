/**
 * 収集データ（data/collected）から、Firestore に投入する予定の内容をローカルのファイルに書き出す。
 *
 *   npm run catalog:build            # 出力先: .catalog-build/（Git 管理外）
 *
 * **Firestore には接続しない・書き込まない。** 投入前の確認（件数・ID の重複・索引のサイズ）用。
 * 出力:
 *   products/{id}.json は作らず、products.jsonl（1 行 1 ドキュメント）
 *   locations.jsonl
 *   catalogIndex/meta.json, catalogIndex/products-NNN.json, catalogIndex/locations-NNN.json
 *   summary.json（件数・シャードのサイズ・ID 重複など）
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type CollectedLocation,
  type CollectedProduct,
  toGachaProduct,
  toLocation,
} from "../src/lib/catalog/collected";
import {
  SHARD_MAX_BYTES,
  locationShardId,
  productShardId,
  splitIntoShards,
  toCatalogProduct,
} from "../src/lib/catalog/index-format";
import { releaseStatusOf } from "../src/lib/release";

const ROOT = path.resolve(__dirname, "..");
const SRC = process.env.COLLECTED_DATA_DIR ?? path.join(ROOT, "data", "collected");
const OUT = path.join(ROOT, ".catalog-build");

async function main() {
  const rawProducts = JSON.parse(await readFile(path.join(SRC, "products.json"), "utf8")) as CollectedProduct[];
  const rawLocations = JSON.parse(await readFile(path.join(SRC, "locations.json"), "utf8")) as CollectedLocation[];

  const products = rawProducts.map(toGachaProduct);
  const locations = rawLocations.map(toLocation);

  const dup = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
  const productIdDuplicates = dup(products.map((p) => p.id));
  const locationIdDuplicates = dup(locations.map((l) => l.id));
  const badIds = [...products, ...locations].map((x) => x.id).filter((id) => !/^[A-Za-z0-9_-]{1,120}$/.test(id));

  const productShards = splitIntoShards(products.map(toCatalogProduct));
  const locationShards = splitIntoShards(locations);
  const shardSizes = (shards: unknown[][]) => shards.map((s) => Buffer.byteLength(JSON.stringify({ items: s }), "utf8"));

  await rm(OUT, { recursive: true, force: true });
  await mkdir(path.join(OUT, "catalogIndex"), { recursive: true });
  await writeFile(path.join(OUT, "products.jsonl"), products.map((p) => JSON.stringify(p)).join("\n") + "\n");
  await writeFile(path.join(OUT, "locations.jsonl"), locations.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const version = new Date().toISOString();
  await writeFile(
    path.join(OUT, "catalogIndex", "meta.json"),
    JSON.stringify({
      version,
      productShards: productShards.length,
      locationShards: locationShards.length,
      productCount: products.length,
      locationCount: locations.length,
      updatedAt: version,
    }),
  );
  await Promise.all([
    ...productShards.map((items, i) =>
      writeFile(path.join(OUT, "catalogIndex", `${productShardId(i)}.json`), JSON.stringify({ items })),
    ),
    ...locationShards.map((items, i) =>
      writeFile(path.join(OUT, "catalogIndex", `${locationShardId(i)}.json`), JSON.stringify({ items })),
    ),
  ]);

  const status: Record<string, number> = {};
  for (const p of products) status[releaseStatusOf(p)] = (status[releaseStatusOf(p)] ?? 0) + 1;
  const summary = {
    note: "ローカル出力のみ（Firestore には接続していない）",
    products: products.length,
    locations: locations.length,
    locationsWithoutCoordinates: locations.filter((l) => l.lat === null).length,
    productsWithoutPrice: products.filter((p) => p.price === null).length,
    productsWithoutReleaseMonth: products.filter((p) => p.releaseMonth === null).length,
    productsWithResale: products.filter((p) => p.resaleMonth !== null).length,
    releaseStatus: status,
    productIdDuplicates,
    locationIdDuplicates,
    invalidIds: badIds,
    shardMaxBytes: SHARD_MAX_BYTES,
    productShardBytes: shardSizes(productShards),
    locationShardBytes: shardSizes(locationShards),
    /** 一覧・検索 1 回の索引読み込みに必要な Firestore 読み取り件数（meta + シャード） */
    readsPerCatalogLoad: 1 + productShards.length + locationShards.length,
  };
  await writeFile(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  if (productIdDuplicates.length || locationIdDuplicates.length || badIds.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
