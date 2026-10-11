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
  ITO_CREATED_STATES,
  ITO_ISSUED_STATES,
  ITO_TRN_TYPES,
  NAV,
  batchFigures,
  itoAside,
  itoFigures,
  summariseBatches,
  sumFigures,
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
  trn("CREATED", { workflow: { rejections: [{ uid: "u1", name: "Kaiser" }] } }),
  trn("CREATED", { workflow: { rejections: [{ uid: "u1", name: "Kaiser" }] } }),
];

test("the ward's figures after the machine: created, issued, accepted, completed", () => {
  // DR-R001 5, 11 October 2026. A refusal is no longer a state, so the job
  // it happened to is in CREATED waiting to be given out again - and
  // `Created` takes the tile `Rejected` used to hold.
  const summary = summariseIto(ward6);

  assert.equal(summary.created, 2, "the two he refused are back in the pool");
  assert.equal(summary.issued, 3);
  assert.equal(summary.accepted, 1);
  assert.equal(summary.completed, 0);
  assert.equal(summary.total, 6);
  assert.deepEqual(summary.unaccounted, []);
});

test("the four tiles are the four places a job can be sitting", () => {
  assert.deepEqual(
    itoFigures(summariseIto(ward6)).map((f) => f.label),
    ["Created", "Issued", "Accepted", "Completed"],
  );
});

test("a refusal is counted as something that happened, outside the total", () => {
  // It is not a place work sits, so it has no tile and is said in words.
  const summary = summariseIto(ward6);

  assert.equal(summary.refusals, 2);
  assert.equal(itoFigures(summary).some((f) => f.key === "rejected"), false);
  assert.deepEqual(itoAside(summary), ["2 refusals"]);
  assert.equal(sumFigures(itoFigures(summary)), summary.total, "the tiles still add to the total");
});

test("one refusal is said in the singular", () => {
  const one = summariseIto([trn("CREATED", { workflow: { rejections: [{ uid: "u1" }] } })]);

  assert.deepEqual(itoAside(one), ["1 refusal"]);
});

test("a job refused twice counts twice", () => {
  const twice = summariseIto([
    trn("CREATED", { workflow: { rejections: [{ uid: "u1" }, { uid: "u2" }] } }),
  ]);

  assert.equal(twice.refusals, 2);
  assert.equal(twice.created, 1, "but it is one job, in one place");
});

test("a record rejected before the list existed still counts as one refusal", () => {
  // Records rejected before 11 October 2026 carry a single reason on the
  // document and no list. One known refusal is one; an unknown number is
  // never guessed at.
  const legacy = summariseIto([trn("REJECTED", { rejectReason: "Dog on the property" })]);

  assert.equal(legacy.refusals, 1);

  const nav = summariseIto([trn("CREATED", { rejectReason: "NAv" })]);

  assert.equal(nav.refusals, 0, "NAv is an absence, not a refusal");
});

test("every state a job can be in lands in a figure", () => {
  const states = [...ITO_CREATED_STATES, ...ITO_ISSUED_STATES, ...ITO_ACCEPTED_STATES, "COMPLETED"];
  const summary = summariseIto(states.map((state) => trn(state)));

  assert.deepEqual(summary.unaccounted, [], "a state with no figure");
  assert.equal(
    summary.created + summary.issued + summary.accepted + summary.completed,
    summary.total,
    "the figures must account for every row",
  );
});

test("a deleted job is in no figure and in no total", () => {
  // DR-R001 5.5: every reader excludes DELETED, or deleted work quietly
  // reappears in the numbers.
  const summary = summariseIto([trn("ISSUED"), trn("DELETED"), trn("DELETED")]);

  assert.equal(summary.total, 1);
  assert.equal(summary.issued, 1);
  assert.deepEqual(summary.unaccounted, []);
});

test("there is no in-progress on this path, and one would surface as a fault", () => {
  assert.deepEqual(ITO_ACCEPTED_STATES, ["ACCEPTED"]);

  const summary = summariseIto([trn("IN_PROGRESS")]);

  assert.equal(summary.accepted, 0, "never quietly folded into accepted");
  assert.deepEqual(summary.unaccounted, ["IN_PROGRESS"], "it shows, as the fault it would be");
});

test("a reassigned record still reads as issued until it is migrated", () => {
  // A reassign lands in ISSUED, so nothing should rest here - but records
  // written before 11 October 2026 may still carry it.
  assert.equal(summariseIto([trn("REASSIGNED")]).issued, 1);
});

test("a state nobody named is reported, never dropped", () => {
  const summary = summariseIto([trn("SOMETHING_NEW"), trn("")]);

  assert.deepEqual(summary.unaccounted, ["SOMETHING_NEW", "(no state)"]);
  assert.equal(summary.total, 2);
});

test("field work is not watched, because there is nothing to watch", () => {
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
  const documentShape = {
    accessData: { trnType: "METER_DISCONNECTION" },
    origin: { channel: "OFFICE" },
    workflow: { state: "CREATED" },
  };

  const summary = summariseIto([documentShape, trn("ISSUED")]);

  assert.equal(summary.total, 2);
  assert.equal(summary.created, 1);
  assert.equal(summary.issued, 1);
  assert.deepEqual(summary.unaccounted, []);
});

test("the ward stream's normaliser now carries what this screen reads", async () => {
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

test("Created is the figure that asks for attention", () => {
  // It is where everything that came back is waiting for somebody to act.
  const created = itoFigures(summariseIto(ward6)).find((f) => f.key === "created");

  assert.equal(created.value, 2);
  assert.equal(created.attention, true);
});

test("a lane card's Total is the sum of the tiles drawn on it", () => {
  // Owner, 11 October 2026. Summing the figures themselves makes it true by
  // construction - a figure added or renamed moves the total with it.
  const summary = summariseIto([
    trn("CREATED"), trn("CREATED"),
    trn("ISSUED"), trn("ISSUED"), trn("ISSUED"), trn("ISSUED"),
    trn("ACCEPTED"),
    trn("COMPLETED"), trn("COMPLETED"),
  ]);

  const figures = itoFigures(summary);

  assert.deepEqual(figures.map((f) => f.value), [2, 4, 1, 2]);
  assert.equal(sumFigures(figures), 9);
  assert.equal(sumFigures(figures), summary.total, "and it equals the rows counted");
});

test("a lane that cannot count reads NAv, never 0", () => {
  // A 0 there would read as "nothing in this lane" when it means "nothing
  // counted" - the distinction this screen exists to keep.
  assert.equal(sumFigures(itoFigures(summariseIto([]), { ready: false })), NAV);
  assert.equal(sumFigures(batchFigures(summariseBatches([]), { ready: false })), NAV);
  assert.equal(sumFigures([]), NAV);
  assert.equal(sumFigures(null), NAV);
});

test("a refusal is in no tile, so it is in no card total either", () => {
  const summary = summariseIto([
    trn("ISSUED"),
    trn("CREATED", { workflow: { rejections: [{ uid: "u1" }] } }),
  ]);

  assert.equal(sumFigures(itoFigures(summary)), 2, "two jobs, two places");
  assert.equal(summary.refusals, 1, "and one thing that happened");
  assert.deepEqual(itoAside(summary), ["1 refusal"]);
});
