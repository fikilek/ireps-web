import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { needsManualErfing, salesDraftChipGroups } from "./sales-batch-draft-model.js";

// Targeted Batch rules 1.3.14: Ward chips with bulk remove (TB-R038); Create Batch next to
// Satellite and "Now create the batch" after the geofence (TB-R040).
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("chips: one per Ward, then Needs manual ERFing and Not located; the last group cannot be removed", () => {
  const rows = [
    { salesId: "A", scope: { wardPcode: "ZA5241006", wardNumber: "6" } }, { salesId: "B", scope: { wardPcode: "ZA5241002" } },
    { salesId: "C", scope: { wardPcode: "ZA5241006" } }, { salesId: "D", code: "NO_EXACT_POSITION", reason: "Needs manual ERFing — NO_EXACT_POSITION" },
    { salesId: "E", code: "NEEDS_MANUAL_ERFING", reason: "Needs manual ERFing — MULTIPLE_ERFS" }, { salesId: "F", reason: "Not located yet. Press Locate meters again." },
  ];
  const groups = salesDraftChipGroups(rows);
  assert.deepEqual(groups.map(g => [g.label, g.salesIds, g.removable]), [
    ["W6", ["A", "C"], true], ["W2", ["B"], true], ["Needs manual ERFing", ["D", "E"], true], ["Not located", ["F"], true]]);
  assert.deepEqual(salesDraftChipGroups([rows[0], rows[2]]).map(g => [g.label, g.removable]), [["W6", false]], "the only group left has no ×");
  assert.deepEqual(salesDraftChipGroups([]), []);
  assert.equal(needsManualErfing({ code: "MULTIPLE_ERFS" }), true);
  assert.equal(needsManualErfing({ reason: "Needs manual ERFing — NO_ERF" }), true);
  assert.equal(needsManualErfing({ code: "RESOLUTION_REQUIRED", reason: "Not located yet." }), false);
});

test("the chip row sits above the list, confirms, and replaces the Keep Ward buttons", async () => {
  const review = await read("../TargetedBatchDraftReview.jsx");
  assert.match(review, /const chips = salesDraftChipGroups\(model\.rows\);/);
  assert.match(review, /window\.confirm\(`Remove the \$\{count\} \$\{group\.title\} meter/);
  assert.match(review, /\{group\.removable && <button/);
  assert.match(review, /<div style=\{\{ flex: "1 1 360px", minWidth: 0 \}\}>\{chipRow\}<TargetedBatchDraftTable/);
  assert.doesNotMatch(review, /Keep \{group\.label\}|aria-label="Keep one Ward"/);
});

test("Create Batch is next to Satellite, not in the page header; the Geofence Created window offers Now create the batch", async () => {
  const review = await read("../TargetedBatchDraftReview.jsx");
  assert.doesNotMatch(review, />Create<\/button>/, "no Create button in the page header");
  assert.match(review, /createDisabled=\{busy \|\| !model\.canCreate\}/);
  const workspace = await read("./sales-batch-geofence-workspace.jsx");
  assert.match(workspace, /onClick=\{onCreate\} disabled=\{createDisabled\}>Create Batch<\/button>/);
  assert.match(workspace, /extraActions=\{createBatchButton\}/);
  assert.match(workspace, /label: "Now create the batch"/);
  assert.match(workspace, /onClick: \(\) => \{ setCreateSuccess\(null\); onCreate\(\); \}/);
  assert.match(workspace, /successAction=\{successAction\}/);
  const shared = await read("../../geofence-shared-ui.jsx");
  const satellite = shared.indexOf('{mapTypeId === "roadmap" ? "Satellite" : "Map"}');
  assert.ok(satellite > 0 && shared.indexOf("{extraActions}") > satellite, "extra actions come right after Satellite");
  assert.match(shared, /\{successAction \? "Later" : "OK"\}/, "the Geo-Fences page keeps its plain OK");
});
