import test from "node:test";
import assert from "node:assert/strict";
import { buildMdBgoRowsSummary, enrichMdBgoRows, getMdBgoRowProgress, mdBgoRowSearchValue } from "./mdBgoRowsModel.js";

test("MD BGO row progress uses only the canonical row state", () => {
  assert.equal(getMdBgoRowProgress("IN_PROGRESS"), "IN_PROGRESS");
  assert.equal(getMdBgoRowProgress("COMPLETED"), "COMPLETED");
  assert.equal(getMdBgoRowProgress("ISSUED"), "NOT_STARTED");
  assert.equal(getMdBgoRowProgress(""), "UNAVAILABLE");
});

test("MD BGO row summary counts each work row once", () => {
  assert.deepEqual(buildMdBgoRowsSummary([
    { workflow: { state: "READY_FOR_ALLOCATION" } },
    { workflow: { state: "IN_PROGRESS" } },
    { workflow: { state: "COMPLETED" } },
    { workflow: { state: "UNKNOWN" } },
  ]), { total: 4, notStarted: 1, inProgress: 1, completed: 1, unavailable: 1 });
});

test("premise rows keep their ERF identity and join premise and meter details", () => {
  const [seed, first, repeat] = enrichMdBgoRows({
    rows: [
      { id: "R1", rowNo: 1, erf: { id: "E1", erfNo: "100" }, workflow: { state: "ISSUED" } },
      { id: "R2", rowNo: 2, erf: { id: "E1", erfNo: "100" }, refs: { premiseId: "P1" }, workflow: { state: "IN_PROGRESS" } },
      { id: "R3", rowNo: 3, erf: { id: "E1", erfNo: "100" }, refs: { premiseId: "P2" }, workflow: { state: "COMPLETED" } },
    ],
    premises: [
      { id: "P1", premiseNo: "A", address: { strNo: "1", strName: "Main", strType: "Road" }, propertyType: { type: "Flat", unitNo: "1" } },
      { id: "P2", premiseNo: "B", propertyType: { type: "Flat", unitNo: "2" } },
    ],
    meters: [{ id: "M1", accessData: { premise: { id: "P1" } }, astData: { astNo: "12345" } }],
  });
  assert.equal(seed.premiseId, "");
  assert.equal(first.erfNo, "100");
  assert.equal(first.propertyType, "Flat");
  assert.equal(first.premiseAddress, "1 Main Road");
  assert.equal(first.meterNumbers, "12345");
  assert.equal(repeat.premiseNo, "B");
  assert.match(mdBgoRowSearchValue(first), /Main Road.*Flat.*12345/);
});
