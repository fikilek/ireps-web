// The Operations Dashboard summaries. `UI-R009`.
//
// These pin the property that broke on the owner's phone on 11 October 2026:
// a card read 7 above boxes adding up to 5, because the total counted seven
// states and the boxes drew four. Here every figure is exhaustive and
// `unaccounted` must stay empty, so a state nobody named fails by name
// instead of being counted and drawn nowhere.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ITO_OUT_STATES,
  ITO_TRN_TYPES,
  NAV,
  batchFigures,
  itoFigures,
  summariseBatches,
  summariseIto,
} from "../src/pages/operations/dashboard/operationsSummary.js";

const trn = (workflowState, over = {}) => ({
  workflowState,
  trnType: "METER_DISCONNECTION",
  originChannel: "OFFICE",
  ...over,
});

// Endumeni Ward 6 on DEV at 11 October, read from trns: Kaiser's three
// issued, one accepted, two rejected, nothing completed.
const ward6 = [
  trn("ISSUED"),
  trn("ISSUED"),
  trn("ISSUED"),
  trn("ACCEPTED"),
  trn("REJECTED"),
  trn("REJECTED"),
];

test("the ward's real figures: 4 out, 2 rejected, nothing done", () => {
  const summary = summariseIto(ward6);

  assert.equal(summary.out, 4);
  assert.equal(summary.rejected, 2);
  assert.equal(summary.completed, 0);
  assert.equal(summary.cancelled, 0);
  assert.equal(summary.total, 6);
  assert.deepEqual(summary.unaccounted, []);
});

test("every state a request can be in is placed in a figure", () => {
  // DR-R001 5. If a state is added later and nobody gives it a home, this
  // fails here rather than appearing as a number that does not add up.
  const states = [...ITO_OUT_STATES, "REJECTED", "COMPLETED", "CANCELLED"];
  const summary = summariseIto(states.map((state) => trn(state)));

  assert.deepEqual(summary.unaccounted, [], "a state with no figure");
  assert.equal(
    summary.out + summary.rejected + summary.completed + summary.cancelled,
    summary.total,
    "the figures must account for every row",
  );
});

test("a state nobody named is reported, never dropped", () => {
  const summary = summariseIto([trn("SOMETHING_NEW"), trn("")]);

  assert.deepEqual(summary.unaccounted, ["SOMETHING_NEW", "(no state)"]);
  assert.equal(summary.total, 2);
});

test("field work is not watched, because there is nothing to watch", () => {
  // DR-R001 9: field work is on the device until it is submitted, and it
  // arrives finished. It is read in the TRN Registry, never here.
  const summary = summariseIto([
    trn("COMPLETED", { originChannel: "FIELD" }),
    trn("ISSUED"),
  ]);

  assert.equal(summary.total, 1);
  assert.equal(summary.out, 1);
});

test("only the five lifecycle transactions are the office's individual lane", () => {
  assert.deepEqual(ITO_TRN_TYPES, [
    "METER_DISCONNECTION",
    "METER_RECONNECTION",
    "METER_INSPECTION",
    "METER_REMOVAL",
    "METER_READING",
  ]);

  const summary = summariseIto([
    trn("ISSUED", { trnType: "METER_DISCOVERY" }),
    trn("ISSUED", { trnType: "METER_INSTALLATION" }),
    trn("ISSUED", { trnType: "METER_READING" }),
  ]);

  assert.equal(summary.total, 1);
});

test("a batch lane counts batches in the chosen ward only", () => {
  const batches = [
    { id: "A", status: "IN_PROGRESS", ward: "ZA5241006" },
    { id: "B", status: "COMPLETED", ward: "ZA5241006" },
    { id: "C", status: "NOT_STARTED", ward: "ZA5241007" },
  ];

  const summary = summariseBatches(batches, {
    statusOf: (b) => b.status,
    wardOf: (b) => b.ward,
    wardPcode: "ZA5241006",
  });

  assert.equal(summary.total, 2);
  assert.equal(summary.out, 1);
  assert.equal(summary.completed, 1);
  assert.equal(summary.notStarted, 0);
  assert.deepEqual(summary.unaccounted, []);
});

test("a batch status nobody named is reported too", () => {
  const summary = summariseBatches([{ status: "ALLOCATION_FAILED" }], {
    statusOf: (b) => b.status,
  });

  assert.deepEqual(summary.unaccounted, ["ALLOCATION_FAILED"]);
});

test("nothing loaded reads NAv on every figure, never a row of zeros", () => {
  // Owner, 30 September 2026: nothing out and nothing counted are different
  // facts, and a 0 claims the first when it means the second.
  for (const figure of itoFigures(summariseIto([]), { ready: false })) {
    assert.equal(figure.value, NAV, figure.label);
  }

  for (const figure of batchFigures(summariseBatches([]), { ready: false })) {
    assert.equal(figure.value, NAV, figure.label);
  }
});

test("each lane uses its own words, and no new word is coined", () => {
  // UI-R009 6. ITO says Rejected because that is the request's own state.
  assert.deepEqual(
    itoFigures(summariseIto(ward6)).map((f) => f.label),
    ["Out", "Rejected", "Completed", "Cancelled"],
  );

  assert.deepEqual(
    batchFigures(summariseBatches([])).map((f) => f.label),
    ["In progress", "Not started", "Completed"],
  );
});

test("the rejected figure is the one that asks for attention", () => {
  const rejected = itoFigures(summariseIto(ward6)).find((f) => f.key === "rejected");

  assert.equal(rejected.value, 2);
  assert.equal(rejected.attention, true);
});

test("both normalisers are read, because this screen is fed by two", () => {
  // The registry rows flatten workflowState/originChannel/trnType; the
  // ward-scoped stream keeps the document's own shape. A well that knew only
  // one would count nothing when handed the other and say so with a zero.
  const documentShape = {
    accessData: { trnType: "METER_DISCONNECTION" },
    origin: { channel: "OFFICE" },
    workflow: { state: "REJECTED" },
  };

  const summary = summariseIto([documentShape, trn("ISSUED")]);

  assert.equal(summary.total, 2);
  assert.equal(summary.rejected, 1);
  assert.equal(summary.out, 1);
  assert.deepEqual(summary.unaccounted, []);
});
