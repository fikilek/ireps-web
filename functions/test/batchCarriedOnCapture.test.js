// GMR-R038 (1.6.0): work on a premise that belongs to a batch carries that batch.
//
// The report reads what the transaction holds and invents nothing, so the transaction must say which
// batch it belongs to when it is captured. Until this, work started from the meter card or the premise
// arrived carrying nothing: the report counted work outside batches that never happened, and the batch
// row never learned the meter had been found on it.
//
// The owner's rule, 2026-09-26: all work is done through batches EXCEPT where there is an illegal
// connection. That exception is why this decision is made from the guard's CODE rather than from
// whatever its details happen to hold.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ALLOWED, recognisedBatchContext } from "../targetedBatches/batch-work-guard.js";

const TB = "TGB_20260926_051829_DXRI";
const ROW = `${TB}__R006`;
const ERF = "ERF_1751";
const PREMISE = "PRM_1751";

const allowed = (code, details = {}) => ({ allowed: true, code, details });

test("a discovery on the worker's own batch premise carries the batch and the row", () => {
  const carried = recognisedBatchContext({
    decision: allowed(ALLOWED.OWN_TEAM, { tbId: TB, rowId: ROW }),
    erfId: ERF,
    premiseId: PREMISE,
  });

  assert.deepEqual(carried, {
    tbId: TB,
    rowId: ROW,
    erfId: ERF,
    premiseId: PREMISE,
    recognisedBy: "IREPS",
    rule: "GMR-R038",
  });
});

test("a different meter at the worker's own batched ERF carries that ERF's row", () => {
  // TB-R063's case: the batch expected one meter, the worker captured another at the same ERF.
  const carried = recognisedBatchContext({
    decision: allowed(ALLOWED.ERF_FREE, { ownRow: { tbId: TB, rowId: ROW, erfId: ERF } }),
    premiseId: PREMISE,
  });

  assert.equal(carried.tbId, TB);
  assert.equal(carried.rowId, ROW);
  assert.equal(carried.erfId, ERF, "the ERF is taken from the row when the caller has none");
});

test("an illegal connection carries no batch — the one work rightly outside them", () => {
  // The gate let an illegally connected meter through at ANOTHER team's ERF. That find belongs to
  // whoever made it (TB-R062, TB-R063). Naming the other team's batch would hand them work they did not
  // do, and would hide the one honest reason for a transaction with no batch.
  const gate = allowed(ALLOWED.ILLEGAL_CONNECTION, {
    erfId: ERF,
    // The refused batch's own details travel with it, and must not be mistaken for the worker's batch.
    refusedBy: { tbId: TB, rowId: ROW, erfId: ERF },
    tbId: TB,
  });

  assert.equal(recognisedBatchContext({ decision: gate, erfId: ERF, premiseId: PREMISE }), null);
});

test("a finished row, or a meter already found, names the batch but not the row", () => {
  // There is no open work on it for this capture to belong to.
  for (const code of [ALLOWED.ROW_COMPLETED, ALLOWED.VISIBLE]) {
    const carried = recognisedBatchContext({
      decision: allowed(code, { tbId: TB, rowId: ROW }),
      erfId: ERF,
      premiseId: PREMISE,
    });

    assert.equal(carried.tbId, TB, `${code} still names its batch`);
    assert.equal(carried.rowId, null, `${code} does not name a row`);
  }
});

test("a batch nobody has been given still names its row", () => {
  const carried = recognisedBatchContext({
    decision: allowed(ALLOWED.NOT_ALLOCATED, { tbId: TB, rowId: ROW }),
    erfId: ERF,
  });

  assert.equal(carried.tbId, TB);
  assert.equal(carried.rowId, ROW);
  assert.equal(carried.premiseId, null);
});

test("nothing is carried when there is no batch to carry", () => {
  assert.equal(recognisedBatchContext(), null);
  assert.equal(recognisedBatchContext({ decision: null }), null);
  // Allowed because the ERF holds no batch at all.
  assert.equal(recognisedBatchContext({ decision: allowed(ALLOWED.ERF_FREE, { ownRowCount: 0 }) }), null);
  // Allowed because the meter is in no batch.
  assert.equal(recognisedBatchContext({ decision: allowed(ALLOWED.NO_BATCH, {}) }), null);
  // Several of the worker's own rows on one ERF: the flats case. Naming one would credit the wrong row.
  assert.equal(recognisedBatchContext({ decision: allowed(ALLOWED.ERF_FREE, { ownRowCount: 2 }) }), null);
  // A refusal is never a reason to carry a batch.
  assert.equal(
    recognisedBatchContext({
      decision: { allowed: false, code: "METER_IN_ANOTHER_TEAMS_BATCH", details: { tbId: TB } },
    }),
    null,
  );
});

test("a recognised batch never carries a salesDocId", () => {
  // Where a different meter was found, the row's Sales meter is NOT the meter being captured, and the
  // report looks that id up in sales-all-meters. Naming one would point it at the wrong record.
  const carried = recognisedBatchContext({
    decision: allowed(ALLOWED.OWN_TEAM, { tbId: TB, rowId: ROW, salesAllMeterId: "04297704464" }),
    erfId: ERF,
  });

  assert.equal(carried.salesDocId, undefined);
  assert.equal(Object.keys(carried).sort().join(","), "erfId,premiseId,recognisedBy,rowId,rule,tbId");
});

// ---------------------------------------------------------------- every capture asks the same question
const indexSource = await readFile(new URL("../index.js", import.meta.url), "utf8");
const lifecycleSource = await readFile(new URL("../meterLifecycle/callables.js", import.meta.url), "utf8");
const commissioningSource = await readFile(new URL("../commissioning/callable.js", import.meta.url), "utf8");
const reportSource = await readFile(new URL("../reports/generalMonthlyReport.js", import.meta.url), "utf8");

test("every guarded capture carries its batch, by the one decision", () => {
  // Meter Discovery and Meter Installation, both in index.js.
  assert.equal((indexSource.match(/recognisedBatchContext\(\{/g) || []).length, 2);
  // Inspection, disconnection, reconnection and removal.
  assert.match(lifecycleSource, /recognisedBatchContext\(\{/);
  // Commissioning.
  assert.match(commissioningSource, /recognisedBatchContext\(\{/);
});

test("what the worker sent still wins, everywhere", () => {
  assert.match(indexSource, /if \(targetedBatchValidation\?\.isTargetedBatch\) \{/);
  assert.match(indexSource, /if \(!safePayload\.targetedBatchContext\) \{/);
  assert.match(lifecycleSource, /existingTrn\?\.targetedBatchContext\s*\?\s*null/);
  assert.match(commissioningSource, /if \(!cleanTrn\.targetedBatchContext\) \{/);
});

test("the report still decides AD HOC by what the transaction holds", () => {
  // Nothing in the report changes for any of this: it reads the context and shows AD HOC when there is
  // none — which, after the owner's rule, an illegal-connection find rightly is.
  assert.match(reportSource, /targetedBatchContext \|\| \{\}/);
});
