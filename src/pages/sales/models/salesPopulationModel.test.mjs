import test from "node:test";
import assert from "node:assert/strict";
import { buildSalesPopulationReadModel, buildMonthlyPopulation } from "./salesPopulationModel.js";

const members = Array.from({ length: 100 }, (_, i) => `M${String(i).padStart(3, "0")}`);
const snapshot = { schemaVersion: 1, sourceSha256: "a".repeat(64), completeness: { complete: true, evidenceSha256: "b".repeat(64) }, month: "2026-08", lmPcode: "ZA5241", provider: "contour", members, exceptions: [], replacements: [] };
const entry = { leakageCategory: "Normal", riskTier: "Normal", riskScore: 0 };
const rows = members.slice(0, 80).map(id => ({ id, lmPcode: "ZA5241", hasUsableGps: true, monthlyCategories: { "2026-08": entry } }));
const build = (snapshots = [snapshot], salesRows = rows) => buildSalesPopulationReadModel({ snapshots, month: "2026-08", lmPcode: "ZA5241", salesRows });

test("100 snapshot members and 80 Sales documents keeps denominator 100 and coverage 80%", () => {
  const result = build();
  assert.equal(result.status, "ready");
  assert.equal(result.total, 100);
  assert.equal(result.availableDocuments, 80);
  assert.equal(result.documentCoverage, 80);
  assert.equal(result.gpsUnknown, 20);
  assert.equal(result.withoutGps, 0);
  assert.equal(result.fieldTarget, 0);
  assert.equal(result.categoryUnavailable, 20);
  assert.equal(build([snapshot], [...rows, { id: "OUTSIDE", lmPcode: "ZA5241" }]).total, 100);
});

test("unknown attributes and scalar categories do not become no-GPS or field targets", () => {
  const result = build([snapshot], rows.map(row => ({ ...row, hasUsableGps: false, gpsAvailable: false, monthlyCategories: {}, leakageCategory: "CAT1" })));
  assert.equal(result.gpsUnknown, 100);
  assert.equal(result.withoutGps, 0);
  assert.equal(result.fieldTarget, 0);
  assert.equal(result.categoryUnavailable, 100);
});

test("malformed publication responses are explicit invalid/unavailable results and never render throws", () => {
  for (const input of [null, {}, [null], [{ ...snapshot, members: null }], [{ ...snapshot, members: ["A", "A"] }], [{ ...snapshot, exceptions: null }], [{ ...snapshot, exceptions: [null] }], [{ ...snapshot, replacements: [null] }], [{ ...snapshot, completeness: {} }], [snapshot, snapshot], [{ ...snapshot, lmPcode: "ZA9999" }]]) {
    let result;
    assert.doesNotThrow(() => { result = build(input); });
    assert.equal(result.status, "invalid");
    assert.equal(result.total, undefined);
  }
  assert.equal(build([]).status, "unavailable");
  assert.equal(buildMonthlyPopulation(null, "2026-08").status, "invalid");
});
