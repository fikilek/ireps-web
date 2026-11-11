import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MD_BGO_PREMISE_ADDRESS_WIDTH, MD_BGO_ROW_COLUMN_OPTIONS, MD_BGO_ROW_DEFAULT_VISIBILITY, mdBgoVisibleRowColumns, mdBgoMeterDetailsId, clearMdBgoHiddenColumnFilter } from "./mdBgoRowsPresentation.js";

test("meter action uses the exact linked meter document and never offers NAv as an action", () => {
  assert.equal(mdBgoMeterDetailsId({ meterNo: "0413863399", meterId: "AST1" }), "AST1");
  for (const row of [{ meterNo: "NAv", meterId: "AST1" }, { meterNo: "0413863399" }, { meterNo: "", meterId: "AST1" }, { meterNo: "0413863399", meterId: "NAv" }]) assert.equal(mdBgoMeterDetailsId(row), null);
});
test("default columns hide BGO Row ID, remove Row State and preserve Meter No", () => {
  const columns = [{ key: "meterNo" }, ...MD_BGO_ROW_COLUMN_OPTIONS];
  const visible = mdBgoVisibleRowColumns(columns, MD_BGO_ROW_DEFAULT_VISIBILITY);
  assert.equal(visible.some(column => column.key === "sourceRowId"), false);
  assert.equal(MD_BGO_ROW_COLUMN_OPTIONS.some(column => column.key === "workflowState"), false);
  assert.ok(visible.some(column => column.key === "progress"));
  assert.equal(mdBgoVisibleRowColumns(columns, { ...MD_BGO_ROW_DEFAULT_VISIBILITY, sourceRowId: true }).length, visible.length + 1);
  assert.equal(mdBgoVisibleRowColumns(columns, { meterNo: false })[0].key, "meterNo");
  assert.equal(MD_BGO_PREMISE_ADDRESS_WIDTH, 320);
});
test("hiding a column removes only that column's filter and leaves the original filters intact", () => {
  const filters = { sourceRowId: "ROW_44", progress: "COMPLETED", $search: "0413" };
  assert.deepEqual(clearMdBgoHiddenColumnFilter(filters, "sourceRowId"), { progress: "COMPLETED", $search: "0413" });
  assert.equal(filters.sourceRowId, "ROW_44");
});
test("page reuses registry meter details, table visibility slots and visible-column downloads", async () => {
  const page = await readFile(new URL("../MdBgoRowsPage.jsx", import.meta.url), "utf8");
  assert.match(page, /MeterDeepDetailsModal from "\.\.\/registries\/components\/MeterDeepDetailsModal"/);
  assert.match(page, /<MeterDeepDetailsModal meterId=\{selectedMeterId\}/);
  assert.match(page, /icon=\{<MeterActionIcon \/>\}/);
  assert.match(page, /columnControls=\{columnControls\}/);
  assert.match(page, /Show \/ Hide Columns/);
  assert.match(page, /columns: columns.map/);
  assert.match(page, /width: MD_BGO_PREMISE_ADDRESS_WIDTH, minWidth: MD_BGO_PREMISE_ADDRESS_WIDTH/);
  assert.doesNotMatch(page, /label: "Row State"/);
});
