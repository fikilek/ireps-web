import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { NGP_SELECTION_MAX } from "../models/nonGpsBatchPlanningModel.js";

// Non-GPS Street Detail follows the Sales table (Stage A) and rules 18.1.
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("current batch membership has no note under the address; other reasons stay", async () => {
  const detail = await read("./NonGpsStreetDetail.jsx");
  assert.match(detail, /!target\.batchable && target\.batchabilityCode !== "CURRENT_TARGETED_BATCH"\s*\? <div>\{target\.batchabilityReason\}<\/div>/);
  assert.match(detail, /\? target\.batchabilityReason \|\| "Not batchable"/, "the checkbox tooltip keeps every reason");
});

test("the subtitle states the rules' batch size, 1–30", async () => {
  assert.equal(NGP_SELECTION_MAX, 30);
  const detail = await read("./NonGpsStreetDetail.jsx");
  assert.match(detail, /current 1–\{NGP_SELECTION_MAX\} meter batch/);
  assert.doesNotMatch(detail, /1–20/);
});
