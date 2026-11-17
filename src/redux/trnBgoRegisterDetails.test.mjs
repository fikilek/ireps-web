import test from "node:test";
import assert from "node:assert/strict";
import { batchGeofenceList, batchGeofenceNames } from "./trnBgoRegisterDetails.js";

test("batchGeofenceList deduplicates, sorts, and resolves names", () => {
  const rows = [
    {
      geofenceRefs: [
        { id: "gf2", name: "Gf W6 Craigside4" },
        { id: "gf1", name: "Gf W6 Acacia" },
      ],
    },
    {
      geofenceRefs: [
        { id: "gf1", name: "gf1" },
        { id: "gf3", description: "Gf W6 Acacia2" },
      ],
    },
  ];
  assert.deepEqual(batchGeofenceList(rows), [
    "Gf W6 Acacia",
    "Gf W6 Acacia2",
    "Gf W6 Craigside4",
  ]);
  assert.equal(
    batchGeofenceNames(rows),
    "Gf W6 Acacia, Gf W6 Acacia2, Gf W6 Craigside4",
  );
});

test("batchGeofenceList returns empty array and batchGeofenceNames returns NAv when none", () => {
  assert.deepEqual(batchGeofenceList([{ geofenceRefs: [] }]), []);
  assert.equal(batchGeofenceNames([{ geofenceRefs: [] }]), "NAv");
});
