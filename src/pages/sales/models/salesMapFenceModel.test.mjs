import test from "node:test";
import assert from "node:assert/strict";
import { SALES_MAP_FENCE_LIMIT, salesMapFenceCount, salesMapFenceCountText, salesMapFenceDraftChoice, salesMapFenceErfIds, salesMapFenceProgress } from "./salesMapFenceModel.js";

// Targeted Batch rules TB-R055 (1.3.47): the GPS Sales map's live count and hand-off.
const LM = "ZA5241", WARD = "ZA5241006", MONTH = "2026-08";
const cat = { [MONTH]: { leakageCategory: "CAT4 - Long Gap (4+ months)" } };
// A table row (normalized candidates) with its GPS pin and pipeline ERF.
const row = (id, erfId, [lng, lat] = [5, 5], extra = {}) => ({ id, master: { id, visibility: "INVISIBLE" }, meterNo: id, meterNoNormalized: id, lmPcode: LM, town: "Dundee", adr: { strNo: "1", strName: "Ayob" },
  tbRefs: [], hasUsableGps: true, monthlyCategories: cat, erfCandidates: [{ erfId, latitude: lat, longitude: lng, wardPcode: WARD, lmPcode: LM, hasValidGps: true }], ...extra });
const erf = (lng, lat, ward = WARD) => ({ admin: { ward: { pcode: ward }, localMunicipality: { pcode: LM } }, centroid: { latitude: lat, longitude: lng } });
const square = [{ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, { lat: 10, lng: 10 }, { lat: 10, lng: 0 }];
const count = (rows, erfsById, points = square) => salesMapFenceCount({ points, rows, erfsById, lmPcode: LM, wardPcode: WARD, categoryMonth: MONTH });

test("both numbers: GPS pins inside, and meters that can be batched with their ERF centroid inside", () => {
  // Sales IDs are capital letters and digits only.
  const rows = [row("A", "E1"), row("DONE", "E2", [5, 5], { master: { id: "DONE", visibility: "VISIBLE" } }), row("PINOUT", "E3", [20, 20]), row("ERFOUT", "E4")];
  const erfs = new Map([["E1", erf(5, 5)], ["E2", erf(5, 5)], ["E3", erf(5, 5)], ["E4", erf(20, 20)]]);
  const result = count(rows, erfs);
  assert.equal(result.inside, 3, "A, DONE and ERFOUT have their pin inside");
  assert.deepEqual(result.batchableIds, ["A", "PINOUT"], "PINOUT's ERF centroid is inside; ERFOUT's is not; DONE is Completed");
  assert.equal(result.canSave, true);
  assert.equal(salesMapFenceCountText({ pointsCount: 4, count: result }).text, "Inside: 3 Sales meters · 2 can be batched");
});

test("more than 30 turns the count into Too many and blocks Save; none blocks Save too", () => {
  const rows = Array.from({ length: 31 }, (_, index) => row(`M${String(index).padStart(2, "0")}`, `E${index}`));
  const erfs = new Map(rows.map((item, index) => [`E${index}`, erf(5, 5)]));
  const over = count(rows, erfs);
  assert.equal(SALES_MAP_FENCE_LIMIT, 30);
  assert.equal(over.over, true);
  assert.equal(over.canSave, false);
  assert.equal(salesMapFenceCountText({ pointsCount: 4, count: over }).text, "Inside: 31 Sales meters · 31 can be batched. Too many: 31 — the limit is 30.");
  assert.equal(salesMapFenceCountText({ pointsCount: 4, count: over }).tone, "error");
  const none = count([row("DONE", "E1", [5, 5], { master: { id: "DONE", visibility: "VISIBLE" } })], new Map([["E1", erf(5, 5)]]));
  assert.equal(none.canSave, false);
  assert.match(salesMapFenceCountText({ pointsCount: 4, count: none }).text, /Save needs at least one meter that can be batched/);
});

test("the count waits for 3 points, a shape that does not cross itself, and the ERFs", () => {
  assert.match(salesMapFenceCountText({ pointsCount: 2, count: count([], new Map(), square.slice(0, 2)) }).text, /at least 3 points/);
  const crossing = [{ lat: 0, lng: 0 }, { lat: 10, lng: 10 }, { lat: 0, lng: 10 }, { lat: 10, lng: 0 }];
  assert.match(salesMapFenceCountText({ pointsCount: 4, count: count([], new Map(), crossing) }).text, /crosses itself/);
  assert.match(salesMapFenceCountText({ pointsCount: 4, count: count([], new Map()), loading: true }).text, /Counting/);
});

test("only the ERFs of meters that can be batched are read", () => {
  const rows = [row("A", "E1"), row("DONE", "E2", [5, 5], { master: { id: "DONE", visibility: "VISIBLE" } }), row("NOGPS", "E3", [5, 5], { hasUsableGps: false, erfCandidates: [] }), row("B", "E1")];
  assert.deepEqual(salesMapFenceErfIds(rows, { lmPcode: LM, categoryMonth: MONTH }), ["E1"]);
});

test("progress: saved, then linked when the geofence's own processing has finished", () => {
  const fence = { id: "F1", metadata: { updatedByUid: "SYSTEM", updatedByUser: "onGeoFenceCreated" } };
  assert.equal(salesMapFenceProgress({ phase: "saving" }).done, false);
  assert.equal(salesMapFenceProgress({ phase: "saved", fenceId: "F1", fence: { id: "F1", metadata: { updatedByUid: "U1" } } }).done, false);
  assert.equal(salesMapFenceProgress({ phase: "saved", fenceId: "F1", fence }).done, true);
  const late = salesMapFenceProgress({ phase: "saved", fenceId: "F1", fence: null, timedOut: true });
  assert.equal(late.done, true);
  assert.equal(late.stillLinking, true);
});

test("Create Target Batch: the geofence's ticked meters, a meter outside it named, or an ordinary selection", () => {
  const fence = { id: "F1", name: "Gf W6 Ayob", tbId: "TGB_20260919_010000_AB12", salesIds: ["A", "B", "C"] };
  assert.deepEqual(salesMapFenceDraftChoice({ fence, selectedIds: new Set(["A", "C"]) }), { kind: "fence", keepIds: ["A", "C"], removeIds: ["B"] });
  const outside = salesMapFenceDraftChoice({ fence, selectedIds: new Set(["A", "X"]), rows: [{ id: "X", meterNo: "04297698500" }] });
  assert.equal(outside.kind, "outside");
  assert.equal(outside.message, "1 ticked meter is not in Gf W6 Ayob: 04297698500. Untick it to create this geofence's batch.");
  assert.deepEqual(salesMapFenceDraftChoice({ fence, selectedIds: new Set(["X"]) }), { kind: "normal" });
  assert.deepEqual(salesMapFenceDraftChoice({ fence: null, selectedIds: new Set(["A"]) }), { kind: "normal" });
});
