import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  ALLOCATION_MAP_MAX,
  ALLOCATION_MAP_STATES,
  allocateButtonLabel,
  allocationMapLabel,
  allocationSelection,
  buildAllocationMapModel,
  toggleAllocationSelection,
} from "./allocationMapModel.js";

// Targeted Batch rules TB-R047 (1.3.31): the Allocation Map.
const read = path => readFile(new URL(path, import.meta.url), "utf8");
const batch = ({ id, ward = "ZA5241006", meters = 6, allocatedTo = null, execution = "NOT_STARTED", schemaVersion = "0.3.0", creation = "READY", geofenceId = `F_${id}` }) => ({
  id, schemaVersion, source: { type: "PREPAID_SALES_NON_GPS" }, creation: { state: creation }, execution: { status: execution }, geofenceId,
  allocation: allocatedTo ? { status: "ALLOCATED", targetType: "TEAM", targetId: "TEAM1", targetName: allocatedTo } : { status: "NOT_STARTED" },
  counts: { totalRows: meters }, scope: { lmPcode: "ZA5241", wardPcode: ward } });
const fence = ({ id, tbId, name, ward = "ZA5241006", linkState = "LINKED", status = "ACTIVE" }) => ({ id, name, status, parents: { lmPcode: "ZA5241", wardPcode: ward }, targetedBatch: { tbId, linkState },
  geometry: { points: [{ lat: -28.16, lng: 30.23 }, { lat: -28.16, lng: 30.24 }, { lat: -28.17, lng: 30.24 }] } });

test("every batch geofence is on the map, labelled with its name and meters; allocated ones name their TEAM", () => {
  const model = buildAllocationMapModel({
    batches: [batch({ id: "TB1", meters: 6, ward: "ZA5241002" }), batch({ id: "TB2", meters: 8, ward: "ZA5241004" }),
      batch({ id: "TB3", meters: 2, allocatedTo: "Kaiser Team" }), batch({ id: "TB4", meters: 5, execution: "IN_PROGRESS" }),
      batch({ id: "TB5", meters: 3, geofenceId: null }), batch({ id: "TB6", meters: 4, schemaVersion: "0.2.0", geofenceId: null })],
    geofences: [fence({ id: "F_TB1", tbId: "TB1", name: "Gf W2 Boundary1", ward: "ZA5241002" }), fence({ id: "F_TB2", tbId: "TB2", name: "Gf W4 Cornhill1", ward: "ZA5241004" }),
      fence({ id: "F_TB3", tbId: "TB3", name: "Gf W6 Boundary1" }), fence({ id: "F_TB4", tbId: "TB4", name: "Gf W6 Started" })],
  });
  // 1.3.32: the label reads on three rows — name, meters, then the TEAM or SP of an allocated batch.
  assert.deepEqual(model.items.map(item => [item.name, item.state, item.labelLines]), [
    ["Gf W2 Boundary1", ALLOCATION_MAP_STATES.READY, ["Gf W2 Boundary1", "6 meters"]],
    ["Gf W4 Cornhill1", ALLOCATION_MAP_STATES.READY, ["Gf W4 Cornhill1", "8 meters"]],
    ["Gf W6 Boundary1", ALLOCATION_MAP_STATES.ALLOCATED, ["Gf W6 Boundary1", "2 meters", "Kaiser Team"]],
    ["Gf W6 Started", ALLOCATION_MAP_STATES.UNAVAILABLE, ["Gf W6 Started", "5 meters"]],
  ]);
  assert.equal(model.items[2].label, "Gf W6 Boundary1 · 2 meters · Kaiser Team", "the one-line form stays for tooltips");
  assert.deepEqual([model.counts.ready, model.counts.allocated, model.readyNotOnMap], [2, 1, 2], "batches without a geofence are counted, not drawn");
  assert.deepEqual(model.items.map(item => item.wardLabel), ["Ward 2", "Ward 4", "Ward 6", "Ward 6"]);
  assert.equal(allocationMapLabel({ name: "Gf W6 One", meters: 1, state: ALLOCATION_MAP_STATES.READY }), "Gf W6 One · 1 meter");
});

