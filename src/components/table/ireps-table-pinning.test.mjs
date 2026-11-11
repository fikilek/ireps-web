import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { irepsTablePinnedKeys, irepsTablePinnedLayout } from "./irepsTablePinning.js";

const columns = ["selection", "map", "batchId", "total"].map(key => ({ key }));
test("multiple pins follow displayed order and ignore duplicate or absent keys", () => {
  assert.deepEqual(irepsTablePinnedKeys(columns, { stickyColumnKeys: ["batchId", "map", "selection", "map", "missing"] }), ["selection", "map", "batchId"]);
});
test("single-column pinning and default unpinned tables remain compatible", () => {
  assert.deepEqual(irepsTablePinnedKeys(columns), []);
  assert.deepEqual(irepsTablePinnedKeys(columns, { stickyFirstColumn: true }), ["selection"]);
  assert.deepEqual(irepsTablePinnedKeys(columns, { stickyFirstColumn: true, stickyColumnKey: "batchId" }), ["batchId"]);
  assert.deepEqual(irepsTablePinnedKeys(columns, { stickyFirstColumn: true, stickyColumnKeys: [] }), []);
});
test("measured widths produce adjacent offsets and keyboard clearance, including fractional resizing", () => {
  const keys = ["selection", "map", "batchId"];
  assert.deepEqual(irepsTablePinnedLayout(keys, { selection: 44, map: 56, batchId: 360 }), { offsets: { selection: 0, map: 44, batchId: 100 }, width: 460 });
  assert.deepEqual(irepsTablePinnedLayout(keys, { selection: 40.5, map: 50.25, batchId: 320 }), { offsets: { selection: 0, map: 40.5, batchId: 90.75 }, width: 410.75 });
  assert.deepEqual(irepsTablePinnedLayout([]), { offsets: {}, width: 0 });
});
test("MD BGO opts into three pins and shared heading/filter/body use the same layout", async () => {
  const page = await readFile(new URL("../../pages/operations/MdBgoRegisterPage.jsx", import.meta.url), "utf8");
  assert.match(page, /stickyColumnKeys=\{\["selection", "map", "batchId"\]\}/);
  const shared = await readFile(new URL("./IrepsTable.jsx", import.meta.url), "utf8");
  for (const name of ["pinnedHead", "pinnedFilter", "pinnedCell"]) assert.ok(shared.includes(`pinStyle(column, styles.${name})`));
  assert.match(shared, /viewport.left \+ pinnedLayout.width/);
});

test("page-scrolling pins compensate table movement without viewport-coordinate sticky insets", async () => {
  const shared = await readFile(new URL("./IrepsTable.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(shared, /stickyMetrics\.left/);
  assert.match(shared, /position: "relative"/);
  assert.match(shared, /table\.style\.setProperty\("--ireps-horizontal-offset",/);
  assert.match(shared, /naturalOffsets\[column\.key\]/);
  assert.match(shared, /columnWidths: widths/);
});
