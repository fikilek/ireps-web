// The Operations Dashboard summaries. `UI-R009`.
//
// These pin the property that broke on the owner's phone on 11 October 2026:
// a card read 7 above boxes adding up to 5, because the total counted seven
// states and the boxes drew four. Here every state lands in a figure or is
// named out loud, and `unaccounted` must stay empty.
//
// They also pin the fault in the FIRST build of this card, which showed
// 0 0 0 0 for a ward that held work: the shape it was handed carried no
// origin channel, so its office-channel filter matched nothing and it
// printed zeros. A 0 must never mean "not counted".
import test from "node:test";
import assert from "node:assert/strict";

import {
  ITO_ACCEPTED_STATES,
  ITO_ISSUED_STATES,
  ITO_TRN_TYPES,
  NAV,
  batchFigures,
  itoAside,
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

// Endumeni Ward 6 on DEV at 11 October, read from trns: three issued, one
// accepted, two rejected, nothing completed.
const ward6 = [
  trn("ISSUED"),
  trn("ISSUED"),
  trn("ISSUED"),
  trn("ACCEPTED"),
  trn("REJECTED"),
  trn("REJECTED"),
];

test("the ward's real figures: 3 issued, 1 accepted, 2 rejected, 0 completed", () => {
  const summary = summariseIto(ward6);

  assert.equal(summary.issued, 3);
  assert.equal(summary.accepted, 1);
  assert.equal(summary.rejected, 2);
  assert.equal(summary.completed, 0);
  assert.equal(summary.cancelled, 0);
  assert.equal(summary.total, 6);
  assert.deepEqual(summary.unaccounted, []);
});

test("the four figures are the request's own words, as on the worker's phone", () => {
  // Owner, 11 October: "thats similar to mobile .. we just dont have
  // progress" - because nothing is written between accepted and done on this
  // path (DR-R001 5).
  assert.deepEqual(
    itoFigures(summariseIto(ward6)).map((f) => f.label),
    ["Issued", "Accepted", "Rejected", "Completed"],
  );
});

test("every state a request can be in lands in a figure", () => {
  // DR-R001 5. A state added later with no home fails here, by name, rather
  // than appearing as numbers that do not add up.
  const states = [
    ...ITO_ISSUED_STATES,
    ...ITO_ACCEPTED_STATES,
    "REJECTED",
    "COMPLETED",
    "CANCELLED",
  ];

  const summary = summariseIto(states.map((state) => trn(state)));

  assert.deepEqual(summary.unaccounted, [], "a state with no figure");
  assert.equal(
    summary.issued + summary.accepted + summary.rejected + summary.completed + summary.cancelled,
    summary.total,
    "the figures must account for every row",
  );
});

test("a reassigned job is waiting to be accepted, so it counts as issued", () => {
  // The server returns a reassign to ISSUED under the new worker's name, so
  // nothing should rest here - but it is the same question either way.
  const summary = summariseIto([trn("REASSIGNED"), trn("ISSUED")]);

  assert.equal(summary.issued, 2);
  assert.deepEqual(summary.unaccounted, []);
});

test("cancelled is counted and said in words, never given a tile and never dropped", () => {
  const summary = summariseIto([...ward6, trn("CANCELLED"), trn("CANCELLED")]);

  assert.equal(summary.cancelled, 2);
  assert.equal(
    itoFigures(summary).some((f) => f.key === "cancelled"),
    false,
    "four figures, not five",
  );
  assert.deepEqual(itoAside(summary), ["2 cancelled"]);
  assert.deepEqual(itoAside(summariseIto(ward6)), [], "nothing to say when there are none");
});

test("rows read and none counted says so, because that is not nothing out", () => {
  // The fault in the first build: normalizeTrnDoc carried no origin channel,
  // so every row was filtered out and the card printed 0 0 0 0 for a ward
  // that held work. A 0 claims "nothing out" when it means "nothing counted".
  const summary = summariseIto([
    { workflowState: "ISSUED", trnType: "METER_DISCONNECTION" },
    { workflowState: "ACCEPTED", trnType: "METER_DISCONNECTION" },
  ]);

  assert.equal(summary.considered, 2);
  assert.equal(summary.total, 0);
  assert.deepEqual(itoAside(summary), ["2 read, none of it office work"]);
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
  assert.equal(summary.issued, 1);
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

test("both normalisers are read, because this screen is fed by two", () => {
  // The registry rows flatten workflowState/originChannel/trnType; the
  // ward-scoped stream keeps the document's own shape.
  const documentShape = {
    accessData: { trnType: "METER_DISCONNECTION" },
    origin: { channel: "OFFICE" },
    workflow: { state: "REJECTED" },
  };

  const summary = summariseIto([documentShape, trn("ISSUED")]);

  assert.equal(summary.total, 2);
  assert.equal(summary.rejected, 1);
  assert.equal(summary.issued, 1);
  assert.deepEqual(summary.unaccounted, []);
});

test("the ward stream's normaliser now carries what this screen reads", async () => {
  // Pinning the fix at its source: without originChannel on that shape the
  // filter matches nothing and the card is a row of zeros.
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/redux/trnsApi.js", import.meta.url), "utf8");
  const normaliser = source.slice(source.indexOf("function normalizeTrnDoc"));

  assert.match(normaliser.slice(0, 3000), /originChannel: getRegistryOriginChannel\(data\)/);
  assert.match(normaliser.slice(0, 3000), /wardPcode: valueOrNav\(data\.accessData\?\.parents\?\.wardPcode\)/);
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

test("the rejected figure is the one that asks for attention", () => {
  const rejected = itoFigures(summariseIto(ward6)).find((f) => f.key === "rejected");

  assert.equal(rejected.value, 2);
  assert.equal(rejected.attention, true);
});
