import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  SALES_ALL_METERS_CONFLICT_CODES as CODES,
  SALES_ALL_METERS_OUTCOMES as OUTCOMES,
  classifySalesAllMetersSync,
} from "../salesAllMeters/helpers.js";

const METER_ID = "04085345850";

function canonical(overrides = {}) {
  return {
    master: { id: METER_ID, visibility: "INVISIBLE" },
    meterNo: METER_ID,
    meterNoNormalized: METER_ID,
    provider: "conlog",
    customerNo: "101517546",
    accountNo: "101517546",
    totalAmountC: 35000,
    monthlyTotalsC: { "2026-04": 10000, "2026-05": 0, "2026-06": 25000 },
    lastPurchaseAtISO: "2026-06-30T10:15:00+02:00",
    daysSinceLastPurchase: 16,
    ...overrides,
  };
}

const classify = (existing, extra = {}) => classifySalesAllMetersSync({
  meterId: METER_ID,
  existing,
  targetExists: true,
  desiredVisibility: "INVISIBLE",
  sourceWriter: "test",
  ...extra,
});

test("valid matching target is UNCHANGED with no write patch", () => {
  const result = classify(canonical());
  assert.equal(result.outcome, OUTCOMES.UNCHANGED);
  assert.equal(result.patch, null);
});

for (const [name, monthlyTotalsC] of [
  ["null", null],
  ["present undefined", undefined],
  ["array", []],
  ["string", "invalid"],
  ["number", 1],
  ["boolean", true],
]) {
  test(`positive-sales target with ${name} monthly totals returns a governed conflict`, () => {
    let result;
    assert.doesNotThrow(() => {
      result = classify(canonical({
        totalAmountC: 1,
        monthlyTotalsC,
        lastPurchaseAtISO: "2026-06-01T00:00:00Z",
        daysSinceLastPurchase: 1,
      }));
    });
    assert.equal(result.outcome, OUTCOMES.CONFLICT);
    assert.equal(result.code, CODES.GOVERNED_FIELD_TYPE_INVALID);
    assert.ok(result.conflictingPaths.includes("monthlyTotalsC"));
    assert.equal(result.patch, null);
  });
}

test("valid visibility change emits only the bridge-owned dot path", () => {
  const existing = canonical();
  const result = classify(existing, { desiredVisibility: "VISIBLE" });
  assert.equal(result.outcome, OUTCOMES.UPDATED);
  assert.deepEqual(result.patch, { "master.visibility": "VISIBLE" });
  assert.equal(existing.customerNo, "101517546");
  assert.equal(existing.monthlyTotalsC["2026-06"], 25000);
});

test("unsupported desired visibility is a stable conflict with no patch", () => {
  const result = classify(canonical(), { desiredVisibility: "UNKNOWN" });
  assert.equal(result.outcome, OUTCOMES.CONFLICT);
  assert.equal(result.code, CODES.DESIRED_VISIBILITY_INVALID);
  assert.equal(result.patch, null);
  assert.deepEqual(result.conflictingPaths, ["master.visibility"]);
  assert.equal(result.evidence.desiredVisibility, "UNKNOWN");
});

test("non-string desired visibility is a stable conflict with no patch", () => {
  const result = classify(canonical(), { desiredVisibility: 1 });
  assert.equal(result.outcome, OUTCOMES.CONFLICT);
  assert.equal(result.code, CODES.DESIRED_VISIBILITY_INVALID);
  assert.equal(result.patch, null);
  assert.deepEqual(result.conflictingPaths, ["master.visibility"]);
  assert.equal(result.evidence.desiredVisibility, 1);
});

test("missing target preserves governed TARGET_MISSING with no patch", () => {
  const result = classifySalesAllMetersSync({
    meterId: METER_ID, existing: undefined, targetExists: false,
    desiredVisibility: "VISIBLE", sourceWriter: "test",
  });
  assert.equal(result.outcome, OUTCOMES.TARGET_MISSING);
  assert.equal(result.patch, null);
});

