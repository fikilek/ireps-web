import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { acceptGoogleGeocode, geocodeSalesAddress } from "../targetedBatches/sales-batch-geocoding.js";
import { composeSalesGeocodingAddress, inspectErfLookup, evaluateSalesBatchability } from "../salesAllMeters/sales-batch-policy.js";
import { resolveSalesBatch, readDraftAssessment, recordFailedLookup } from "../targetedBatches/sales-batch-resolution.js";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/sales-batch-fixtures.json", import.meta.url), "utf8"));
// Address/locality combinations supplied by the owner's DEV review. Responses
// are constructed offline, with synthetic coordinates; these are not raw Google captures.
const cases = [
  { number: "14", street: "Bulwer", town: "DUNDEE", type: "-", route: "Bulwer Street", locality: "Dundee" },
  { number: "46", street: "Gladstone", town: "DUNDEE", type: "-", route: "Gladstone Street", locality: "Dundee" },
  { number: "1108", street: "Makhathini", town: "SIBONGILE", type: "-", route: "Makhathini Street", locality: "Dundee", sublocality: "Sibongile" },
  { number: "16A", street: "Ndumeni", town: "SITHEMBILE", type: "-", route: "Ndumeni Road", locality: "Glencoe", sublocality: "Sithembile" },
  { number: "25", street: "Waschbank", town: "GLENCOE", type: "Road", route: "Waschbank Road", locality: "Glencoe" },
  { number: "104", street: "Biggar", town: "GLENCOE", type: "Street", route: "Biggar Street", locality: "Glencoe" },
];
function sales(item = cases[0]) {
  return { ...structuredClone(fixture.sales), id: "00123", town: item.town,
    adr: { strNo: item.number, strName: item.street, strType: item.type },
    metadata: { createdAt: fixture.stamp, createdByUid: "ORIGINAL", createdByUser: "Original",
      updatedAt: fixture.stamp, updatedByUid: "ORIGINAL", updatedByUser: "Original" } };
}
function response(item = cases[0]) {
  return { status: "OK", results: [{ geometry: { location_type: "ROOFTOP", location: { lat: -28.5, lng: 30.5 } },
    address_components: [
      { types: ["street_number"], long_name: item.number },
      { types: ["route"], long_name: item.route },
      { types: ["locality", "political"], long_name: item.locality },
      ...(item.sublocality ? [{ types: ["sublocality_level_1", "sublocality", "political"], long_name: item.sublocality }] : []),
      { types: ["country"], short_name: "ZA", long_name: "South Africa" },
    ] }] };
}
for (const item of cases) {
  const label = `${item.number} ${item.street} (${item.town}, ${item.type})`;
  test(`DEV regression accepts ${label}`, async () => {
    const row = sales(item), body = response(item), before = structuredClone(row);
    const expected = `${item.number} ${item.street}${item.type === "-" ? "" : ` ${item.type}`}, ${item.town}, KwaZulu-Natal, South Africa`;
    assert.equal(composeSalesGeocodingAddress(row), expected);
    assert.equal(acceptGoogleGeocode(body, row).ok, true);
    let requests = 0;
    const result = await geocodeSalesAddress({ sales: row, apiKey: "offline-test-key", fetchImpl: async value => {
      requests++; const url = new URL(value);
      assert.equal(url.searchParams.get("address"), expected);
      assert.equal(url.searchParams.get("components"), "country:ZA");
      assert.equal(url.searchParams.get("region"), "za");
      assert.doesNotMatch(url.searchParams.get("address"), /ZA5241/);
      return { ok: true, text: async () => JSON.stringify(body) };
    } });
    assert.equal(requests, 1); assert.equal(result.ok, true); assert.equal(result.address, expected);
    assert.deepEqual(row, before);
  });
  test(`DEV regression rejects another street and partial_match for ${label}`, () => {
    const wrong = response(item); wrong.results[0].address_components[1].long_name = "Different Street";
    assert.equal(acceptGoogleGeocode(wrong, sales(item)).code, "NO_EXACT_POSITION");
    const partial = response(item); partial.results[0].partial_match = true;
    assert.equal(acceptGoogleGeocode(partial, sales(item)).code, "NO_EXACT_POSITION");
  });
}
test("unspecified type uses the same placeholder policy as address composition", () => {
  for (const type of [undefined, null, "", "  ", "-", " - ", "NAV", "N/A", "NA", "NULL", "UNDEFINED"]) {
    const row = sales({ ...cases[0], type });
    assert.equal(composeSalesGeocodingAddress(row), "14 Bulwer, DUNDEE, KwaZulu-Natal, South Africa");
    assert.equal(acceptGoogleGeocode(response(), row).ok, true, String(type));
  }
});
test("only one known trailing street-type word may be omitted", () => {
  for (const type of ["Street", "St", "Str", "St.", "Road", "Rd", "Drive", "Dr", "Avenue", "Ave", "Av", "Lane", "Ln", "Crescent", "Cres", "Cr", "Place", "Pl", "Close", "Cl", "Way", "Wy"]) {
    assert.equal(acceptGoogleGeocode(response({ ...cases[0], route: `Bulwer ${type}` }), sales()).ok, true, type);
  }
  assert.equal(acceptGoogleGeocode(response({ ...cases[0], route: "Bulwer" }), sales()).ok, true);
  for (const route of ["Bulwer Access Road", "Bulwer Road Street", "Bulwerstreet", "Bulwer Heights", "Other Bulwer Street", "Bulwer Extension"]) {
    assert.equal(acceptGoogleGeocode(response({ ...cases[0], route }), sales()).ok, false, route);
  }
});
test("a supplied type remains mandatory; number, locality, country and precision stay strict", () => {
  for (const item of cases.slice(4)) {
    for (const route of [item.street, `${item.street} ${item.type === "Road" ? "Street" : "Road"}`]) {
      assert.equal(acceptGoogleGeocode(response({ ...item, route }), sales(item)).ok, false, route);
    }
  }
  const suffix = cases[3];
  for (const number of ["16", "16B", "016A"]) assert.equal(acceptGoogleGeocode(response({ ...suffix, number }), sales(suffix)).ok, false);
  const leading = { ...cases[0], number: "014" };
  assert.equal(acceptGoogleGeocode(response(leading), sales(leading)).ok, true);
  assert.equal(acceptGoogleGeocode(response(), sales(leading)).ok, false);
  assert.equal(acceptGoogleGeocode(response({ ...suffix, locality: "Other", sublocality: "Other" }), sales(suffix)).ok, false);
  const foreign = response(); foreign.results[0].address_components.at(-1).short_name = "US";
  assert.equal(acceptGoogleGeocode(foreign, sales()).ok, false);
  for (const precision of ["RANGE_INTERPOLATED", "GEOMETRIC_CENTER", "APPROXIMATE"]) {
    const body = response(); body.results[0].geometry.location_type = precision;
    assert.equal(acceptGoogleGeocode(body, sales()).ok, false);
  }
});
test("all province prefixes compose locally; unknown/malformed codes are configuration failures before any request", async () => {
  const provinces = ["Western Cape", "Eastern Cape", "Northern Cape", "Free State", "KwaZulu-Natal", "North West", "Gauteng", "Mpumalanga", "Limpopo"];
  provinces.forEach((province, index) => assert.equal(composeSalesGeocodingAddress({ ...sales(), lmPcode: `ZA${index + 1}241` }), `14 Bulwer, DUNDEE, ${province}, South Africa`));
  for (const lmPcode of [undefined, null, "", "ZA0241", "ZA", "ZA5", "ZA5BAD", "XX5241", "za5241", 5241]) {
    const row = { ...sales(), lmPcode };
    assert.equal(composeSalesGeocodingAddress(row), "");
    assert.equal(acceptGoogleGeocode(response(), row).code, "GEOCODING_CONFIGURATION_ERROR");
    assert.equal(acceptGoogleGeocode({ status: "ZERO_RESULTS" }, row).code, "GEOCODING_CONFIGURATION_ERROR");
    const result = await geocodeSalesAddress({ sales: row, apiKey: "offline-test-key", fetchImpl: () => assert.fail("Configuration error must not call Google") });
    assert.equal(result.code, "GEOCODING_CONFIGURATION_ERROR"); assert.equal(result.incomplete, true);
  }
});
function fakeDatabase(row) {
  const profile = { ...structuredClone(fixture.profile), access: { activeWorkbase: { id: row.lmPcode }, workbases: [{ id: row.lmPcode }] } };
  const writes = [];
  const snapshot = path => ({ exists: true, data: () => structuredClone(path.startsWith("users/") ? profile : row) });
  return { writes, db: { projectId: "demo-offline-geocoding", doc: path => ({ path, get: async () => snapshot(path) }),
    collection: () => assert.fail("No ERF query expected"),
    runTransaction: fn => fn({ get: async ref => snapshot(ref.path), update: (ref, patch) => writes.push({ path: ref.path, patch }) }) } };
}
test("unknown province stays a configuration error in resolver, assessment and flag writer, with zero writes", async () => {
  const row = { ...sales(), lmPcode: "ZA0241" }, { db, writes } = fakeDatabase(row);
  const intent = { tbId: fixture.tbId, source: "PREPAID_SALES_NON_GPS", lmPcode: row.lmPcode, salesIds: [row.id] };
  const request = { auth: { uid: fixture.actor.uid, token: {} }, data: intent };
  const resolved = await resolveSalesBatch({ db, request, geocode: () => assert.fail("Configuration must be checked before lookup") });
  assert.equal(resolved.rows[0].code, "GEOCODING_CONFIGURATION_ERROR"); assert.equal(resolved.rows[0].ready, false);
  assert.match(resolved.rows[0].reason, /configured province/);
  const assessed = await readDraftAssessment({ db, intent, actor: fixture.actor });
  assert.equal(assessed.rows[0].code, "GEOCODING_CONFIGURATION_ERROR");
  await assert.rejects(recordFailedLookup({ db, request, intent, salesId: row.id, address: "", outcome: "NO_EXACT_POSITION" }), { code: "GEOCODING_CONFIGURATION_ERROR" });
  assert.deepEqual(writes, []); assert.equal(Object.hasOwn(row, "erfLookup"), false);
});
test("provider, failed flag and UI use one province address; old LM-code flags become stale without a migration", async () => {
  const row = sales(), { db, writes } = fakeDatabase(row), before = structuredClone(row);
  const intent = { tbId: fixture.tbId, source: "PREPAID_SALES_NON_GPS", lmPcode: row.lmPcode, salesIds: [row.id] };
  const request = { auth: { uid: fixture.actor.uid, token: {} }, data: intent };
  await resolveSalesBatch({ db, request, now: () => fixture.stamp,
    geocode: value => geocodeSalesAddress({ sales: value, apiKey: "offline-test-key", fetchImpl: async url => {
      assert.equal(new URL(url).searchParams.get("address"), composeSalesGeocodingAddress(row));
      return { ok: true, text: async () => JSON.stringify({ status: "ZERO_RESULTS" }) };
    } }) });
  assert.equal(writes.length, 1);
  const patch = writes[0].patch, flagged = { ...row, erfLookup: patch.erfLookup };
  assert.equal(patch.erfLookup.address, "14 Bulwer, DUNDEE, KwaZulu-Natal, South Africa");
  assert.equal(inspectErfLookup(flagged).flagged, true);
  assert.equal(evaluateSalesBatchability(flagged).code, "NEEDS_MANUAL_ERFING");
  const old = { ...flagged, erfLookup: { ...flagged.erfLookup, address: "14 Bulwer, DUNDEE, ZA5241, South Africa" } };
  assert.equal(inspectErfLookup(old).flagged, false); assert.equal(evaluateSalesBatchability(old).batchable, true);
  assert.deepEqual(Object.keys(patch).sort(), ["erfLookup", "metadata.updatedAt", "metadata.updatedByUid", "metadata.updatedByUser"]);
  assert.deepEqual(row, before);
});
