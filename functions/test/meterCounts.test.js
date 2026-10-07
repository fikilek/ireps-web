// UI-R008 and collection-shape-rules/asts.md 10.1.
//
// Two things are tested here, and both are places the road from the meter to
// the screen broke on 7 October 2026.
//
// 1. A meter is created carrying its three counts, all at zero, so that an
//    absent `counts` can only mean something is wrong.
// 2. A change to the counts is visible to whatever has to rebuild the copy.
//    The registry-row trigger returns early unless something it recognises
//    changed; a No Access raises the count and touches nothing else, so before
//    this the row was never rebuilt and the register went on showing the old
//    number while the meter held the new one.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  newMeterCounts,
  readMeterCountsFingerprint,
} from "../registration/meterCounts.js";

test("a new meter carries all three counts at zero", () => {
  assert.deepEqual(newMeterCounts(), {
    disconnections: 0,
    reconnections: 0,
    noAccess: 0,
  });
});

test("a new meter's counts are its own, not a shared object", () => {
  const first = newMeterCounts();
  first.noAccess = 7;

  assert.equal(
    newMeterCounts().noAccess,
    0,
    "two meters created in one transaction must not share one counts object",
  );
});

test("raising any one of the three is visible as a change", () => {
  const before = { counts: { disconnections: 0, reconnections: 0, noAccess: 3 } };

  for (const key of ["disconnections", "reconnections", "noAccess"]) {
    const after = { counts: { ...before.counts, [key]: before.counts[key] + 1 } };

    assert.notEqual(
      readMeterCountsFingerprint(before),
      readMeterCountsFingerprint(after),
      `${key} moved and nothing noticed — this is exactly the 7 October fault`,
    );
  }
});

test("a meter whose counts did not move looks unchanged", () => {
  const meter = { counts: { disconnections: 1, reconnections: 0, noAccess: 4 } };

  assert.equal(
    readMeterCountsFingerprint(meter),
    readMeterCountsFingerprint({ counts: { ...meter.counts } }),
    "an unrelated write must not cause a pointless rebuild",
  );
});

test("a meter with no counts at all reads as zeros rather than throwing", () => {
  assert.equal(readMeterCountsFingerprint({}), "0/0/0");
  assert.equal(readMeterCountsFingerprint(undefined), "0/0/0");
  assert.notEqual(
    readMeterCountsFingerprint({}),
    readMeterCountsFingerprint({ counts: { noAccess: 1 } }),
    "a meter that gains its first count must still look changed",
  );
});

test("every path that creates a meter starts its counts", async () => {
  // The fault this guards is not a wrong value, it is a forgotten place. Three
  // writers create a meter, and a fourth added later would silently produce
  // meters with no counts at all.
  const sources = [
    "../registration/registerMeter.js",
    "../index.js",
  ];

  for (const file of sources) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    const creates = source.split("tx.create(astRef,").length - 1;

    if (creates === 0) continue;

    const initialised = source.split("newMeterCounts()").length - 1;

    assert.ok(
      initialised >= creates,
      `${file} creates a meter ${creates} time(s) but calls newMeterCounts() ${initialised} time(s) — every creation must start the counts`,
    );
  }
});

test("the registry row trigger asks whether the counts moved", async () => {
  const source = await readFile(new URL("../index.js", import.meta.url), "utf8");

  assert.match(
    source,
    /!countsChanged/,
    "onMeterUpdated must not return early when only the counts changed, or the registry row is never rebuilt",
  );
});

test("the one No Access writer stamps the meter it changed", async () => {
  const source = await readFile(
    new URL("../noAccess/recordLifecycleNoAccess.js", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /astPatch\["metadata\.updatedAt"\]/,
    "raising the count without stamping leaves the meter lying about its own age",
  );
});
