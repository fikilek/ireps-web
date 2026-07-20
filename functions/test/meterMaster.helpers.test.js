import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  METER_MASTER_CLASSIFICATIONS,
  METER_MASTER_CONFLICT_CODES,
  normalizeMeterNo,
  isFirestoreTimestamp,
  buildCanonicalFieldOnlyMeterMaster,
  classifyOperationalAstChange,
  buildOperationalAstUpdate,
} from "../meterMaster/helpers.js";

function timestamp(seconds = 1) {
  return { seconds, nanoseconds: 0, toDate: () => new Date(seconds * 1000) };
}

function canonical(overrides = {}) {
  const createdAt = timestamp(1);
  const updatedAt = timestamp(2);
  const doc = {
    lmPcode: "ZA7423",
    meterNo: { raw: "04085345850", normalized: "04085345850" },
    meterType: "electricity",
    customerNo: "CUSTOMER-1",
    accountNo: "ACCOUNT-1",
    refs: {
      asts: { id: "" },
      sales: { id: "04085345850", provider: "conlog" },
    },
    metadata: {
      createdAt,
      createdByUid: "PIPELINE",
      createdByUser: "METER MASTER PIPELINE",
      updatedAt,
      updatedByUid: "PIPELINE",
      updatedByUser: "METER MASTER PIPELINE",
    },
  };
  return { ...doc, ...overrides };
}

const classify = (existing, extra = {}) => classifyOperationalAstChange({
  masterId: "04085345850",
  existing,
  incomingAstId: "AST-1",
  incomingLmPcode: "ZA7423",
  incomingMeterType: "electricity",
  sourceWriter: "test",
  ...extra,
});

test("normalization removes whitespace, uppercases, preserves zeroes and has no fixed length", () => {
  assert.equal(normalizeMeterNo(" 04 a\t0  "), "04A0");
  assert.equal(normalizeMeterNo("0"), "0");
  assert.equal(normalizeMeterNo("00000000000000000000001"), "00000000000000000000001");
  assert.throws(() => normalizeMeterNo(" \t\r\n "), /empty value/);
  assert.throws(() => normalizeMeterNo("METER-1"), /only letters and digits/);
});

test("FIELD_ONLY builder emits the exact canonical shape and one Timestamp", () => {
  const now = timestamp(10);
  const doc = buildCanonicalFieldOnlyMeterMaster({
    lmPcode: "za7423",
    meterNoRaw: " 04 a 0 ",
    meterType: "ELECTRICITY",
    astId: "AST-1",
    actorUid: "UID-1",
    actorUser: "Agent One",
    operationTimestamp: now,
  });
  assert.deepEqual(Object.keys(doc).sort(), [
    "accountNo", "customerNo", "lmPcode", "metadata", "meterNo", "meterType", "refs",
  ]);
  assert.deepEqual(doc.meterNo, { raw: " 04 a 0 ", normalized: "04A0" });
  assert.deepEqual(doc.refs, {
    asts: { id: "AST-1" }, sales: { id: "", provider: "" },
  });
  assert.equal(doc.customerNo, "");
  assert.equal(doc.accountNo, "");
  assert.equal(doc.metadata.createdAt, now);
  assert.equal(doc.metadata.updatedAt, now);
  assert.ok(isFirestoreTimestamp(doc.metadata.createdAt));
  assert.ok(!JSON.stringify(doc).includes(":null"));
  for (const prohibited of ["id", "parents", "status", "serviceProvider", "visibility"]) {
    assert.equal(Object.hasOwn(doc, prohibited), false);
  }
});

test("missing Master classifies CREATE_FIELD_ONLY", () => {
  assert.equal(classify(null).classification, METER_MASTER_CLASSIFICATIONS.CREATE_FIELD_ONLY);
});

