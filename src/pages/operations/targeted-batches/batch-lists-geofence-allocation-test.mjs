import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { NO_GEOFENCE_LABEL, batchGeofenceLabel, geofenceNamesById } from "./batch-geofence-label.js";
import { normalizeTargetedBatchHeader } from "../../sales/models/salesTargetedBatchReadModel.js";

// Targeted Batch rules TB-R043: batch lists show the geofence; Sales Reporting splits allocation.
const read = path => readFile(new URL(path, import.meta.url), "utf8");
const inOrder = (source, labels) => {
  const positions = labels.map(label => source.indexOf(label));
  assert.ok(positions.every(position => position >= 0), `all present: ${labels.join(" | ")}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, `in order: ${labels.join(" → ")}`);
};

test("the geofence label: name when known, ID while unknown, No geofence for older batches", () => {
  const names = geofenceNamesById([{ id: "PvBEHYrp6cLFw9vbdcA0", name: "Gf W6 Acacia" }, { id: "X1", name: "NAv" }, { name: "no id" }]);
  assert.equal(names.size, 2);
  assert.equal(batchGeofenceLabel("PvBEHYrp6cLFw9vbdcA0", names), "Gf W6 Acacia");
  assert.equal(batchGeofenceLabel("X1", names), "X1", "a geofence without a usable name shows its ID");
  assert.equal(batchGeofenceLabel("NOT_LOADED_YET", names), "NOT_LOADED_YET");
  for (const missing of [null, undefined, "", "  "]) assert.equal(batchGeofenceLabel(missing, names), NO_GEOFENCE_LABEL);
});

test("the Sales Reporting batch summary carries the geofence ID", () => {
  assert.equal(normalizeTargetedBatchHeader("TGB_20260914_012600_YHXQ", { geofenceId: " PvBEHYrp6cLFw9vbdcA0 " }).geofenceId, "PvBEHYrp6cLFw9vbdcA0");
  assert.equal(normalizeTargetedBatchHeader("TGB_20260809_030009_WFIL", {}).geofenceId, null);
});

test("TB Register: Geofence column after Ward, with a text filter and sorting", async () => {
  const page = await read("../TargetedBatchesPage.jsx");
  assert.match(page, /useGetGeoFencesByLmQuery\(activeLmPcode, \{ skip: !activeLmPcode \}\)/);
  assert.match(page, /geofenceLabel: batchGeofenceLabel\(upload\?\.geofenceId, geofenceNames\)/);
  inOrder(page, ['label="Ward"', 'label="Geofence"', 'label="Created By"', 'aria-label="Filter Ward"', 'aria-label="Filter Geofence"', 'aria-label="Filter Created By"']);
  assert.match(page, /label="Geofence"\s+sortKey="geofence"/);
  assert.match(page, /aria-label="Filter Geofence"/);
  assert.match(page, /if \(sortKey === "geofence"\) return upload\?\.geofenceLabel \|\| "";/);
  assert.match(page, /<Td colSpan=\{11\}>/);
});

test("TB Register: Map button first; Allocation (Allocate / Allocated) then Allocated To, each filterable (1.3.11)", async () => {
  const page = await read("../TargetedBatchesPage.jsx");
  inOrder(page, ["<Th>Map</Th>", 'label="TB ID"', 'label="Allocation"', 'label="Allocated To"', 'label="Total"']);
  inOrder(page, ['aria-label="Filter Allocation"', 'aria-label="Filter Allocated To"', 'aria-label="Filter Total"']);
  assert.match(page, /<BatchMapLink tbId=\{upload\.id\} from=\{\{ path: "\/operations\/targeted-batches", label: "TB Register" \}\} \/>/);
  assert.match(page, /if \(allocatedToFilter && allocationState\.targetName !== allocatedToFilter\)/);
  assert.match(page, /title=\{allocationState\.targetKind \|\| undefined\}>\s*\{allocationState\.targetName\}/);
  assert.doesNotMatch(page, /allocationTargetText/, "the Allocated chip no longer carries the name");
});

test("the Batch Map button is shared, and the Batch Map returns to the list it came from", async () => {
  const { batchMapPath, batchMapReturn } = await import("../../../components/batch-map-path.js");
  assert.equal(batchMapPath("TGB_20260914_012600_YHXQ"), "/sales/reporting/TGB_20260914_012600_YHXQ/map");
  assert.deepEqual(batchMapReturn({ from: { path: "/operations/targeted-batches", label: "TB Register" } }), { path: "/operations/targeted-batches", label: "TB Register" });
  for (const state of [null, undefined, {}, { from: { path: "https://evil.example" } }, { from: { path: "//evil.example" } }, { from: { path: 42 } }]) {
    assert.deepEqual(batchMapReturn(state), { path: "/sales/reporting", label: "Reporting" }, JSON.stringify(state));
  }
  const link = await read("../../../components/batch-map-link.jsx");
  assert.match(link, /to=\{batchMapPath\(tbId\)\}\s+state=\{from \? \{ from \} : undefined\}/);
  const reporting = await read("../../sales/SalesReportingPage.jsx");
  assert.match(reporting, /<BatchMapLink tbId=\{batch\.id\} from=\{\{ path: "\/sales\/reporting", label: "Reporting" \}\} \/>/);
  const mapPage = await read("../../sales/SalesBatchMapPage.jsx");
  assert.match(mapPage, /const back = batchMapReturn\(useLocation\(\)\.state\);/);
  assert.match(mapPage, /<Link to=\{back\.path\} style=\{styles\.secondaryButton\}>\s*Back to \{back\.label\}/);
});

test("Sales Reporting: Geofence after Ward; Allocation (Allocated / Unallocated) then Allocated To (team), each filterable", async () => {
  const page = await read("../../sales/SalesReportingPage.jsx");
  assert.match(page, /const ALLOCATION_STATES = \["Allocated", "Unallocated"\];/);
  inOrder(page, ['label="Ward"', 'label="Geofence"', 'label="Allocation"', 'label="Allocated To"', 'label="Acceptance"']);
  assert.match(page, /label="Allocation"\s+sortKey="allocation"/);
  assert.match(page, /label="Allocated To"\s+sortKey="allocatedTo"/);
  assert.match(page, /includesText\(batch\?\.geofenceLabel, filters\.geofence\)/);
  assert.match(page, /filters\.allocatedTo === ALL_FILTER \|\|\s+getAllocatedToLabel\(batch\) === filters\.allocatedTo/);
  assert.match(page, /<td>\{getAllocationState\(batch\)\}<\/td>\s*<td>\s*<AllocatedToCell allocation=\{batch\?\.allocation\} \/>/);
  assert.doesNotMatch(page, /colSpan=\{10\}/);
  assert.equal((page.match(/colSpan=\{12\}/g) || []).length, 3);
});
