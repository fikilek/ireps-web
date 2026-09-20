// Targeted Batch rules TB-R065 (1.3.69): Site Meter and Same Meter on the Sales tables.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { SAME_METER, salesSiteMeter } from "../../../../functions/salesAllMeters/sales-batch-policy.js";
import { SAME_METER_FILTER_OPTIONS, sameMeterSortRank, sameMeterText } from "./site-meter-model.js";

const SALES = "04298085574";
const FOUND = "04298085599";
const ts = { seconds: 1789922416, nanoseconds: 0 };
const base = (extra = {}) => ({ id: SALES, meterNoNormalized: SALES, master: { visibility: "INVISIBLE" }, ...extra });
const differentMeterFound = {
  version: 1, meterNo: FOUND, erfId: "ERF1", trnId: "TRN1", trnType: "METER_DISCOVERY", astId: "TRN1", foundAt: ts,
  finder: { uid: "U1", user: "Kaiser Kaiser", role: "FWR", teamId: null, teamName: null, serviceProviderId: "SP1", serviceProviderName: "Cat Matlala Meters 24" },
  tbId: "TGB_20260920_043338_X70E", rowId: "TBR_20260920_043338_X70E_000005", creditedToBatch: false, rule: "TB-R063", rulesVersion: "1.3.66",
};
const tbRef = (fieldWork) => [{ id: "TGB_20260920_043338_X70E", date: ts, rowId: "TBR_20260920_043338_X70E_000005", fieldWork }];
const completedFieldWork = (discoveredMeterNo, meterMatch) => ({
  status: "COMPLETED", outcomeCode: "METER_DISCOVERED", outcomeLabel: "Meter Discovered", targetedMeterNo: SALES,
  discoveredMeterNo, meterMatch, premiseId: "PRM1", meterId: "TRN1", trnId: "TRN1", submittedAt: ts, updatedAt: ts,
});

test("a different meter found at the ERF is the site meter, and it is not the same meter", () => {
  assert.deepEqual(salesSiteMeter(base({ differentMeterFound }), SALES), { meterNo: FOUND, sameMeter: SAME_METER.NO, source: "DIFFERENT_METER_FOUND" });
});

test("the batch's own field work gives the site meter", () => {
  assert.deepEqual(salesSiteMeter(base({ tbRefs: tbRef(completedFieldWork(SALES, true)) }), SALES), { meterNo: SALES, sameMeter: SAME_METER.YES, source: "FIELD_WORK" });
  assert.deepEqual(salesSiteMeter(base({ tbRefs: tbRef(completedFieldWork(FOUND, false)) }), SALES), { meterNo: FOUND, sameMeter: SAME_METER.NO, source: "FIELD_WORK" });
});

test("a visible meter was found as itself", () => {
  assert.deepEqual(salesSiteMeter(base({ master: { visibility: "VISIBLE" } }), SALES), { meterNo: SALES, sameMeter: SAME_METER.YES, source: "VISIBLE" });
});

test("nobody has been there: no site meter, and NAv", () => {
  assert.deepEqual(salesSiteMeter(base(), SALES), { meterNo: null, sameMeter: SAME_METER.NAV, source: "NONE" });
  assert.deepEqual(salesSiteMeter(base({ tbRefs: tbRef({ status: "IN_PROGRESS", updatedAt: ts }) }), SALES), { meterNo: null, sameMeter: SAME_METER.NAV, source: "NONE" });
});

test("a malformed record of a different meter never becomes a site meter", () => {
  const broken = { ...differentMeterFound, finder: { uid: "U1" } };
  assert.deepEqual(salesSiteMeter(base({ differentMeterFound: broken }), SALES), { meterNo: null, sameMeter: SAME_METER.NAV, source: "NONE" });
});

test("legacy TbRefs are read, spaces never make a match look different, and the newest find wins", () => {
  const legacy = { id: SALES, meterNoNormalized: SALES, master: { visibility: "INVISIBLE" }, TbRefs: tbRef(completedFieldWork(FOUND, false)) };
  assert.deepEqual(salesSiteMeter(legacy, SALES), { meterNo: FOUND, sameMeter: SAME_METER.NO, source: "FIELD_WORK" });

  const spaced = base({ tbRefs: tbRef(completedFieldWork("0429 8085574", true)) });
  assert.equal(salesSiteMeter(spaced, SALES).sameMeter, SAME_METER.YES, "a stored number with a space is the same meter");

  const older = { id: "TGB_20260101_010101_AAAA", date: ts, rowId: "R_OLD", fieldWork: { ...completedFieldWork("04298085500", false), updatedAt: { seconds: 1700000000, nanoseconds: 0 } } };
  const newer = { id: "TGB_20260920_043338_X70E", date: ts, rowId: "R_NEW", fieldWork: { ...completedFieldWork(FOUND, false), updatedAt: { seconds: 1789922417, nanoseconds: 0 } } };
  assert.equal(salesSiteMeter(base({ tbRefs: [older, newer] }), SALES).meterNo, FOUND);
  assert.equal(salesSiteMeter(base({ tbRefs: [newer, older] }), SALES).meterNo, FOUND, "array order never decides");
});

test("the words and the three filter values", () => {
  assert.deepEqual(SAME_METER_FILTER_OPTIONS.map(option => option.label), ["Yes", "No", "NAv"]);
  assert.equal(sameMeterText(SAME_METER.YES), "Yes");
  assert.equal(sameMeterText(SAME_METER.NO), "No");
  assert.equal(sameMeterText(SAME_METER.NAV), "NAv");
  assert.equal(sameMeterText(undefined), "NAv");
  assert.deepEqual([SAME_METER.NO, SAME_METER.YES, SAME_METER.NAV].map(sameMeterSortRank), [0, 1, 2]);
});

test("the table shows both columns by default, lets them be hidden, and filters on all three values", async () => {
  const table = await readFile(new URL("../components/SalesMetersTable.jsx", import.meta.url), "utf8");
  for (const needle of [
    "siteMeter: true", "sameMeter: true",
    '{ key: "siteMeter", label: "Site Meter" }', '{ key: "sameMeter", label: "Same Meter" }',
    "columnVisibility.siteMeter", "columnVisibility.sameMeter",
    "row.siteMeterNo", "sameMeterText(row.sameMeter)",
    "SAME_METER_FILTER_OPTIONS", "selectedSameMeters.has(row?.sameMeter)",
    'includesText(row?.siteMeterNo, filters.siteMeterNo)',
  ]) assert.ok(table.includes(needle), `the Sales table is missing ${needle}`);
  const api = await readFile(new URL("../../../redux/salesApi.js", import.meta.url), "utf8");
  assert.ok(api.includes("siteMeterNo: siteMeter.meterNo") && api.includes("sameMeter: siteMeter.sameMeter"), "the Sales rows must carry the site meter");
});