test("SALES_ONLY classifies UPDATE_AST_LINK and exact patch preserves owned fields", () => {
  const existing = canonical();
  const decision = classify(existing);
  assert.equal(decision.classification, METER_MASTER_CLASSIFICATIONS.UPDATE_AST_LINK);
  const now = timestamp(20);
  const patch = buildOperationalAstUpdate({
    astId: "AST-1", actorUid: "OP-1", actorUser: "Operator", operationTimestamp: now,
  });
  assert.deepEqual(Object.keys(patch).sort(), [
    "metadata.updatedAt", "metadata.updatedByUid", "metadata.updatedByUser", "refs.asts.id",
  ]);
  assert.equal(existing.customerNo, "CUSTOMER-1");
  assert.equal(existing.accountNo, "ACCOUNT-1");
  assert.equal(existing.refs.sales.id, "04085345850");
  assert.equal(existing.refs.sales.provider, "conlog");
  assert.equal(existing.metadata.createdByUid, "PIPELINE");
});

test("same AST is UNCHANGED with no patch or metadata write", () => {
  const decision = classify(canonical({
    refs: { asts: { id: "AST-1" }, sales: { id: "04085345850", provider: "conlog" } },
  }));
  assert.equal(decision.classification, METER_MASTER_CLASSIFICATIONS.UNCHANGED);
  assert.equal(decision.patch, null);
});

test("different AST produces stable conflict and no patch", () => {
  const existing = canonical({
    refs: { asts: { id: "AST-OTHER" }, sales: { id: "04085345850", provider: "conlog" } },
  });
  const decision = classify(existing);
  assert.equal(decision.classification, METER_MASTER_CLASSIFICATIONS.CONFLICT);
  assert.equal(decision.conflict.conflictCode, METER_MASTER_CONFLICT_CODES.AST_REFERENCE_CONFLICT);
  assert.equal(decision.patch, null);
  assert.equal(existing.refs.asts.id, "AST-OTHER");
});

const conflictCases = [
  ["LM mismatch", canonical(), { incomingLmPcode: "ZA9999" }, "MM_LM_CONFLICT"],
  ["normalized identity mismatch", canonical({ meterNo: { raw: "04085345850", normalized: "OTHER" } }), {}, "MM_NORMALIZED_IDENTITY_CONFLICT"],
  ["meter type mismatch", canonical(), { incomingMeterType: "water" }, "MM_METER_TYPE_CONFLICT"],
  ["invalid refs type", canonical({ refs: "bad" }), {}, "MM_DOCUMENT_SHAPE_UNSAFE"],
  ["invalid created timestamp", canonical({ metadata: { ...canonical().metadata, createdAt: "2026-01-01T00:00:00Z" } }), {}, "MM_CREATED_METADATA_INVALID"],
  ["missing identity field", (() => { const doc = canonical(); delete doc.lmPcode; return doc; })(), {}, "MM_CANONICAL_FIELD_MISSING"],
  ["null canonical string", canonical({ customerNo: null }), {}, "MM_GOVERNED_FIELD_TYPE_INVALID"],
];

for (const [name, existing, extra, expectedCode] of conflictCases) {
  test(`${name} produces ${expectedCode} and no unsafe patch`, () => {
    const decision = classify(existing, extra);
    assert.equal(decision.classification, METER_MASTER_CLASSIFICATIONS.CONFLICT);
    assert.equal(decision.conflict.conflictCode, expectedCode);
    assert.equal(decision.patch, null);
  });
}

test("installation and discovery source use strict create/exact update without legacy Master merge", async () => {
  const source = await readFile(new URL("../index.js", import.meta.url), "utf8");
  const discovery = source.slice(
    source.indexOf("export const onMeterDiscoveryCreated"),
    source.indexOf("export const onNoAccessRecorded"),
  );
  const installation = source.slice(source.indexOf("export const onMeterInstallationCallable"));

  for (const writer of [discovery, installation]) {
    assert.match(writer, /classifyOperationalAstChange/);
    assert.match(writer, /tx\.create\(\s*masterRef/);
    assert.match(writer, /buildOperationalAstUpdate/);
    assert.doesNotMatch(writer, /tx\.set\(\s*masterRef/);
    assert.doesNotMatch(writer, /refs:\s*\{\s*asts:[\s\S]*refs\.trns/);
  }
});