const conflictCases = [
  ["noncanonical document ID", canonical(), { meterId: "meter-1" }, CODES.DOCUMENT_ID_NONCANONICAL, "documentId"],
  ["master identity mismatch", canonical({ master: { id: "OTHER", visibility: "INVISIBLE" } }), {}, CODES.IDENTITY_MISMATCH, "master.id"],
  ["normalized identity mismatch", canonical({ meterNoNormalized: "OTHER" }), {}, CODES.IDENTITY_MISMATCH, "meterNoNormalized"],
  ["missing required root", (() => { const value = canonical(); delete value.provider; return value; })(), {}, CODES.CANONICAL_FIELD_MISSING, "provider"],
  ["extra root", canonical({ legacy: true }), {}, CODES.PROHIBITED_FIELD_PRESENT, "legacy"],
  ["prohibited metadata", canonical({ metadata: {} }), {}, CODES.PROHIBITED_FIELD_PRESENT, "metadata"],
  ["unsafe master shape", canonical({ master: { id: METER_ID, visibility: "INVISIBLE", legacy: true } }), {}, CODES.DOCUMENT_SHAPE_UNSAFE, "master"],
  ["missing master ID", canonical({ master: { visibility: "INVISIBLE" } }), {}, CODES.CANONICAL_FIELD_MISSING, "master.id"],
  ["missing visibility", canonical({ master: { id: METER_ID } }), {}, CODES.VISIBILITY_MISSING, "master.visibility"],
  ["non-string visibility", canonical({ master: { id: METER_ID, visibility: 1 } }), {}, CODES.VISIBILITY_TYPE_INVALID, "master.visibility"],
  ["unsupported visibility", canonical({ master: { id: METER_ID, visibility: "UNKNOWN" } }), {}, CODES.VISIBILITY_VALUE_INVALID, "master.visibility"],
  ["wrong governed string type", canonical({ customerNo: null }), {}, CODES.GOVERNED_FIELD_TYPE_INVALID, "customerNo"],
  ["boolean monetary value", canonical({ totalAmountC: true }), {}, CODES.GOVERNED_FIELD_TYPE_INVALID, "totalAmountC"],
  ["unsafe monthly shape", canonical({ monthlyTotalsC: [] }), {}, CODES.GOVERNED_FIELD_TYPE_INVALID, "monthlyTotalsC"],
  ["noncontiguous month range", canonical({ totalAmountC: 35000, monthlyTotalsC: { "2026-04": 10000, "2026-06": 25000 } }), {}, CODES.GOVERNED_FIELD_TYPE_INVALID, "monthlyTotalsC"],
  ["wrong monthly total", canonical({ totalAmountC: 1 }), {}, CODES.GOVERNED_FIELD_TYPE_INVALID, "totalAmountC"],
  ["timestamp-like recency", canonical({ lastPurchaseAtISO: { seconds: 1, nanoseconds: 0 } }), {}, CODES.GOVERNED_FIELD_TYPE_INVALID, "lastPurchaseAtISO"],
];

for (const [name, existing, extra, code, path] of conflictCases) {
  test(`${name} is a stable conflict with evidence and no patch`, () => {
    const result = classify(existing, extra);
    assert.equal(result.outcome, OUTCOMES.CONFLICT);
    assert.equal(result.code, code);
    assert.equal(result.patch, null);
    assert.ok(result.conflictingPaths.includes(path));
    assert.ok(Object.hasOwn(result.evidence, path));
    assert.equal(result.meterId, extra.meterId || METER_ID);
  });
}

test("zero-sales target requires null recency and is canonical", () => {
  const result = classify(canonical({
    totalAmountC: 0,
    monthlyTotalsC: { "2026-04": 0, "2026-05": 0, "2026-06": 0 },
    lastPurchaseAtISO: null,
    daysSinceLastPurchase: null,
  }));
  assert.equal(result.outcome, OUTCOMES.UNCHANGED);
});

test("bridge source uses transaction rereads, exact update, and surfaces fatal failures", async () => {
  const source = await readFile(new URL("../index.js", import.meta.url), "utf8");
  const bridge = source.slice(
    source.indexOf("async function syncSalesAllMetersFromMaster"),
    source.indexOf("export const onMeterDiscoveryCreated"),
  );
  const masterUpdate = source.slice(
    source.indexOf("export const onMeterMasterUpdated"),
    source.indexOf("export const signupFieldWorker"),
  );
  assert.match(bridge, /validateExistingMeterMaster/);
  assert.match(bridge, /classifySalesAllMetersSync/);
  assert.match(bridge, /tx\.update\(salesRef, decision\.patch\)/);
  assert.doesNotMatch(bridge, /tx\.set\(/);
  assert.match(masterUpdate, /const masterSnap = await tx\.get\(masterRef\)/);
  assert.match(masterUpdate, /const salesSnap = await tx\.get\(salesRef\)/);
  assert.match(masterUpdate, /throw error/);
});
