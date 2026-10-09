// A meter's own counts: how many times each kind of work was actually done on
// it, and how many times nobody could reach it.
//
// `collection-shape-rules/asts.md` 10.1, `DR-R001` 3.2.
//
// WHAT THESE TESTS ARE REALLY GUARDING. Not arithmetic — incrementing a number
// is not where this breaks. It breaks in a FORGOTTEN PLACE. On 7 October 2026
// the counts were raised correctly on the meter, copied correctly onto the
// registry row, and drawn nowhere, because one mapper named the fields it kept
// one at a time and `counts` was not among them. Every meter and every row held
// the right numbers while the page showed 0 for all of them.
//
// On 9 October three more counts were added. The same shape of fault was one
// edit away: three places each named the counts by hand, and a count added to
// two of the three would have been raised and never drawn. So the counts are
// now derived from one list, and most of what follows checks the derivation
// rather than the values.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  COUNT_KEY_BY_TRN_TYPE,
  METER_COUNT_KEYS,
  meterCountKeyForTrnType,
  newMeterCounts,
  readMeterCounts,
  readMeterCountsFingerprint,
} from "../registration/meterCounts.js";

test("a new meter carries every count at zero", () => {
  const counts = newMeterCounts();

  assert.deepEqual(Object.keys(counts).sort(), [...METER_COUNT_KEYS].sort());

  for (const key of METER_COUNT_KEYS) {
    assert.equal(counts[key], 0, `${key} must start at zero`);
  }
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

test("raising any one of them is visible as a change", () => {
  // The trigger compares one string. A count left out of that string is raised
  // on the meter and never reaches the register, which is the 7 October fault.
  const before = readMeterCountsFingerprint({ counts: newMeterCounts() });

  for (const key of METER_COUNT_KEYS) {
    const counts = newMeterCounts();
    counts[key] = 1;

    assert.notEqual(
      readMeterCountsFingerprint({ counts }),
      before,
      `raising ${key} must change the fingerprint, or the registry row is never rebuilt`,
    );
  }
});

test("a meter whose counts did not move looks unchanged", () => {
  const counts = { disconnections: 2, reconnections: 1, inspections: 4, removals: 0, readings: 9, noAccess: 3 };

  assert.equal(
    readMeterCountsFingerprint({ counts }),
    readMeterCountsFingerprint({ counts: { ...counts } }),
    "an unchanged meter must not rebuild its row",
  );
});

test("a meter with no counts at all reads as zeros rather than throwing", () => {
  assert.equal(readMeterCountsFingerprint({}), METER_COUNT_KEYS.map(() => 0).join("/"));
  assert.deepEqual(readMeterCounts({}), newMeterCounts());
  assert.deepEqual(readMeterCounts({ counts: { disconnections: "not a number" } }).disconnections, 0);
});

test("the five kinds of work each raise their own count, and no two share one", () => {
  const expected = {
    METER_DISCONNECTION: "disconnections",
    METER_RECONNECTION: "reconnections",
    METER_INSPECTION: "inspections",
    METER_REMOVAL: "removals",
    METER_READING: "readings",
  };

  assert.deepEqual(COUNT_KEY_BY_TRN_TYPE, expected);

  const raised = Object.values(expected);
  assert.equal(new Set(raised).size, raised.length, "two kinds of work must never raise one count");

  for (const [trnType, key] of Object.entries(expected)) {
    assert.equal(meterCountKeyForTrnType(trnType), key);
    assert.equal(meterCountKeyForTrnType(trnType.toLowerCase()), key, "the type is read however it is cased");
  }
});

test("No Access is not raised by a kind of work", () => {
  // It is raised by an OUTCOME, from the one No Access writer, whatever work
  // was being attempted. A disconnection nobody could reach raises noAccess
  // and not disconnections, because the meter was not disconnected.
  assert.ok(METER_COUNT_KEYS.includes("noAccess"));
  assert.ok(
    !Object.values(COUNT_KEY_BY_TRN_TYPE).includes("noAccess"),
    "no transaction type may raise noAccess by being completed",
  );
  assert.equal(meterCountKeyForTrnType("METER_DISCOVERY"), null);
  assert.equal(meterCountKeyForTrnType(""), null);
  assert.equal(meterCountKeyForTrnType(undefined), null);
});

test("which count a transaction raises is decided in one place", async () => {
  const source = await readFile(new URL("../meterLifecycle/callables.js", import.meta.url), "utf8");

  assert.match(
    source,
    /meterCountKeyForTrnType\(trnType\)/,
    "the lifecycle writer must ask the one well which count to raise",
  );
  assert.ok(
    !/"counts\.(disconnections|reconnections|inspections|removals|readings)"/.test(source),
    "no count may be named by hand here — a sixth transaction type would then be counted nowhere",
  );
});

test("the registry row copies every count the meter carries", async () => {
  const source = await readFile(
    new URL("../registry/meterRegistryRowRebuild.js", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /counts: readMeterCounts\(data\)/,
    "the copy must take every count, not a list written out again here",
  );
  assert.ok(
    !/counts\?\.(disconnections|reconnections|inspections|removals|readings|noAccess)/.test(source),
    "naming the counts one at a time here is how a count gets raised and never drawn",
  );
});

test("every path that creates a meter starts its counts", async () => {
  // The fault this guards is not a wrong value, it is a forgotten place. Three
  // writers create a meter, and a fourth added later would silently produce
  // meters with no counts at all.
  const sources = ["../registration/registerMeter.js", "../index.js"];

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

test("the backfill counts by the same rules the writers use", async () => {
  // This is the script that will be run against LIVE. If it kept its own idea
  // of which work counts, or of which outcome means done, it would write
  // numbers that disagree with every number written afterwards — and the
  // disagreement would look like a data fault rather than a code one.
  const source = await readFile(
    new URL("../scripts/backfillMeterCountsAndNoAccess.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /COUNT_KEY_BY_TRN_TYPE/, "it must use the shared type-to-count map");
  assert.match(source, /outcomeMeansWorkWasDone/, "it must use the shared idea of work being done");
  assert.match(source, /METER_COUNT_KEYS/, "it must write every count, not a list of its own");
  assert.ok(
    !/const COUNTED_WORK/.test(source),
    "a second copy of the map here is how the backfill and the writers drift apart",
  );
  assert.ok(
    !/outcome\(trn\) === "SUCCESS"/.test(source),
    "a reading writes SUCCESSFUL_READING, so a literal SUCCESS check counts no readings at all",
  );
  assert.match(
    source,
    /typeof held\[key\] !== "number"/,
    // Found on DEV on 9 October by the verification, after the pass reported
    // nothing left to do: 146 meters sat at all zeros, so comparing values
    // alone saw no difference, and they kept a three-key counts object with
    // the three new keys simply absent. Absent and zero are different facts,
    // and a pass that only compares values enforces half the rule.
    "a missing key must count as a difference, or a meter at all zeros never gains the new counts",
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
