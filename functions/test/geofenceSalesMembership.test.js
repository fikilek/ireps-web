import assert from "node:assert/strict";
import test from "node:test";

import {
  collectGeoFenceSalesUpdates,
  commitGeoFenceSalesMembershipUpdates,
} from "../geofences/salesMembership.js";

const bbox = {
  minLatitude: -29.0,
  maxLatitude: -28.0,
  minLongitude: 29.0,
  maxLongitude: 30.0,
};

const polygonPoints = [
  { latitude: -29.0, longitude: 29.0 },
  { latitude: -29.0, longitude: 30.0 },
  { latitude: -28.0, longitude: 30.0 },
  { latitude: -28.0, longitude: 29.0 },
];

function salesDoc({ id = "SALE_1", latitude = -28.5, longitude = 29.5, geofenceRefs } = {}) {
  const data = {
    hasUsableGps: true,
    lmPcode: "ZA5241",
    wardPcode: "ZA5241001",
    erfCandidates: [{
      lmPcode: "ZA5241",
      wardPcode: "ZA5241001",
      latitude,
      longitude,
    }],
  };
  if (geofenceRefs !== undefined) data.geofenceRefs = geofenceRefs;

  return {
    id,
    ref: { path: `sales-all-meters/${id}` },
    data: () => data,
  };
}

function collect(doc) {
  return collectGeoFenceSalesUpdates({
    salesDocs: [doc],
    geoFenceId: "GF_1",
    geoFenceName: "Ward 1 Focus",
    lmPcode: "ZA5241",
    wardPcode: "ZA5241001",
    bbox,
    polygonPoints,
  });
}

test("inside canonical Sales candidate is selected for atomic membership update", () => {
  const result = collect(salesDoc());
  assert.equal(result.memberCount, 1);
  assert.equal(result.updates.length, 1);
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(result.updates[0].geoFenceRef, {
    id: "GF_1",
    name: "Ward 1 Focus",
  });
});

test("outside canonical Sales candidate is not selected", () => {
  const result = collect(salesDoc({ latitude: -27.5, longitude: 29.5 }));
  assert.equal(result.memberCount, 0);
  assert.equal(result.updates.length, 0);
  assert.equal(result.conflicts.length, 0);
});

test("exact retry with same geofence id and name is idempotent", () => {
  const result = collect(salesDoc({
    geofenceRefs: [{ id: "GF_1", name: "Ward 1 Focus" }],
  }));
  assert.equal(result.memberCount, 1);
  assert.equal(result.updates.length, 0);
  assert.equal(result.conflicts.length, 0);
});

test("legacy id-only matching ref is accepted as already linked", () => {
  const result = collect(salesDoc({ geofenceRefs: [{ id: "GF_1" }] }));
  assert.equal(result.memberCount, 1);
  assert.equal(result.updates.length, 0);
  assert.equal(result.conflicts.length, 0);
});

test("same logical geofence id with different name fails closed", () => {
  const result = collect(salesDoc({
    geofenceRefs: [{ id: "GF_1", name: "Different Name" }],
  }));
  assert.equal(result.memberCount, 1);
  assert.equal(result.updates.length, 0);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].code, "GEOFENCE_REF_NAME_CONFLICT");
});

test("duplicate logical geofence ids fail closed", () => {
  const result = collect(salesDoc({
    geofenceRefs: [
      { id: "GF_1", name: "Ward 1 Focus" },
      { id: " gf_1 ", name: "Ward 1 Focus" },
    ],
  }));
  assert.equal(result.updates.length, 0);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].code, "GEOFENCE_REF_DUPLICATE_LOGICAL_ID");
});

test("membership commit refuses all writes when an integrity conflict exists", async () => {
  let batchCalled = false;
  const db = {
    batch() {
      batchCalled = true;
      throw new Error("batch should not be opened");
    },
  };

  await assert.rejects(
    commitGeoFenceSalesMembershipUpdates({
      db,
      updates: [{ ref: { path: "sales-all-meters/SALE_1" }, geoFenceRef: { id: "GF_1", name: "Ward 1 Focus" } }],
      conflicts: [{ code: "GEOFENCE_REF_NAME_CONFLICT" }],
    }),
    (error) => error?.code === "SALES_GEOFENCE_MEMBERSHIP_INTEGRITY_CONFLICT",
  );
  assert.equal(batchCalled, false);
});

test("membership commit emits one geofenceRefs atomic transform and touches no other field", async () => {
  const writes = [];
  const db = {
    batch() {
      return {
        update(ref, payload) {
          writes.push({ ref, payload });
        },
        async commit() {},
      };
    },
  };

  const result = await commitGeoFenceSalesMembershipUpdates({
    db,
    updates: [{
      ref: { path: "sales-all-meters/SALE_1" },
      geoFenceRef: { id: "GF_1", name: "Ward 1 Focus" },
    }],
  });

  assert.equal(result.docsUpdated, 1);
  assert.equal(result.batchesCommitted, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0].payload), ["geofenceRefs"]);
  assert.ok(writes[0].payload.geofenceRefs);
});
