import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  SALES_ALL_METERS_CONFLICT_CODES as CODES,
  SALES_ALL_METERS_OUTCOMES as OUTCOMES,
  classifySalesAllMetersSync,
  deriveSalesAllMetersVisibilityFromMaster,
} from "../salesAllMeters/helpers.js";

const METER_ID = "04085345850";

function canonical(overrides = {}) {
  return {
    master: { id: METER_ID, visibility: "INVISIBLE" },
    meterNo: METER_ID,
    meterNoNormalized: METER_ID,
    provider: "conlog",
    lmPcode: "ZA5241",
    customerNo: "101517546",
    accountNo: "101517546",
    totalAmountC: 35000,
    monthlyTotalsC: { "2026-04": 10000, "2026-05": 0, "2026-06": 25000 },
    lastPurchaseAtISO: "2026-06-30T10:15:00+02:00",
    daysSinceLastPurchase: 16,
    ...overrides,
  };
}

function contour(overrides = {}) {
  const monthlySalesC = { "2026-04": 10000, "2026-05": 0, "2026-06": 25000 };
  const monthlyUnits = { "2026-04": 25.5, "2026-05": 0, "2026-06": 62.25 };
  return {
    ...canonical({
      provider: "contour",
      lastPurchaseAtISO: null,
      daysSinceLastPurchase: null,
    }),
    lmPcode: "ZA5241",
    accountNumber: "101517546",
    customerName: "TEST CUSTOMER",
    sourceFileName: "source.jsonl",
    sourceRow: 10,
    totalSalesC: 35000,
    monthlySalesC,
    monthlyUnits,
    totalUnits: 87.75,
    sourceDocumentId: METER_ID,
    sourceDocumentPath: "source.jsonl",
    sourceEndRow: 10,
    accountNumberNormalized: "101517546",
    customerSurname: "TEST",
    addressLine1: "1 TEST STREET",
    addressLine2: "",
    town: "DUNDEE",
    postalAddress1: "",
    postalAddress2: "",
    postalAddressTown: "",
    standNumber: "100",
    tariffInstance: "PREPAID",
    installationDate: "",
    previousMeterNumber: "",
    previousInstallationDate: "",
    leakageCategory: "",
    riskTier: "",
    riskScore: 0,
    salesPeriodFrom: "2026-04",
    salesPeriodTo: "2026-06",
    erfCandidateCount: 0,
    gpsMatchStatus: "NO_MATCH",
    hasUsableGps: false,
    elmAccountMatched: true,
    elmSourceRows: [],
    erfCandidates: [],
    erfNumbers: [],
    missingErfNumbers: [],
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

test("Contour rich monthly target passes with null recency despite positive sales", () => {
  const result = classify(contour());
  assert.equal(result.outcome, OUTCOMES.UNCHANGED);
  assert.equal(result.patch, null);
});

test("Contour operational roots are accepted but never included in bridge patch", () => {
  const timestamp = { seconds: 1786200000, nanoseconds: 0 };
  const existing = contour({
    tbRefs: [{ id: "TGB_1", date: timestamp }],
    geofenceRefs: [{ id: "GF_1", name: "Zone 1" }],
  });
  const result = classify(existing, { desiredVisibility: "VISIBLE" });
  assert.equal(result.outcome, OUTCOMES.UPDATED);
  assert.deepEqual(result.patch, { "master.visibility": "VISIBLE" });
  assert.equal(existing.tbRefs[0].id, "TGB_1");
  assert.equal(existing.geofenceRefs[0].id, "GF_1");
});

test("unknown additive root is forward-compatible", () => {
  const result = classify(contour({ futureCommercialField: { version: 1 } }));
  assert.equal(result.outcome, OUTCOMES.UNCHANGED);
  assert.equal(result.patch, null);
});

test("lmPcode is a mandatory protected Sales All field", () => {
  const missing = contour();
  delete missing.lmPcode;
  const missingResult = classify(missing);
  assert.equal(missingResult.outcome, OUTCOMES.CONFLICT);
  assert.ok(missingResult.conflictingPaths.includes("lmPcode"));

  const blankResult = classify(contour({ lmPcode: " " }));
  assert.equal(blankResult.outcome, OUTCOMES.CONFLICT);
  assert.ok(blankResult.conflictingPaths.includes("lmPcode"));

  const wrongTypeResult = classify(contour({ lmPcode: 5241 }));
  assert.equal(wrongTypeResult.outcome, OUTCOMES.CONFLICT);
  assert.ok(wrongTypeResult.conflictingPaths.includes("lmPcode"));
});

test("arbitrary provider is rejected while contour is governed", () => {
  assert.equal(classify(contour()).outcome, OUTCOMES.UNCHANGED);
  const result = classify(contour({ provider: "arbitrary" }));
  assert.equal(result.outcome, OUTCOMES.CONFLICT);
  assert.ok(result.conflictingPaths.includes("provider"));
});

test("Contour positive sales may not fabricate recency", () => {
  const result = classify(contour({
    lastPurchaseAtISO: "2026-06-30T10:15:00+02:00",
    daysSinceLastPurchase: 1,
  }));
  assert.equal(result.outcome, OUTCOMES.CONFLICT);
  assert.ok(result.conflictingPaths.includes("lastPurchaseAtISO"));
  assert.ok(result.conflictingPaths.includes("daysSinceLastPurchase"));
});

test("visibility derivation requires both operational AST and sales links", () => {
  assert.equal(deriveSalesAllMetersVisibilityFromMaster({ refs: { asts: { id: "AST_1" }, sales: { id: METER_ID } } }), "VISIBLE");
  assert.equal(deriveSalesAllMetersVisibilityFromMaster({ refs: { asts: { id: "AST_1" }, sales: { id: "" } } }), "INVISIBLE");
  assert.equal(deriveSalesAllMetersVisibilityFromMaster({ refs: { asts: { id: "" }, sales: { id: METER_ID } } }), "INVISIBLE");
  assert.equal(deriveSalesAllMetersVisibilityFromMaster({ refs: { asts: { id: "" }, sales: { id: "" } } }), "INVISIBLE");
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


const ts = (seconds = 1786200000) => ({ seconds, nanoseconds: 0 });

test("tbRefs absent and empty are valid", () => {
  assert.equal(classify(contour()).outcome, OUTCOMES.UNCHANGED);
  assert.equal(classify(contour({ tbRefs: [] })).outcome, OUTCOMES.UNCHANGED);
});

test("initial tbRef with id/date is valid", () => {
  const result = classify(contour({ tbRefs: [{ id: "TGB_ABC", date: ts() }] }));
  assert.equal(result.outcome, OUTCOMES.UNCHANGED);
});

test("IN_PROGRESS tbRef lifecycle is valid including no-access and null premise", () => {
  const result = classify(contour({
    tbRefs: [{
      id: "TGB_ABC",
      date: ts(),
      rowId: "TBR_ABC_000001",
      fieldWork: {
        status: "IN_PROGRESS",
        premiseId: null,
        meterId: null,
        trnId: null,
        meterMatch: null,
        submittedAt: null,
        updatedAt: ts(1786200100),
        noAccess: [{ date: "2026-08-08", time: "20:15:30", user: "Test User" }],
      },
    }],
  }));
  assert.equal(result.outcome, OUTCOMES.UNCHANGED);
});

test("COMPLETED tbRef lifecycle is valid", () => {
  const result = classify(contour({
    tbRefs: [{
      id: "TGB_ABC",
      date: ts(),
      rowId: "TBR_ABC_000001",
      fieldWork: {
        status: "COMPLETED",
        outcomeCode: "METER_DISCOVERED",
        outcomeLabel: "Meter Discovered",
        targetedMeterNo: METER_ID,
        discoveredMeterNo: METER_ID,
        meterMatch: true,
        premiseId: "PREM_1",
        meterId: "AST_1",
        trnId: "TRN_MDIS_1",
        submittedAt: ts(1786200200),
        updatedAt: ts(1786200200),
      },
    }],
  }));
  assert.equal(result.outcome, OUTCOMES.UNCHANGED);
});

for (const [name, tbRefs, expectedPath] of [
  ["tbRefs non-array", {}, "tbRefs"],
  ["tbRefs malformed item", ["TGB_1"], "tbRefs.0"],
  ["tbRefs blank id", [{ id: " ", date: ts() }], "tbRefs.0.id"],
  ["tbRefs invalid timestamp", [{ id: "TGB_1", date: "2026-08-08" }], "tbRefs.0.date"],
  ["tbRefs duplicate logical id", [{ id: "TGB_1", date: ts() }, { id: " tgb_1 ", date: ts(1786200001) }], "tbRefs.1.id"],
  ["tbRefs malformed known fieldWork member", [{ id: "TGB_1", date: ts(), fieldWork: { status: 5 } }], "tbRefs.0.fieldWork.status"],
  ["tbRefs malformed noAccess", [{ id: "TGB_1", date: ts(), rowId: "ROW_1", fieldWork: { status: "IN_PROGRESS", updatedAt: ts(), noAccess: [{ date: "08/08/2026", time: "20:00", user: "" }] } }], "tbRefs.0.fieldWork.noAccess.0.date"],
]) {
  test(name, () => {
    const result = classify(contour({ tbRefs }));
    assert.equal(result.outcome, OUTCOMES.CONFLICT);
    assert.ok(result.conflictingPaths.includes(expectedPath));
  });
}

test("explicit NOT_STARTED fieldWork may omit lifecycle correlation ids", () => {
  const result = classify(contour({
    tbRefs: [{
      id: "TGB_NOT_STARTED",
      date: ts(),
      fieldWork: { status: "NOT_STARTED" },
    }],
  }));
  assert.equal(result.outcome, OUTCOMES.UNCHANGED);
});

test("COMPLETED fieldWork requires completion correlation fields", () => {
  const result = classify(contour({
    tbRefs: [{
      id: "TGB_INCOMPLETE",
      date: ts(),
      rowId: "ROW_1",
      fieldWork: {
        status: "COMPLETED",
        outcomeCode: "METER_DISCOVERED",
        outcomeLabel: "Meter Discovered",
        meterMatch: true,
        submittedAt: ts(),
        updatedAt: ts(),
      },
    }],
  }));
  assert.equal(result.outcome, OUTCOMES.CONFLICT);
  assert.ok(result.conflictingPaths.includes("tbRefs.0.fieldWork.premiseId"));
});

test("unknown nested tbRef/fieldWork members remain allowed while known invalid members fail", () => {
  const good = classify(contour({
    tbRefs: [{
      id: "TGB_1",
      date: ts(),
      futureRefMember: { source: "future" },
      rowId: "ROW_1",
      fieldWork: {
        status: "IN_PROGRESS",
        updatedAt: ts(),
        futureFieldWorkMember: [1, 2, 3],
      },
    }],
  }));
  assert.equal(good.outcome, OUTCOMES.UNCHANGED);

  const bad = classify(contour({
    tbRefs: [{ id: "TGB_1", date: ts(), fieldWork: { meterMatch: "yes" } }],
  }));
  assert.equal(bad.outcome, OUTCOMES.CONFLICT);
  assert.ok(bad.conflictingPaths.includes("tbRefs.0.fieldWork.meterMatch"));
});

test("geofenceRefs absent, empty, canonical and id-only refs are valid", () => {
  assert.equal(classify(contour()).outcome, OUTCOMES.UNCHANGED);
  assert.equal(classify(contour({ geofenceRefs: [] })).outcome, OUTCOMES.UNCHANGED);
  assert.equal(classify(contour({ geofenceRefs: [{ id: "GF_1", name: "Zone 1" }] })).outcome, OUTCOMES.UNCHANGED);
  assert.equal(classify(contour({ geofenceRefs: [{ id: "GF_1" }] })).outcome, OUTCOMES.UNCHANGED);
});

for (const [name, geofenceRefs, expectedPath] of [
  ["geofenceRefs non-array", {}, "geofenceRefs"],
  ["geofenceRefs malformed item", ["GF_1"], "geofenceRefs.0"],
  ["geofenceRefs blank id", [{ id: " " }], "geofenceRefs.0.id"],
  ["geofenceRefs non-string name", [{ id: "GF_1", name: 1 }], "geofenceRefs.0.name"],
  ["geofenceRefs duplicate logical id", [{ id: "GF_1" }, { id: " gf_1 " }], "geofenceRefs.1.id"],
]) {
  test(name, () => {
    const result = classify(contour({ geofenceRefs }));
    assert.equal(result.outcome, OUTCOMES.CONFLICT);
    assert.ok(result.conflictingPaths.includes(expectedPath));
  });
}
