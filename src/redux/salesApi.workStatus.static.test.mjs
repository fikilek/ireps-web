import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./salesApi.js", import.meta.url), "utf8");
const normalizeSalesRow = source.match(
  /function normalizeSalesRow[\s\S]*?(?=\nfunction sortSalesRows)/,
)?.[0];

test("Sales normalization selects one raw tbRefs source by canonical presence", () => {
  assert.equal(
    source.match(
      /const rawTbRefs = data\.tbRefs !== undefined \? data\.tbRefs : data\.TbRefs;/g,
    )?.length,
    1,
  );
  assert.match(normalizeSalesRow, /tbRefs: normalizeTbRefs\(rawTbRefs\)/);
  assert.match(
    normalizeSalesRow,
    /tbRefsIntegrity: inspectSalesTbRefsIntegrity\(rawTbRefs\)/,
  );
  assert.doesNotMatch(normalizeSalesRow, /data\.tbRefs \|\| data\.TbRefs/);
});

test("Sales normalization projects strict flat masterVisibility only", () => {
  assert.match(
    normalizeSalesRow,
    /masterVisibility:\s*typeof data\?\.master\?\.visibility === "string"\s*\? data\.master\.visibility\s*: null/,
  );
  assert.doesNotMatch(normalizeSalesRow, /^\s+master:/m);
  assert.doesNotMatch(normalizeSalesRow, /\.\.\.data/);
});
