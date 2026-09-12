import assert from "node:assert/strict";
import test from "node:test";
import { buildTargetedBatchDetailsReadModel as build } from "./salesTargetedBatchReadModel.js";

test("details use document ID, parent creation metadata and exact geofence join", () => {
  const details = build({ tbId: "TB", batch: { id: "wrong", geofenceId: "G", metadata: {
    createdAt: { seconds: 1700000000, nanoseconds: 500000000 },
    createdByUid: "U", createdByUser: "Creator", updatedByUser: "Not creator" } },
    geofence: { id: "G", name: "Current name" } });
  assert.deepEqual(details, { id: "TB", createdAtMs: 1700000000500,
    createdByUid: "U", createdByUser: "Creator", geofenceId: "G", geofenceName: "Current name" });
});
test("missing geofence remains null for Not recorded; no spatial/name inference", () => {
  const details = build({ tbId: "TB", batch: {
    geofenceRefs: [{ id: "G" }], scope: { wardNumber: "1" }, name: "G",
    metadata: { updatedAt: 1234, updatedByUser: "Updater" } },
    geofence: { id: "G", name: "Do not infer" } });
  assert.deepEqual(details, { id: "TB", createdAtMs: null, createdByUid: null,
    createdByUser: null, geofenceId: null, geofenceName: null });
});
test("missing parent and missing geofence document are distinct", () => {
  assert.equal(build({ tbId: "TB", batch: null }), null);
  assert.equal(build({ tbId: "TB", batch: { geofenceId: "G" } }).geofenceId, "G");
  assert.equal(build({ tbId: "TB", batch: { geofenceId: "G" }, geofence: { id: "OTHER", name: "Wrong" } }).geofenceName, null);
});
test("creator UID fallback remains available without a name", () => {
  const details = build({ tbId: "TB", batch: { metadata: { createdByUid: "U" } } });
  assert.equal(details.createdByUser || details.createdByUid, "U");
});
test("date formats normalize; invalid legacy date never becomes a made-up date", () => {
  for (const value of ["2026-09-11T12:34:56Z", { toMillis: () => 1789130096000 }]) {
    assert.equal(build({ tbId: "TB", batch: { metadata: { createdAt: value } } }).createdAtMs, 1789130096000);
  }
  for (const value of ["bad", null, { toMillis: () => { throw Error("bad"); } }]) {
    assert.equal(build({ tbId: "TB", batch: { metadata: { createdAt: value } } }).createdAtMs, null);
  }
});
