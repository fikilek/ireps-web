import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("Targeted Batch central Sales binding is Sales All and lmPcode is strict", async () => {
  const source = await read("../targetedBatches/helpers.js");
  assert.match(source, /sales:\s*"sales-all-meters"/);
  assert.doesNotMatch(source, /sales:\s*"demo_sales_meters"/);
  assert.match(source, /if \(!sourceLmPcode\)/);
  assert.match(source, /SALES_LM_SCOPE_MISSING/);
  assert.match(source, /if \(sourceLmPcode !== expectedLmPcode\)/);
});

test("Targeted Batch creation owns only tbRefs on Sales", async () => {
  const source = await read("../targetedBatches/callables.js");
  assert.doesNotMatch(source, /batchFail/);
  assert.match(source, /tbRefs:\s*FieldValue\.arrayUnion\(salesTbRef\)/);
  assert.doesNotMatch(source, /geofenceRefs\s*:/);
  assert.doesNotMatch(source, /master\s*:/);
});

test("Geofence CREATE reads canonical Sales All GPS field and uses atomic membership", async () => {
  const trigger = await read("../geofences/triggers.js");
  const membership = await read("../geofences/salesMembership.js");

  assert.match(trigger, /\.collection\("sales-all-meters"\)/);
  assert.match(trigger, /\.where\("hasUsableGps",\s*"==",\s*true\)/);
  assert.doesNotMatch(trigger, /\.collection\("demo_sales_meters"\)/);
  assert.doesNotMatch(trigger, /\.where\("HasUsableGps"/);
  assert.match(trigger, /commitGeoFenceSalesMembershipUpdates/);

  assert.match(membership, /FieldValue\.arrayUnion\(update\.geoFenceRef\)/);
  assert.match(membership, /GEOFENCE_REF_NAME_CONFLICT/);
  assert.match(membership, /GEOFENCE_REF_DUPLICATE_LOGICAL_ID/);
  assert.doesNotMatch(membership, /geofenceRefs:\s*nextGeoFenceRefs/);
});

test("both Web Sales readers stream Sales All", async () => {
  const tableApi = await read("../../src/redux/demoSalesApi.js");
  const reportingApi = await read("../../src/redux/salesTargetedBatchApi.js");

  assert.match(tableApi, /const DEMO_SALES_COLLECTION = "sales-all-meters"/);
  assert.match(tableApi, /onSnapshot\(/);
  assert.match(tableApi, /where\("lmPcode",\s*"==",\s*normalizedLmPcode\)/);
  assert.doesNotMatch(tableApi, /const DEMO_SALES_COLLECTION = "demo_sales_meters"/);

  assert.match(reportingApi, /const SALES_COLLECTION = "sales-all-meters"/);
  assert.match(reportingApi, /onSnapshot\(/);
  assert.doesNotMatch(reportingApi, /const SALES_COLLECTION = "demo_sales_meters"/);
});
