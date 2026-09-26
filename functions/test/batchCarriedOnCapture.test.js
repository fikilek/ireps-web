// GMR-R038 (1.6.0): work on a premise that belongs to a batch carries that batch.
//
// The report reads what the transaction holds and invents nothing, so the transaction must say which
// batch it belongs to when it is captured. Until this, a discovery started from the meter card or the
// premise arrived carrying nothing: the report counted work outside batches that never happened, and the
// batch row never learned the meter had been found on it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const indexSource = await readFile(new URL("../index.js", import.meta.url), "utf8");
const reportSource = await readFile(
  new URL("../reports/generalMonthlyReport.js", import.meta.url),
  "utf8",
);

// The capture path: the guard runs, then the batch context is written.
const captureStart = indexSource.indexOf("const targetedBatchValidation =");
const capture = indexSource.slice(
  captureStart,
  indexSource.indexOf("const now = new Date().toISOString();", captureStart),
);

test("what the worker sent still wins", () => {
  // A worker who came from the batch row already carries the checked, canonical context. That is
  // untouched: this only fills the gap where nothing was sent.
  assert.match(capture, /if \(targetedBatchValidation\?\.isTargetedBatch\) \{\s*safePayload\.targetedBatchContext =\s*targetedBatchValidation\.targetedBatchContext;\s*\} else \{/);
});

test("the batch the guard recognised is carried when the phone sent none", () => {
  assert.match(capture, /batchWorkCheck\?\.details\?\.ownRow \|\| batchWorkCheck\?\.details/);
  assert.match(capture, /tbId: recognisedTbId,/);
  assert.match(capture, /rowId:/);
  // Nothing is written when the guard recognised no batch: AD HOC then means what it says.
  assert.match(capture, /if \(recognisedTbId\) \{/);
});

test("an illegal connection carries no batch — the one work rightly outside them", () => {
  // The owner, 26 September: all work is done through batches EXCEPT where there is an illegal
  // connection. A worker on batch work who stumbles across one records it, and that find belongs to
  // them (TB-R062, TB-R063) — not to the team whose ERF it sits on. Stamping that team's batch on it
  // would hand them work they did not do, and would hide the one honest reason for work with no batch.
  assert.match(capture, /const carriesItsBatch = new Set\(\[/);
  const named = capture.slice(capture.indexOf("const carriesItsBatch"), capture.indexOf("const carriesItsRow"));
  for (const code of ["OWN_TEAM", "OWN_SP", "NOT_ALLOCATED", "ERF_FREE", "ROW_COMPLETED", "VISIBLE"]) {
    assert.match(named, new RegExp(`ALLOWED\.${code},`), `${code} is this batch's own work`);
  }
  assert.doesNotMatch(named, /ILLEGAL_CONNECTION/, "an illegal connection never carries a batch");
  // And it is read from the code, not merely from whatever the details happen to hold.
  assert.match(capture, /carriesItsBatch\.has\(batchWorkCheck\?\.code\)/);
});

test("a finished row is named as the batch but not as the row", () => {
  // There is no open work on it for this capture to belong to.
  const forRow = capture.slice(capture.indexOf("const carriesItsRow"), capture.indexOf("const recognised ="));
  assert.doesNotMatch(forRow, /ROW_COMPLETED|VISIBLE/);
  assert.match(capture, /carriesItsRow\.has\(batchWorkCheck\?\.code\) &&/);
});

test("a recognised batch is never dressed up as the batch path the worker did not take", () => {
  assert.match(capture, /recognisedBy: "IREPS"/);
  assert.match(capture, /rule: "GMR-R038"/);
});

test("a recognised batch carries no salesDocId", () => {
  // On an ERF where a different meter was found, the row's Sales meter is NOT the meter being captured.
  // The report looks a salesDocId up in sales-all-meters, so naming one here would point it at the wrong
  // record. tbId is what GMR-R019's control line needs.
  const written = capture.slice(capture.indexOf("if (recognisedTbId) {"));
  assert.doesNotMatch(written, /salesDocId/);
  assert.match(reportSource, /targetedBatchContext\?\.salesDocId/, "the report does read it, when it is there");
});

test("the report still decides AD HOC by what the transaction holds", () => {
  // Nothing in the report changes for this: it reads the context and shows AD HOC when there is none.
  assert.match(reportSource, /targetedBatchContext \|\| \{\}/);
});
