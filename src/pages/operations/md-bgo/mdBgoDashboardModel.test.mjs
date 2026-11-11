import test from "node:test";
import assert from "node:assert/strict";
import { buildMdBgoDashboard, mdBgoChartScale, mdBgoMunicipalCoverage, resolveMdBgoDashboardWorkbase } from "./mdBgoDashboardModel.js";

const batch = (id = "b") => ({ id, operationType: "METER_DISCOVERY", workflow: { state: "IN_PROGRESS" }, scope: { wardPcode: "ZA5241006" }, geofenceRef: { name: "Flats" }, bgo: { targetId: "team", targetName: "Peter Team" }, worklist: { erfRefs: [{ id: "erf" }] } });
const wards = [{ id: "ward", pcode: "ward" }];
const summaries = [{ ward: { pcode: "ward" }, calculation: { state: "READY" }, counts: { totalErfs: 10 } }];
const row = (id, state, premiseId, meterId) => ({ id, bgoBatchId: "b", workflow: { state }, erf: { id: "erf" }, refs: { premiseId, meterId } });

test("additional flat premises increase workload immediately without increasing ERF coverage", () => {
  const initial = { batches: [batch()], rows: [row("a", "IN_PROGRESS", "A")], wards, summaries };
  const before = buildMdBgoDashboard(initial);
  const after = buildMdBgoDashboard({ ...initial, rows: [...initial.rows, row("b", "IN_PROGRESS", "B")] });
  assert.equal(before.total, 1); assert.equal(after.total, 2); assert.equal(after.inProgress, 2);
  assert.equal(after.erfs, 1); assert.equal(after.premises, 2); assert.equal(after.meters, 0);
  assert.deepEqual(after.coverage, { total: 10, unbatched: 9, percent: 10, error: "" });
  assert.equal(after.batches[0].team, "Peter Team"); assert.equal(after.batches[0].status, "IN PROGRESS");
});

test("work counts match Register and distinct entities are not inflated by duplicates or extra meters", () => {
  const rows = [row("a", "COMPLETED", "A", "m1"), row("b", "IN_PROGRESS", "A", "m2"), row("c", "ACCEPTED"), row("d", "CANCELLED", "bad", "bad")];
  const model = buildMdBgoDashboard({ batches: [batch(), batch()], rows: [...rows, rows[0]], wards, summaries });
  assert.equal(model.batchCount, 1); assert.equal(model.total, 3); assert.equal(model.notStarted, 1); assert.equal(model.inProgress, 1); assert.equal(model.completed, 1);
  assert.equal(model.total, model.notStarted + model.inProgress + model.completed);
  assert.equal(model.premises, 1); assert.equal(model.meters, 2); assert.equal(model.erfs, 1);
});

test("coverage unions batch ERF membership and excludes cancelled or unrelated work", () => {
  const cancelled = { ...batch("cancelled"), workflow: { state: "CANCELLED" }, worklist: { erfRefs: ["outside"] } };
  const model = buildMdBgoDashboard({ batches: [batch(), batch("overlap"), cancelled, { id: "tb", operationType: "OTHER" }], rows: [row("a", "READY_FOR_ALLOCATION"), { ...row("x", "COMPLETED"), bgoBatchId: "cancelled" }, { ...row("y", "COMPLETED"), bgoBatchId: "tb" }], wards, summaries });
  assert.equal(model.batchCount, 2); assert.equal(model.erfs, 1); assert.equal(model.total, 1);
});

test("coverage does not invent a denominator for missing, pending or invalid ward summaries", () => {
  assert.equal(mdBgoMunicipalCoverage(wards, []).total, null);
  for (const state of ["PENDING", "UNAVAILABLE"]) assert.equal(mdBgoMunicipalCoverage(wards, [{ ...summaries[0], calculation: { state } }]).percent, null);
  assert.equal(mdBgoMunicipalCoverage(wards, [{ ...summaries[0], counts: { totalErfs: "10" } }]).total, null);
  assert.equal(mdBgoMunicipalCoverage(wards, summaries, 11).unbatched, null);
  assert.equal(mdBgoMunicipalCoverage([...wards, wards[0]], summaries).total, 10);
});

test("empty municipality and zero-work batches produce finite, truthful empty graphs", () => {
  const model = buildMdBgoDashboard(); assert.equal(model.total, 0); assert.equal(model.completion, 0); assert.equal(model.coverage.percent, 0);
  assert.deepEqual(mdBgoChartScale([]), { max: 1, ticks: [0, 1] });
  const scale = mdBgoChartScale([{ total: 61 }, { total: 27 }]); assert.ok(scale.max >= 61); assert.equal(scale.ticks.at(-1), scale.max);
});

test("active workbase resolves municipality name without the former undefined identifier", () => {
  assert.deepEqual(resolveMdBgoDashboardWorkbase({ activeWorkbase: { lmPcode: "ZA5241", name: "Endumeni" } }), { lmPcode: "ZA5241", lmName: "Endumeni" });
  assert.deepEqual(resolveMdBgoDashboardWorkbase({}, {}), { lmPcode: "", lmName: "NAv" });
});
