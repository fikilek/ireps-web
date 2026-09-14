import test from "node:test";
import assert from "node:assert/strict";
import { STREET_NAME_CORRECTIONS, correctedStreetName } from "../salesAllMeters/sales-street-corrections.js";
import { composeSalesGeocodingAddress, evaluateSalesBatchability, inspectErfLookup, salesStreetAddress } from "../salesAllMeters/sales-batch-policy.js";
import { acceptGoogleGeocode } from "../targetedBatches/sales-batch-geocoding.js";

// Targeted Batch rules TB-R041 (1.3.12): owner-approved street-name corrections, geocoding only.
const stamp = { seconds: 1789257600, nanoseconds: 0 };
const sales = (strName, town = "DUNDEE", strType = "-") => ({ master: { id: "04290000001", visibility: "INVISIBLE" }, meterNo: "04290000001", meterNoNormalized: "04290000001",
  lmPcode: "ZA5241", town, adr: { strNo: "12", strName, strType }, tbRefs: [], metadata: { createdAt: stamp, createdByUid: "P", createdByUser: "P", updatedAt: stamp, updatedByUid: "P", updatedByUser: "P" } });
const google = (route, town = "Dundee", number = "12") => ({ status: "OK", results: [{ geometry: { location_type: "ROOFTOP", location: { lat: -28.16, lng: 30.24 } },
  address_components: [{ types: ["street_number"], long_name: number }, { types: ["route"], long_name: route, short_name: route }, { types: ["locality"], long_name: town }, { types: ["country"], short_name: "ZA" }] }] });

test("the first approved Dundee corrections, each with its approval", () => {
  assert.deepEqual(STREET_NAME_CORRECTIONS.map(c => `${c.town}: ${c.from} -> ${c.to}`), [
    "DUNDEE: Ann -> Anne", "DUNDEE: Argyle -> Argyll", "DUNDEE: Oldacre -> Old Acre", "DUNDEE: Mc Kenzie -> Mckenzie", "DUNDEE: Karellandman -> Karel Landman"]);
  assert.ok(STREET_NAME_CORRECTIONS.every(c => c.lmPcode === "ZA5241" && c.approved === "2026-09-14"));
});

test("a correction applies only to its LM and town, ignoring case and spacing", () => {
  assert.equal(correctedStreetName(sales("Ann")), "Anne");
  assert.equal(correctedStreetName(sales(" ann ")), "Anne");
  assert.equal(correctedStreetName(sales("Mc  Kenzie")), "Mckenzie");
  assert.equal(correctedStreetName(sales("Ann", "GLENCOE")), "Ann", "another town keeps its Sales spelling");
  assert.equal(correctedStreetName({ ...sales("Ann"), lmPcode: "ZA5242" }), "Ann", "another LM keeps its Sales spelling");
  assert.equal(correctedStreetName(sales("Victoria")), "Victoria");
});

test("the geocoding address uses the corrected name; the Sales street address does not", () => {
  const row = sales("Ann");
  assert.equal(composeSalesGeocodingAddress(row), "12 Anne, DUNDEE, KwaZulu-Natal, South Africa");
  assert.equal(salesStreetAddress(row), "12 Ann", "the Sales spelling stays for rows and snapshots");
  assert.equal(row.adr.strName, "Ann", "the Sales record is not changed");
});

test("Google's corrected street is accepted exactly; uncorrected misspellings are still refused", () => {
  assert.equal(acceptGoogleGeocode(google("Anne Street"), sales("Ann")).ok, true);
  assert.equal(acceptGoogleGeocode(google("Old Acre Street"), sales("Oldacre")).ok, true);
  assert.equal(acceptGoogleGeocode(google("Karel Landman Street"), sales("Karellandman")).ok, true);
  assert.equal(acceptGoogleGeocode(google("Anne Street", "Glencoe"), sales("Ann", "GLENCOE")).ok, false, "no correction for Glencoe: still exact");
  assert.equal(acceptGoogleGeocode(google("Wilson Street"), sales("Willson")).ok, false, "not approved: still refused");
  assert.equal(acceptGoogleGeocode(google("Annex Street"), sales("Ann")).ok, false, "no fuzzy matching around a correction");
});

test("a failed-lookup flag recorded under the old spelling no longer applies", () => {
  const row = sales("Ann");
  const oldAddress = "12 Ann, DUNDEE, KwaZulu-Natal, South Africa";
  const flagged = { ...row, erfLookup: { version: 1, outcome: "NO_EXACT_POSITION", address: oldAddress, provider: "Google Geocoding API", attemptedAt: stamp, attemptedByUid: "U1", attemptedByUser: "Supervisor" } };
  assert.equal(inspectErfLookup(flagged).valid, true);
  assert.equal(inspectErfLookup(flagged).flagged, false);
  assert.equal(evaluateSalesBatchability(flagged, { salesId: row.meterNo, lmPcode: "ZA5241", source: "PREPAID_SALES_NON_GPS" }).batchable, true, "the meter can be selected and located again");
});
