// f01: a capture never dies in silence.
//
// The phone shows MISSION SUCCESS when the transaction is written. Everything that makes the capture
// real happens afterwards in onMeterDiscoveryCreated, and when that failed it wrote a log line and
// stopped: the transaction stayed, no meter existed, and nobody was told. The worker walked away
// believing it was done, so the meter went out to somebody again - and the numbers stopped
// balancing, because a transaction with no asset behind it is counted by everything that reads
// transactions and by nothing that reads meters (owner, 2026-09-28).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  plainReason,
  recordCaptureFailure,
} from "../meterDiscovery/captureOutcome.js";

const TRN = "TRN_MDIS_1790555986842_ELC_ZA5241006_1755";

// The smallest Firestore that can be written to, and remember it.
function fakeDb() {
  const writes = [];
  return {
    writes,
    collection: (name) => ({
      doc: (id) => ({
        set: async (data, options) => {
          writes.push({ name, id, data, options });
        },
      }),
    }),
  };
}

test("the capture is told why it never became a meter", async () => {
  const db = fakeDb();

  const result = await recordCaptureFailure({
    db,
    trnId: TRN,
    code: "PREMISE_NOT_FOUND",
    message: "premises/PRM_1 missing",
    details: { premiseId: "PRM_1" },
    now: "2026-09-28T06:00:00.000Z",
  });

  assert.equal(result.recorded, true);
  assert.equal(db.writes.length, 1);

  const [write] = db.writes;
  assert.equal(write.name, "trns");
  assert.equal(write.id, TRN);
  assert.deepEqual(write.options, { merge: true }, "a failure must never replace the capture");

  const failure = write.data.derived.failure;
  assert.equal(failure.code, "PREMISE_NOT_FOUND");
  assert.equal(failure.at, "2026-09-28T06:00:00.000Z");
  assert.deepEqual(failure.details, { premiseId: "PRM_1" });
});

test("the reason is a sentence a person can act on, and our words are kept beside it", () => {
  // The owner, on a refusal that read "Meter Master is already linked to a different AST": those are
  // our words, not a worker's.
  const db = fakeDb();

  return recordCaptureFailure({
    db,
    trnId: TRN,
    code: "METER_MASTER_CONFLICT",
    message: "Meter Master is already linked to a different AST",
  }).then(() => {
    const { failure } = db.writes[0].data.derived;

    assert.equal(
      failure.reason,
      "This meter number is already registered on another meter.",
    );
    assert.equal(
      failure.detail,
      "Meter Master is already linked to a different AST",
      "the message we threw is kept, never in place of the sentence",
    );
  });
});

test("a code nobody wrote a sentence for still says something", () => {
  assert.equal(plainReason("SOMETHING_NEW"), "This capture could not be completed.");
  assert.equal(plainReason("SOMETHING_NEW", "the server's own words"), "the server's own words");
  assert.equal(plainReason(""), "This capture could not be completed.");
});

test("failing to record a failure never replaces it with a worse one", async () => {
  // It is called from the one place that knows the capture is dead. If it threw there, it would take
  // out the log line that was always there and we would know even less than before.
  const angryDb = {
    collection: () => ({
      doc: () => ({
        set: async () => {
          throw new Error("Firestore is having a day");
        },
      }),
    }),
  };

  const result = await recordCaptureFailure({ db: angryDb, trnId: TRN, code: "UNKNOWN" });

  assert.equal(result.recorded, false);
  assert.equal(result.failure.code, "UNKNOWN");
});

test("nothing is written when there is nothing to write it against", async () => {
  const db = fakeDb();

  assert.deepEqual(await recordCaptureFailure({ db, trnId: "" }), { recorded: false });
  assert.deepEqual(await recordCaptureFailure({ db: null, trnId: TRN }), { recorded: false });
  assert.equal(db.writes.length, 0);
});

// ------------------------------------------------------- every way the capture can die says so
const indexSource = await readFile(new URL("../index.js", import.meta.url), "utf8");

const discoveryTrigger = (() => {
  const from = indexSource.indexOf("export const onMeterDiscoveryCreated = onDocumentCreated(");
  const to = indexSource.indexOf("export const onNoAccessRecorded = onDocumentCreated(");
  assert.ok(from > -1 && to > from, "the Meter Discovery trigger has moved");
  return indexSource.slice(from, to);
})();

test("every way this trigger can give up records why first", () => {
  // Seven: no meter details, no meter number, no premise, the premise is gone, the payload failed its
  // checks, the meter type is neither water nor electricity, a governed conflict, and the catch-all.
  const recorded = discoveryTrigger.split("recordCaptureFailure({").length - 1;

  assert.ok(
    recorded >= 7,
    `only ${recorded} of this trigger's failure paths say why; the rest still die in silence`,
  );
});

test("the two returns that are not failures stay quiet", () => {
  // A No Access capture is finished elsewhere and never becomes a meter here, and a transaction of
  // another type is not ours. Neither is a fault, and recording one would fill the office's list
  // with work that is perfectly all right.
  const beforeFirstRecord = discoveryTrigger.slice(
    0,
    discoveryTrigger.indexOf("recordCaptureFailure({"),
  );

  assert.match(beforeFirstRecord, /accessData\?\.trnType !== "METER_DISCOVERY"\) return null;/);
  assert.match(beforeFirstRecord, /accessData\?\.access\?\.hasAccess !== "yes"\) return null;/);
});