test("clicking adds and removes a ready batch, never an allocated one, and stops at 15", () => {
  const ready = tbId => ({ tbId, state: ALLOCATION_MAP_STATES.READY });
  assert.deepEqual(toggleAllocationSelection([], ready("TB1")), { selectedIds: ["TB1"], message: "" });
  assert.deepEqual(toggleAllocationSelection(["TB1", "TB2"], ready("TB1")), { selectedIds: ["TB2"], message: "" });
  assert.deepEqual(toggleAllocationSelection(["TB1"], { tbId: "TB3", state: ALLOCATION_MAP_STATES.ALLOCATED }), { selectedIds: ["TB1"], message: "" });
  const full = Array.from({ length: ALLOCATION_MAP_MAX }, (_, index) => `TB${index}`);
  const blocked = toggleAllocationSelection(full, ready("TB99"));
  assert.deepEqual([blocked.selectedIds, blocked.message], [full, "At most 15 batches can be allocated in one step."]);
  assert.equal(toggleAllocationSelection(full, ready("TB0")).selectedIds.length, ALLOCATION_MAP_MAX - 1, "unselecting always works");
});

test("the allocation window totals the selection and drops a batch that is no longer ready", () => {
  const items = buildAllocationMapModel({
    batches: [batch({ id: "TB1", meters: 6, ward: "ZA5241002" }), batch({ id: "TB2", meters: 8, ward: "ZA5241004" }), batch({ id: "TB3", meters: 2, allocatedTo: "Simo Team" })],
    geofences: [fence({ id: "F_TB1", tbId: "TB1", name: "Gf W2 Boundary1", ward: "ZA5241002" }), fence({ id: "F_TB2", tbId: "TB2", name: "Gf W4 Cornhill1", ward: "ZA5241004" }), fence({ id: "F_TB3", tbId: "TB3", name: "Gf W6 Taken" })],
  }).items;
  const selection = allocationSelection(items, ["TB2", "TB1"]);
  assert.deepEqual([selection.batches, selection.meters, selection.wards], [2, 14, ["Ward 2", "Ward 4"]]);
  assert.deepEqual(selection.items.map(item => item.tbId), ["TB2", "TB1"], "in the order clicked");
  const taken = allocationSelection(items, ["TB1", "TB3"]);
  assert.deepEqual([taken.batches, taken.dropped], [1, ["TB3"]], "a batch allocated meanwhile leaves the window");
  assert.equal(allocateButtonLabel(selection, { type: "TEAM", name: "Kaiser Team" }), "Allocate 2 batches (14 meters) to Kaiser Team");
  assert.equal(allocateButtonLabel(allocationSelection(items, ["TB1"]), { type: "TEAM", name: "Kaiser Team" }), "Allocate 1 batch (6 meters) to Kaiser Team");
  assert.equal(allocateButtonLabel(selection, null), "Choose a TEAM or SP");
  assert.equal(allocateButtonLabel(allocationSelection(items, []), { name: "Kaiser Team" }), "Select batches on the map");
});

test("TB Register opens the Allocation Map, and the page allocates the selection in one step", async () => {
  const register = await read("../../TargetedBatchesPage.jsx");
  assert.match(register, /<Link to="\/operations\/targeted-batches\/allocation-map" style=\{styles\.secondaryLinkButton\}>\s*Allocation Map \(\{ticked\.selectedIds\.length\}\)/);
  const routes = await read("../../../../routes/AppRoutes.jsx");
  assert.match(routes, /path="\/operations\/targeted-batches\/allocation-map"/);
  assert.match(routes, /<TargetedBatchAllocationMapPage \/>/);
  const page = await read("../../TargetedBatchAllocationMapPage.jsx");
  assert.match(page, /useGetGeoFencesByLmQuery\(\{ lmPcode \}, \{ skip: !lmPcode \}\)/, "every geofence of the LM, all Wards");
  assert.match(page, /allocateTogether\(\{ tbIds: selection\.items\.map\(item => item\.tbId\), targetType: target\.type, targetId: target\.id \}\)/);
  assert.match(page, /all together or not at all/, "the confirmation says it is all or nothing");
  assert.match(page, /lines: item\.labelLines/, "the map label is drawn row by row");
  assert.match(page, /clickable: ready/, "only ready geofences can be clicked");
  assert.match(page, /Nothing was allocated\./, "a failure says nothing changed");
  const api = await read("../../../../redux/salesTargetedBatchApi.js");
  assert.match(api, /allocateSalesTargetedBatchesTogether: rtkBuilder\.mutation\(callSalesBatch\("onAllocateTargetedBatchesTogetherCallable"\)\)/);
  const server = await read("../../../../../functions/targetedBatches/allocationCallable.js");
  assert.match(server, /export const GROUP_ALLOCATION_MAX = 15;/);
  assert.match(server, /export async function allocateSalesBatchesTogether\(/);
  assert.match(server, /async function planNonGpsBatchAllocation\(/, "one batch is read and checked before anything is written");
  assert.match(server, /function applyNonGpsBatchAllocation\(/);
  const index = await read("../../../../../functions/index.js");
  assert.match(index, /onAllocateTargetedBatchesTogetherCallable,/);
});
