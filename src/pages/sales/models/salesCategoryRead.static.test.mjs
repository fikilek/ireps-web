import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("canonical Sales API projects monthlyCategories and derives convenience category from the governed map", async () => {
  const source = await readSource("../../../redux/salesApi.js");

  assert.match(source, /normalizeSalesMonthlyCategories\(\s*data\.monthlyCategories\s*,?\s*\)/);
  assert.match(source, /monthlyCategories,/);
  assert.match(source, /latestCategoryMonth:/);
  assert.match(source, /leakageCategory:\s*latestCategory\?\.leakageCategory\s*\|\|\s*""/);
  assert.doesNotMatch(
    source,
    /data\.leakageCategory\s*\|\|\s*data\.Leakage_Category/,
  );
});

test("raw Targeted Batch Sales reads use the governed monthly category resolver", async () => {
  const source = await readSource("./salesTargetedBatchReadModel.js");

  assert.match(source, /resolveLatestSalesCategory/);
  assert.match(
    source,
    /resolveLatestSalesCategory\(sales\)\?\.leakageCategory/,
  );
  assert.doesNotMatch(
    source,
    /firstText\(sales\?\.leakageCategory\)\s*\|\|\s*SALES_STATS_UNCATEGORISED/,
  );
});
