import test from "node:test";
import assert from "node:assert/strict";
import { findDuplicateGeofence, geofenceNameKey, duplicateGeofenceNameMessage } from "../geofences/geofence-name.js";

// Geofences rules GF-R002: no two active geofences in a Ward share a name; capital letters and
// extra spaces are ignored; removed geofences do not count.
test("names compare ignoring capital letters and extra spaces", () => {
  assert.equal(geofenceNameKey("  Gf W6   Old  Acre2 "), "gf w6 old acre2");
  const fences = [{ id: "A", name: "Gf W6 Old Acre2", status: "ACTIVE" }, { id: "B", name: "Gf W6 Acacia", status: "INACTIVE" }];
  assert.equal(findDuplicateGeofence("gf w6 old  acre2", fences)?.id, "A");
  assert.equal(findDuplicateGeofence("Gf W6 Old Acre3", fences), null);
  assert.equal(findDuplicateGeofence("Gf W6 Acacia", fences), null, "a removed geofence's name is free");
  assert.equal(findDuplicateGeofence("", fences), null);
  assert.equal(findDuplicateGeofence("Gf W6 Old Acre2", undefined), null);
  assert.equal(duplicateGeofenceNameMessage(fences[0]), '"Gf W6 Old Acre2" already exists. Choose another name.');
});
