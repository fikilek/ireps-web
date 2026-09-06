import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("canonical Sales API retains monthlyCategories and projects an explicit view month", async () => {
  const source = await readSource("../../../redux/salesApi.js");

  assert.match(source, /normalizeSalesMonthlyCategories\(\s*data\.monthlyCategories\s*,?\s*\)/);
  assert.match(source, /monthlyCategories,/);
  assert.match(source, /projectSalesCategoryMonth\(row, month\)/);
  assert.doesNotMatch(source, /latestCategoryMonth:|governance\.currentData\?\.latestMonth/);
  assert.doesNotMatch(
    source,
    /data\.leakageCategory\s*\|\|\s*data\.Leakage_Category/,
  );
});

test("Targeted Batch Sales reads preserve explicit month and read failure states", async () => {
  const source = await readSource("./salesTargetedBatchReadModel.js");

  assert.match(source, /resolveSalesCategoryForMonth/);
  assert.match(
    source,
    /readError \? null : resolveSalesCategoryForMonth\(sales, month\)/,
  );
  assert.doesNotMatch(
    source,
    /firstText\(sales\?\.leakageCategory\)\s*\|\|\s*SALES_STATS_UNCATEGORISED/,
  );
});
