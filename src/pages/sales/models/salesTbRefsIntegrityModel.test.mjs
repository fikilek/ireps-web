import assert from "node:assert/strict";
import test from "node:test";
import { inspectSalesTbRefsIntegrity } from "./salesTbRefsIntegrityModel.js";
const timestamp = { seconds: 1789200000, nanoseconds: 0 };
const TB = "TGB_20260913_120000_AAAA";
const start = (extra = {}) => ({ id: TB, date: timestamp, rowId: "ROW1", fieldWork: { status: "IN_PROGRESS", updatedAt: timestamp }, ...extra });
for (const [name, value, valid] of [
  ["absent", undefined, true], ["null", null, false], ["non-array", {}, false], ["empty", [], true],
  ["creation", [{ id: TB, date: timestamp }], true], ["legacy creation", [{ tbId: TB, date: timestamp }], true],
  ["fieldwork start", [start()], true], ["legacy fieldwork", [{ ...start(), id: undefined }], false],
  ["unknown root", [{ ...start(), future: true }], false],
  ["unknown fieldwork", [start({ fieldWork: { ...start().fieldWork, future: true } })], false],
  ["missing timestamp", [start({ date: undefined })], false], ["string timestamp", [start({ date: "2026-09-13" })], false],
  ["missing rowId", [start({ rowId: undefined })], false],
  ["explicit NOT_STARTED", [start({ fieldWork: { status: "NOT_STARTED", updatedAt: timestamp } })], false],
  ["NA visit", [start({ fieldWork: { ...start().fieldWork, noAccess: [{ date: "2026-09-13", time: "12:30:00", user: "Operator" }] } })], true],
  ["NA unknown key", [start({ fieldWork: { ...start().fieldWork, noAccess: [{ date: "2026-09-13", time: "12:30:00", user: "Operator", extra: true }] } })], false],
]) test("strict TB8: " + name, () => {
  const before = structuredClone(value); const result = inspectSalesTbRefsIntegrity(value);
  assert.equal(result.valid, valid); assert.equal(result.issues.length === 0, valid); assert.deepEqual(value, before);
});
test("a malformed sibling does not hide a valid classifiable reference", () => {
  const result = inspectSalesTbRefsIntegrity([{ id: "BROKEN" }, start()]);
  assert.equal(result.valid, false); assert.deepEqual(result.entries.map(item => item.classifiable), [false, true]);
  assert.equal(result.entriesByKey[`${TB}::ROW1`].classifiable, true);
});
for (const second of [start(), start({ rowId: "ROW2" }), start({ date: null })]) for (const reverse of [false, true]) {
  test("duplicate logical identity suppresses all members regardless of row, validity or order: " + JSON.stringify([second,reverse]), () => {
    const entries = reverse ? [second, start()] : [start(), second];
    const result = inspectSalesTbRefsIntegrity(entries);
    assert.equal(result.valid, false); assert.ok(result.entries.every(item => item.duplicateLogicalIdentity && !item.classifiable));
  });
}
for (const id of [TB.toLowerCase(), ` ${TB} `]) test("malformed spelling is rejected without repairing identity: " + id, () => {
  const result = inspectSalesTbRefsIntegrity([start(), start({ id })]);
  assert.equal(result.valid, false); assert.deepEqual(result.entries.map(item => item.classifiable), [true, false]);
});
test("legacy tbId is accepted, while conflicting aliases and tbRowId are not canonical", () => {
  const legacy = start(); delete legacy.id; legacy.tbId = TB;
  assert.equal(inspectSalesTbRefsIntegrity([legacy]).entries[0].classifiable, true);
  assert.equal(inspectSalesTbRefsIntegrity([start(), legacy]).entries.every(item => !item.classifiable), true);
  assert.equal(inspectSalesTbRefsIntegrity([start({ tbId: "TGB_20260913_120000_BBBB" })]).valid, false);
  delete legacy.rowId; legacy.tbRowId = "ROW1";
  assert.equal(inspectSalesTbRefsIntegrity([legacy]).valid, false);
});
