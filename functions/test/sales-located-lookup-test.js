import test from "node:test";
import assert from "node:assert/strict";
import { FieldValue } from "firebase-admin/firestore";
import { recordFailedLookup, recordLocatedLookup, sameErfLocated, salesMaterialHash } from "../targetedBatches/sales-batch-resolution.js";
import { composeSalesGeocodingAddress, evaluateSalesBatchability, inspectErfLocated, ERF_LOCATED_KEYS } from "../salesAllMeters/sales-batch-policy.js";

// Targeted Batch rules 1.3.15 (TB-R041) and Sales schema 1.7.0 (TB10): TB Draft records a
// successful location; it is not final, stores no coordinates and never sets erfId.
const stamp = { seconds: 1789257600, nanoseconds: 0 };
const later = { seconds: 1789344000, nanoseconds: 0 };
const sales = () => ({ id: "00123", master: { id: "00123", visibility: "INVISIBLE" }, meterNo: "00123", meterNoNormalized: "00123", lmPcode: "ZA5241", town: "Dundee",
  adr: { strNo: "01A", strName: "Smith", strType: "Street" }, tbRefs: [], monthlyCategories: { "2026-08": { leakageCategory: "CAT4 - Long Gap (4+ months)" } },
  metadata: { createdAt: stamp, createdByUid: "ORIGINAL", createdByUser: "Original", updatedAt: stamp, updatedByUid: "ORIGINAL", updatedByUser: "Original" } });
const located = row => ({ version: 1, erfId: "ERF1", wardPcode: "ZA5241001", address: composeSalesGeocodingAddress(row), provider: "Google Geocoding API", locatedAt: stamp, locatedByUid: "U1", locatedByUser: "Supervisor" });
const failed = row => ({ version: 1, outcome: "NO_EXACT_POSITION", address: composeSalesGeocodingAddress(row), provider: "Google Geocoding API", attemptedAt: stamp, attemptedByUid: "U1", attemptedByUser: "Supervisor" });
const actor = { uid: "U2", user: "Planner" };
const intent = { lmPcode: "ZA5241", source: "PREPAID_SALES_NON_GPS" };
const profile = { employment: { role: "MNG" }, displayName: "Supervisor", access: { activeWorkbase: { id: "ZA5241" }, workbases: [{ id: "ZA5241" }] } };
function fakeDb(row) {
  const writes = [];
  const db = { doc: path => ({ path }), runTransaction: fn => fn({
    get: async ref => ({ exists: row !== null, data: () => structuredClone(ref.path.startsWith("users/") ? profile : row) }),
    update: (ref, patch) => writes.push({ path: ref.path, patch }) }) };
  return { db, writes };
}
const record = (db, row, extra = {}) => recordLocatedLookup({ db, actor, intent, salesId: "00123", address: composeSalesGeocodingAddress(row), erfId: "ERF1", wardPcode: "ZA5241001", now: () => later, ...extra });

test("inspectErfLocated: absent, current, stale address and malformed records", () => {
  const row = sales();
  assert.deepEqual(inspectErfLocated(row), { valid: true, located: false, erfId: null, wardPcode: null });
  assert.deepEqual(inspectErfLocated({ ...row, erfLocated: located(row) }), { valid: true, located: true, erfId: "ERF1", wardPcode: "ZA5241001" });
  const moved = { ...row, adr: { ...row.adr, strNo: "02" }, erfLocated: located(row) };
  assert.deepEqual(inspectErfLocated(moved), { valid: true, located: false, erfId: null, wardPcode: null }, "a changed address means not located");
  for (const bad of [{ ...located(row), latitude: -28.1 }, { ...located(row), version: 2 }, { ...located(row), wardPcode: "W6" }, { ...located(row), erfId: "" }, { ...located(row), locatedAt: "2026-09-14" }, null]) {
    assert.equal(inspectErfLocated({ ...row, erfLocated: bad }).valid, false, JSON.stringify(bad));
    assert.equal(inspectErfLocated({ ...row, erfLocated: bad }).located, false);
  }
  assert.deepEqual([...ERF_LOCATED_KEYS].sort(), ["address", "erfId", "locatedAt", "locatedByUid", "locatedByUser", "provider", "version", "wardPcode"], "no coordinates are stored");
  assert.equal(evaluateSalesBatchability({ ...row, erfLocated: located(row) }).batchable, true, "a location never changes batchability");
});

test("evidence ignores the lookup records and metadata but still binds the Sales material", () => {
  const row = sales(), hash = salesMaterialHash(row);
  assert.equal(salesMaterialHash({ ...row, erfLocated: located(row) }), hash);
  assert.equal(salesMaterialHash({ ...row, erfLookup: failed(row) }), hash);
  assert.equal(salesMaterialHash({ ...row, metadata: { ...row.metadata, updatedAt: later, updatedByUid: "U2" } }), hash);
  assert.notEqual(salesMaterialHash({ ...row, adr: { ...row.adr, strNo: "02" } }), hash);
  assert.notEqual(salesMaterialHash({ ...row, targetedBatchId: "TGB_20260913_120001_AB12" }), hash);
});

