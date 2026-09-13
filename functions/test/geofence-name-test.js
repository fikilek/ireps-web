import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { checkGeofenceName, composeGeofenceName, geofenceNamePart, geofenceNamePrefix, wardNumberFromPcode } from "../geofences/geofence-name.js";

// Geofences rules GF-R001: "Gf W<Ward number> <name>".
test("Ward numbers come from the Ward pcode without leading zeros", () => {
  assert.equal(wardNumberFromPcode("ZA5241006"), 6);
  assert.equal(wardNumberFromPcode("ZA5241004"), 4);
  assert.equal(wardNumberFromPcode("ZA5241017"), 17);
  assert.equal(wardNumberFromPcode(" ZA7423013 "), 13);
  for (const bad of ["", null, "NAv", "ZA5241", "ZA5241000", "5241006"]) assert.equal(wardNumberFromPcode(bad), null, String(bad));
  assert.equal(geofenceNamePrefix(6), "Gf W6 ");
});

test("the form composes the standard name from the fixed start and the typed part", () => {
  assert.equal(composeGeofenceName(6, "Albert Street"), "Gf W6 Albert Street");
  assert.equal(composeGeofenceName(17, "  Extension   2 "), "Gf W17 Extension 2");
  assert.equal(composeGeofenceName(6, "   "), "");
  assert.equal(composeGeofenceName(null, "Albert"), "");
  assert.equal(geofenceNamePart("Gf W6 Albert"), "Albert");
  assert.equal(geofenceNamePart("Gf W4 Albert"), "Albert", "an old Ward start is dropped when the Ward changes");
  assert.equal(geofenceNamePart("Albert"), "Albert");
});

test("createGeoFence accepts only the standard name for the geofence's own Ward", () => {
  assert.deepEqual(checkGeofenceName("Gf W6 Albert Street", "ZA5241006"), { ok: true, reason: null });
  assert.deepEqual(checkGeofenceName("Gf W17 Extension 2", "ZA5241017"), { ok: true, reason: null });
  const refused = [
    ["Albert Street", "ZA5241006"],
    ["Gf W4 Albert", "ZA5241006"],
    ["Gf W006 Albert", "ZA5241006"],
    ["GF W6 Albert", "ZA5241006"],
    ["Gf W6 ", "ZA5241006"],
    ["Gf W6  Albert", "ZA5241006"],
    ["Gf W6 Albert ", "ZA5241006"],
    ["Gf W6 Gf W6 Albert", "ZA5241006"],
    ["Gf W6 Albert", "NAv"],
  ];
  for (const [name, ward] of refused) assert.equal(checkGeofenceName(name, ward).ok, false, `${name} / ${ward}`);
});

test("the rule is enforced in createGeoFence before either creation path", async () => {
  const callables = await readFile(new URL("../geofences/callables.js", import.meta.url), "utf8");
  const check = callables.indexOf("checkGeofenceName(name, parents?.wardPcode)");
  const batchBranch = callables.search(/if \(request\.data\?\.targetedBatch !== undefined\) \{\r?\n\s+return createSalesBatchGeofence/);
  assert.ok(check > 0 && batchBranch > check, "the name check runs before the batch and area paths");
  assert.match(callables, /throw new HttpsError\("invalid-argument", nameCheck\.reason\)/);
});
