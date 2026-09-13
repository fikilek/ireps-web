import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DRAFT_HIGHLIGHT_COLOR, DRAFT_HIGHLIGHT_WIDTH, draftReviewStyles } from "./targetedBatchDraftReviewStyles.js";

// Targeted Batch rules 1.3.6: one yellow list–map highlight (TB-R040, 18.3) and
// located meters with no time limit (18.4).
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("the map ring and the row bar use the same yellow and thickness", async () => {
  assert.equal(DRAFT_HIGHLIGHT_COLOR, "#facc15");
  assert.equal(DRAFT_HIGHLIGHT_WIDTH, 5);
  const layers = await read("./sales-batch-map-layers.jsx");
  assert.match(layers, /strokeColor: DRAFT_HIGHLIGHT_COLOR, strokeWeight: DRAFT_HIGHLIGHT_WIDTH/);
  const table = await read("./TargetedBatchDraftTable.jsx");
  assert.match(table, /boxShadow: highlightedId === row\.salesId \? `inset \$\{DRAFT_HIGHLIGHT_WIDTH\}px 0 0 \$\{DRAFT_HIGHLIGHT_COLOR\}` : undefined/);
  assert.doesNotMatch(table, /#dbeafe|outline:/, "no blue fill or outline around the row");
});

test("Meter Number is the one fixed column: header, filter and body cells", async () => {
  assert.deepEqual(draftReviewStyles.fixedFirstColumn, { position: "sticky", left: 0, zIndex: 1 });
  const table = await read("./TargetedBatchDraftTable.jsx");
  assert.match(table, /index === 0 \? \{ \.\.\.styles\.headerCell, left: 0, zIndex: 3 \}/);
  assert.match(table, /<td style=\{\{ \.\.\.styles\.bodyCell, \.\.\.styles\.fixedFirstColumn, boxShadow/);
  assert.equal((table.match(/fixedFirstColumn/g) || []).length, 1, "only the Meter Number body cell is fixed");
  const filters = await read("./TargetedBatchDraftFilters.jsx");
  assert.match(filters, /index === 0 \? \{ \.\.\.styles\.bodyCell, \.\.\.styles\.fixedFirstColumn \}/);
});

test("TB Draft has no location time limit and no 5-second clock", async () => {
  const page = await read("../../TargetedBatchDraftPage.jsx");
  assert.doesNotMatch(page, /setInterval|\btick\b|expiresAt/);
  const model = await read("./sales-batch-draft-model.js");
  assert.doesNotMatch(model, /Location check expired|expiresAt|now >=/);
  const modal = await read("../TargetedBatchConfirmModal.jsx");
  assert.doesNotMatch(modal, /expired/i);
});
