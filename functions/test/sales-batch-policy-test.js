import test from "node:test";
import assert from "node:assert/strict";
import {
  addSalesSelection, classifySalesWorkStatus, composeSalesGeocodingAddress,
  evaluateSalesBatchability, inspectErfLookup, inspectSalesTbRefsIntegrity,
  resolveSalesTargetedBatchMembership, singlePipelineErf,
  assertSalesBatchExecutionMembership,
} from "../salesAllMeters/sales-batch-policy.js";

const stamp = { seconds: 1789257600, nanoseconds: 0 };
const tbId = "TGB_20260913_120000_AB12";
const other = "TGB_20260913_120001_AB12";
const source = () => ({ id: "00123", master: { id: "00123", visibility: "INVISIBLE" }, meterNo: "00123", meterNoNormalized: "00123", lmPcode: "ZA5241", town: "Dundee", adr: { strNo: "01A", strName: "Smith", strType: "Street" }, tbRefs: [], hasUsableGps: false });
const ref = (id = tbId) => ({ id, date: stamp });
const started = () => ({ ...ref(), rowId: "TBR_20260913_120000_AB12_000001", fieldWork: { status: "IN_PROGRESS", updatedAt: stamp } });

test("one canonical three-state status: visible first, valid in-progress next", () => {
  assert.equal(classifySalesWorkStatus(source()), "NOT_STARTED");
  assert.equal(classifySalesWorkStatus({ ...source(), salesStatus: "COMPLETED" }), "NOT_STARTED");
  assert.equal(classifySalesWorkStatus({ ...source(), tbRefs: [started()] }), "IN_PROGRESS");
  assert.equal(classifySalesWorkStatus({ ...source(), master: { visibility: "VISIBLE" }, tbRefs: [null] }), "COMPLETED");
  const mixed = { ...source(), tbRefs: [started(), { id: other, date: "bad" }] };
  assert.equal(classifySalesWorkStatus(mixed), "IN_PROGRESS");
  assert.equal(inspectSalesTbRefsIntegrity(mixed.tbRefs).valid, false);
  assert.equal(classifySalesWorkStatus({ ...source(), tbRefs: [started(), started()] }), "NOT_STARTED");
  assert.equal(classifySalesWorkStatus({ ...source(), tbRefs: [ref()], tbRefsIntegrity: { entriesByKey: { [`${tbId}::`]: { classifiable: true } } } }), "NOT_STARTED");
});
test("membership is presence-first and never repairs malformed IDs", () => {
  assert.equal(resolveSalesTargetedBatchMembership(source()).state, "NONE");
  assert.equal(resolveSalesTargetedBatchMembership({ ...source(), tbRefs: [ref()] }).tbId, tbId);
  assert.equal(resolveSalesTargetedBatchMembership({ ...source(), tbRefs: [ref(), ref(other)], targetedBatchId: null }).state, "NONE");
  assert.equal(resolveSalesTargetedBatchMembership({ ...source(), targetedBatchId: other, tbRefs: [ref()] }).tbId, other);
  for (const value of [undefined, "", 42, {}, ` ${tbId}`, tbId.toLowerCase()]) {
    assert.equal(resolveSalesTargetedBatchMembership({ ...source(), targetedBatchId: value }).state, "UNRESOLVED");
  }
  for (const refs of [[ref(), ref()], [ref(), ref(other)], null, [{ id: "TGB_BAD", date: stamp }]]) assert.equal(resolveSalesTargetedBatchMembership({ ...source(), tbRefs: refs }).state, "UNRESOLVED");
  assert.equal(resolveSalesTargetedBatchMembership({ ...source(), tbRefs: [{ tbId, date: stamp }] }).tbId, tbId);
  assert.equal(resolveSalesTargetedBatchMembership({ ...source(), tbRefs: [{ id: tbId, tbId: other, date: stamp }] }).state, "UNRESOLVED");
});
test("TB8 rejects unknown keys and malformed fieldwork without fourth status", () => {
  for (const bad of [{ ...ref(), extra: true }, { ...ref(), date: null }, { ...started(), fieldWork: { status: "NOT_STARTED", updatedAt: stamp } }, { ...started(), fieldWork: { status: "IN_PROGRESS", updatedAt: stamp, extra: 1 } }]) {
    assert.equal(inspectSalesTbRefsIntegrity([bad]).valid, false);
    assert.equal(classifySalesWorkStatus({ ...source(), tbRefs: [bad] }), "NOT_STARTED");
  }
});
test("Batchability separates business admission from capacity and unresolved ERF", () => {
  const row = source();
  assert.equal(evaluateSalesBatchability(row).batchable, true);
  assert.equal(evaluateSalesBatchability({ ...row, remainingCapacity: 0 }).batchable, true);
  assert.equal(evaluateSalesBatchability({ ...row, targetedBatchId: tbId }).batchable, false);
  assert.equal(evaluateSalesBatchability({ ...row, master: { ...row.master, id: "BAD" } }).batchable, false);
  assert.equal(evaluateSalesBatchability({ ...row, meterType: "UNSUPPORTED" }).batchable, false);
  assert.equal(evaluateSalesBatchability(row, { lmPcode: "ZA1234" }).batchable, false);
  assert.equal(evaluateSalesBatchability({ ...row, erfId: "ERF1" }).code, "ERF_RESOLUTION_INVALID");
});
test("failed lookup uses exact authoritative address, becomes stale on address change", () => {
  const row = source();
  assert.equal(composeSalesGeocodingAddress(row), "01A Smith Street, Dundee, KwaZulu-Natal, South Africa");
  for (const outcome of ["NO_EXACT_POSITION", "NO_ERF", "MULTIPLE_ERFS"]) {
    const flagged = { ...row, erfLookup: { version: 1, outcome, address: composeSalesGeocodingAddress(row), provider: "Google Geocoding API", attemptedAt: stamp, attemptedByUid: "U1", attemptedByUser: "Supervisor" } };
    assert.equal(inspectErfLookup(flagged).flagged, true);
    assert.equal(evaluateSalesBatchability(flagged).reason, `Needs manual ERFing — ${outcome}`);
    assert.equal(classifySalesWorkStatus(flagged), "NOT_STARTED");
    assert.equal(evaluateSalesBatchability({ ...flagged, adr: { ...row.adr, strNo: "02" } }).batchable, true);
    assert.equal(evaluateSalesBatchability({ ...flagged, erfLookup: { ...flagged.erfLookup, latitude: -28 } }).code, "ERF_LOOKUP_INVALID");
  }
});
test("GPS requires one raw candidate; duplicate candidates and coercion cannot create coordinates", () => {
  const candidate = { ErfId: "ERF1", Latitude: -28.1, Longitude: 30.2 };
  assert.equal(singlePipelineErf({ erfCandidates: [candidate] }).ok, true);
  assert.equal(singlePipelineErf({ erfCandidates: [candidate, candidate] }).ok, false);
  for (const Latitude of [null, undefined, "", " ", false, {}, 91]) assert.equal(singlePipelineErf({ erfCandidates: [{ ...candidate, Latitude }] }).ok, false);
  assert.equal(evaluateSalesBatchability({ ...source(), hasUsableGps: true, erfCandidates: [candidate] }, { source: "PREPAID_SALES" }).batchable, true);
});
test("30-capacity additions are all-or-nothing with an unchanged original selection", () => {
  const selected = Array.from({ length: 30 }, (_, i) => `${i}`);
  const result = addSalesSelection(selected, ["31"]);
  assert.equal(result.selectedIds, selected);
  assert.match(result.message, /0 slots remain/);
  assert.equal(addSalesSelection(selected.slice(0, 28), ["31", "32", "33"]).changed, false);
  assert.equal(addSalesSelection(selected.slice(0, 29), ["31"]).selectedIds.length, 30);
});
test("execution needs exact matching scalar/legacy reference; explicit null blocks", () => {
  const row = { ...source(), tbRefs: [ref()], targetedBatchId: tbId };
  assert.equal(assertSalesBatchExecutionMembership(row, tbId).ok, true);
  assert.throws(() => assertSalesBatchExecutionMembership({ ...row, targetedBatchId: null }, tbId), /membership/);
  assert.throws(() => assertSalesBatchExecutionMembership({ ...row, tbRefs: [ref(), ref()] }, tbId), /membership/);
  const legacy = { ...row }; delete legacy.targetedBatchId;
  assert.equal(assertSalesBatchExecutionMembership(legacy, tbId).ok, true);
});

test("raw master authority and exact pre-execution reference cannot be manufactured", () => {
  assert.equal(classifySalesWorkStatus({master:null,masterVisibility:"VISIBLE"}),"NOT_STARTED");
  assert.equal(inspectSalesTbRefsIntegrity([{...ref(),rowId:"ROW1"}]).valid,false);
});
