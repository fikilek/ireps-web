// The Meter Registry does not read the meter, and it does not read the registry
// row document either. Every row passes through normalizeMeterRegistryRow,
// which names the fields it keeps ONE AT A TIME. So a field written to the
// meter and copied onto the row is still invisible until it is named there.
//
// On 7 October that is exactly what happened: 49 meters carried counts, all 49
// of their registry rows carried the same numbers, and the page showed 0 for
// every one of them, because `counts` was not in that list. Nothing failed,
// because a missing count and a count of zero render identically.
//
// These tests lock the hop. asts.md 10.1 and DR-SCH-009 are the rules.
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeMeterRegistryRow } from "../src/redux/meterRegistryRowModel.js";

const ROW = {
  meterNo: "04085348386",
  meterType: "electricity",
  statusState: "DISCONNECTED",
  erfId: "G423T0IR0775000053580000",
  erfNo: "5358",
  premiseId: "PRM_1",
  premiseAddress: "30 Protea Street",
  parents: { lmPcode: "ZA5241", wardPcode: "W006" },
  counts: { disconnections: 1, reconnections: 0, noAccess: 3 },
  metadata: { updatedAt: "2026-10-07T10:06:10.000Z", updatedByUser: "Simo Phemba" },
};

test("the three counts survive the hop from the row document to the page", () => {
  const row = normalizeMeterRegistryRow("AST_1", ROW);

  assert.deepEqual(
    row.counts,
    { disconnections: 1, reconnections: 0, noAccess: 3 },
    "the Credit control columns read row.counts; if this is dropped they all print 0",
  );
});

test("each number the Meter Registry shows is reachable by the key it uses", () => {
  const row = normalizeMeterRegistryRow("AST_1", ROW);

  // These are the exact reads in MetersRegistryPage's readMeterCount.
  assert.equal(row?.counts?.disconnections, 1);
  assert.equal(row?.counts?.reconnections, 0);
  assert.equal(row?.counts?.noAccess, 3);
});

test("a meter with no counts at all is not dressed up as a meter with none", () => {
  const row = normalizeMeterRegistryRow("AST_2", { ...ROW, counts: undefined });

  // Nothing recorded and nothing delivered are different facts. The mapper
  // must not invent zeros here: under asts.md 10.1 a meter is created with all
  // three at 0, so an absent counts object is a defect to be seen, not a meter
  // that nothing has happened to.
  assert.equal(row.counts, null, "absent must stay distinguishable from zero");
});

test("the fields the page reads are all carried, not only the counts", () => {
  const row = normalizeMeterRegistryRow("AST_1", ROW);

  for (const key of [
    "meterNo",
    "meterType",
    "statusState",
    "erfId",
    "erfNo",
    "premiseId",
    "premiseAddress",
    "wardPcode",
    "updatedAt",
    "counts",
  ]) {
    assert.ok(
      key in row,
      `${key} is read by the Meter Registry and must be named in normalizeMeterRegistryRow`,
    );
  }
});
