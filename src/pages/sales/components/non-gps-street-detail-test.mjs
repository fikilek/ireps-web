import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { NGP_SELECTION_MAX } from "../models/nonGpsBatchPlanningModel.js";
import { REASONS_SHOWN_IN_COLUMNS } from "../models/sales-table-meter-note.js";

// Non-GPS Street Detail follows the Sales table (Stage A) and rules 18.1.
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("batch and work-status reasons have no note under the address; other reasons stay", async () => {
  const detail = await read("./NonGpsStreetDetail.jsx");
  assert.match(detail, /import \{ REASONS_SHOWN_IN_COLUMNS \} from "\.\.\/models\/sales-table-meter-note";/, "same list as the GPS Sales Table");
  assert.match(detail, /!target\.batchable && !REASONS_SHOWN_IN_COLUMNS\.has\(target\.batchabilityCode\)\s*\? <div>\{target\.batchabilityReason\}<\/div>/);
  assert.match(detail, /\? target\.batchabilityReason \|\| "Not batchable"/, "the checkbox tooltip keeps every reason");
  for (const code of ["CURRENT_TARGETED_BATCH", "SALES_STATUS_IN_PROGRESS", "SALES_STATUS_COMPLETED"]) assert.ok(REASONS_SHOWN_IN_COLUMNS.has(code), code);
  assert.ok(!REASONS_SHOWN_IN_COLUMNS.has("NEEDS_MANUAL_ERFING"), "the Needs manual ERFing flag stays visible (TB-R041)");
});

test("Quick select sits under Select, sorts by address ascending and ticks through the page", async () => {
  const detail = await read("./NonGpsStreetDetail.jsx");
  const quick = await read("./NonGpsQuickSelect.jsx");
  const page = await read("../NonGpsBatchPlanningPage.jsx");
  assert.match(detail, /<th style=\{styles\.filterCell\}>\s*<NonGpsQuickSelect\s+onApply=\{handleQuickSelect\}/, "first filter cell, under Select");
  assert.match(detail, /QUICK_SELECT_SORT = Object\.freeze\(\{ key: "address", direction: "asc" \}\)/);
  assert.match(detail, /sortTargets\(\s*filterTargets\(street\.targets, filters, searchText\),\s*QUICK_SELECT_SORT,\s*\)/, "same filters as the table");
  assert.match(detail, /setSortConfig\(QUICK_SELECT_SORT\);\s*setPage\(1\);/, "the table shows the order it ticked");
  assert.match(quick, /const PRESET_COUNTS = \[5, 10, 20, 30\];/);
  assert.match(quick, /max = NGP_SELECTION_MAX/);
  assert.match(quick, />\s*OK\s*</);
  assert.match(page, /onQuickSelect=\{quickSelectStreet\}/);
  assert.match(page, /quickSelectNgpStreetTargets\(\{\s*selectedIds: activeSelectedIds,/);
});

test("the subtitle states the rules' batch size, 1–30", async () => {
  assert.equal(NGP_SELECTION_MAX, 30);
  const detail = await read("./NonGpsStreetDetail.jsx");
  assert.match(detail, /current 1–\{NGP_SELECTION_MAX\} meter batch/);
  assert.doesNotMatch(detail, /1–20/);
});