test("a successful location writes exactly TB10 and the update triple, and replaces the failed-lookup flag", async () => {
  const row = { ...sales(), erfLookup: { ...failed(sales()), address: "14 Old Spelling, DUNDEE, KwaZulu-Natal, South Africa" } }, before = structuredClone(row);
  const { db, writes } = fakeDb(row);
  assert.equal(await record(db, row), true);
  assert.equal(writes.length, 1); assert.equal(writes[0].path, "sales-all-meters/00123");
  const patch = writes[0].patch;
  assert.deepEqual(Object.keys(patch).sort(), ["erfLocated", "erfLookup", "metadata.updatedAt", "metadata.updatedByUid", "metadata.updatedByUser"]);
  assert.ok(patch.erfLookup.isEqual(FieldValue.delete()), "the old flag is removed");
  assert.deepEqual(patch.erfLocated, { version: 1, erfId: "ERF1", wardPcode: "ZA5241001", address: composeSalesGeocodingAddress(row), provider: "Google Geocoding API", locatedAt: later, locatedByUid: "U2", locatedByUser: "Planner" });
  assert.equal(patch["metadata.updatedAt"], later); assert.equal(patch["metadata.updatedByUser"], "Planner");
  assert.equal(Object.hasOwn(patch, "erfId") || Object.hasOwn(patch, "erfResolution") || Object.hasOwn(patch, "metadata.createdAt"), false);
  assert.deepEqual(row, before, "the read document is not mutated");
  const plain = sales(), second = fakeDb(plain);
  await record(second.db, plain);
  assert.deepEqual(Object.keys(second.writes[0].patch).sort(), ["erfLocated", "metadata.updatedAt", "metadata.updatedByUid", "metadata.updatedByUser"], "no flag to remove");
});

test("the same location is not written again; a changed ERF or Ward is", async () => {
  const row = { ...sales(), erfLocated: located(sales()) };
  assert.equal(sameErfLocated(row, { erfId: "ERF1", wardPcode: "ZA5241001", address: composeSalesGeocodingAddress(row) }), true);
  const same = fakeDb(row);
  assert.equal(await record(same.db, row), false); assert.deepEqual(same.writes, []);
  const moved = fakeDb(row);
  assert.equal(await record(moved.db, row, { erfId: "ERF2" }), true); assert.equal(moved.writes[0].patch.erfLocated.erfId, "ERF2");
  const stale = { ...sales(), erfLocated: { ...located(sales()), address: "14 Old Spelling, DUNDEE, KwaZulu-Natal, South Africa" } }, refreshed = fakeDb(stale);
  assert.equal(await record(refreshed.db, stale), true, "a record under an old address is refreshed");
});

test("nothing is recorded when the address changed, the ERF is already final, the meter left, or it is no longer Not Started", async () => {
  const row = sales();
  const changed = fakeDb(row);
  assert.equal(await record(changed.db, row, { address: "14 Other, DUNDEE, KwaZulu-Natal, South Africa" }), false);
  const gone = fakeDb(null);
  assert.equal(await record(gone.db, row), false);
  const established = { ...row, erfId: "ERF1", erfResolution: { version: 1, revision: 1, method: "GEOCODED", evidenceRefs: ["ireps_erfs/ERF1"], confirmedByUid: "U1", confirmedByUser: "Supervisor", confirmedAt: stamp, tbId: "TGB_20260913_120001_AB12",
    geocode: { latitude: -28.1, longitude: 30.2, matchLevel: "EXACT_STREET_NUMBER", geocodedAddress: composeSalesGeocodingAddress(row), provider: "Google Geocoding API", geocodedAt: stamp } } };
  const final = fakeDb(established);
  assert.equal(await record(final.db, established), false);
  const batched = { ...row, targetedBatchId: "TGB_20260913_120001_AB12" }, member = fakeDb(batched);
  assert.equal(await record(member.db, batched), false);
  for (const fake of [changed, gone, final, member]) assert.deepEqual(fake.writes, []);
});

test("a failed lookup replaces an earlier successful location", async () => {
  const row = { ...sales(), erfLocated: located(sales()) }, { db, writes } = fakeDb(row);
  await recordFailedLookup({ db, request: { auth: { uid: "U1", token: {} } }, intent, salesId: "00123", address: composeSalesGeocodingAddress(row), outcome: "NO_ERF", now: () => later });
  const patch = writes[0].patch;
  assert.deepEqual(Object.keys(patch).sort(), ["erfLocated", "erfLookup", "metadata.updatedAt", "metadata.updatedByUid", "metadata.updatedByUser"]);
  assert.ok(patch.erfLocated.isEqual(FieldValue.delete()));
  assert.equal(patch.erfLookup.outcome, "NO_ERF");
});
