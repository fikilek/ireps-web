import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BATCH_GEOFENCE_STATUS as S, BATCH_GEOFENCE_COLUMNS, BATCH_GEOFENCE_PAGE_SIZES, buildBatchGeofenceRows, isBatchGeofenceGap, salesDraftForGeofence, defaultBatchGeofenceColumns,
  allBatchGeofenceColumns, readBatchGeofenceColumns, filterBatchGeofenceRows, sortBatchGeofenceRows, paginateBatchGeofenceRows, batchGeofenceDownloadColumns } from "./batchGeofenceModel.js";
import { pageReturn } from "../../../components/batch-map-path.js";
import { buildTargetedBatchDraft } from "../../../redux/targetedBatchDraftModel.js";
import { salesDraftIntent } from "../../operations/targeted-batches/draft/sales-batch-draft-model.js";

// Targeted Batch rules TB-R044: Batches & Geofences.
const read = path => readFile(new URL(path, import.meta.url), "utf8");
const TB = "TGB_20260915_075031_GTYQ";
const batch = (id, geofenceId, createdAt) => ({ id, geofenceId, createdAt, totalRows: 3, metadata: { createdByUser: "Zamo Ngubs" }, source: { type: "PREPAID_SALES_NON_GPS" } });
const fence = (id, extra = {}) => ({ id, name: `Gf ${id}`, status: "ACTIVE", wardPcode: "ZA5241004", createdAt: "2026-09-15T05:52:20.108Z", createdByUid: "U1", createdByUser: "Zamo Ngubs", meterCount: 2, salesMeterCount: 5, ...extra });
const link = (tbId, linkState, salesIds = ["04297696454", "04297696827"]) => ({ targetedBatch: { tbId, linkState, salesIds, fingerprint: "F", geometryHash: "G" } });

test("one row per batch–geofence pair, with every gap and status", () => {
  const batches = [batch("TGB_20260914_073355_B58I", "ACACIA", "2026-09-14T07:33:55.000Z"), batch("TGB_20260810_101010_M6PQ", null, "2026-08-10T10:10:10.000Z")];
  const geofences = [fence("ACACIA", link("TGB_20260914_073355_B58I", "LINKED")), fence("ANNE", link(TB, "UNLINKED")), fence("OTHERS", { ...link("TGB_20260915_090000_ZZZZ", "UNLINKED"), createdByUid: "U2", createdByUser: "Simo" }),
    fence("REMOVED", link("TGB_20260913_120000_AB12", "LINKED")), fence("TOWN", { createdAt: "2026-08-02T00:00:00.000Z" })];
  const rows = buildBatchGeofenceRows({ batches, geofences, uid: "U1" });
  const byKey = Object.fromEntries(rows.map(row => [row.key, row]));
  assert.equal(rows.length, 6, "two batches plus the four geofences without a batch of their own");
  assert.equal(byKey["B:TGB_20260914_073355_B58I"].status, S.LINKED); assert.equal(byKey["B:TGB_20260914_073355_B58I"].geofence.name, "Gf ACACIA");
  assert.equal(byKey["B:TGB_20260810_101010_M6PQ"].status, S.NO_GEOFENCE); assert.equal(byKey["B:TGB_20260810_101010_M6PQ"].geofence, null);
  const anne = byKey["G:ANNE"];
  assert.deepEqual([anne.status, anne.batch, anne.plannedBatchId, anne.canCreateBatch, anne.geofence.batchMeters, anne.geofence.salesMeters, anne.geofence.assets], [S.BATCH_NOT_CREATED, null, TB, true, 2, 5, 2]);
  assert.deepEqual([byKey["G:OTHERS"].status, byKey["G:OTHERS"].canCreateBatch], [S.BATCH_NOT_CREATED, false]);
  assert.match(byKey["G:OTHERS"].note, /Only Simo can create its batch/, "only the geofence's creator can create its batch");
  assert.equal(byKey["G:REMOVED"].status, S.BATCH_REMOVED); assert.equal(byKey["G:REMOVED"].canCreateBatch, false);
  assert.equal(byKey["G:TOWN"].status, S.AREA); assert.equal(byKey["G:TOWN"].geofence.kind, "Area geofence");
  assert.deepEqual(rows.filter(isBatchGeofenceGap).map(row => row.key).sort(), ["B:TGB_20260810_101010_M6PQ", "G:ANNE", "G:OTHERS"]);
  assert.equal(rows[0].key.startsWith("G:"), true, "newest first");
  assert.equal(buildBatchGeofenceRows({ geofences: [fence("ANNE", link(TB, "UNLINKED"))], uid: "" })[0].canCreateBatch, false, "no signed-in user, no action");
});

const sales = (id, extra = {}) => ({ id, meterNo: id, meterNoNormalized: id, lmPcode: "ZA5241", town: "DUNDEE", adr: { strNo: "22A", strName: "Anne", strType: "Street" }, ...extra });
test("Create its batch builds TB Draft under the geofence's batch ID, linked to the geofence", () => {
  const anne = fence("ANNE", link(TB, "UNLINKED"));
  const plan = salesDraftForGeofence({ fence: anne, salesRows: [sales("04297696827"), sales("04297696454")], lmPcode: "ZA5241", lmName: "Endumeni", scopeKey: "SCOPE" });
  assert.equal(plan.ok, true);
  assert.equal(plan.payload.id, TB); assert.equal(plan.payload.source.type, "PREPAID_SALES_NON_GPS");
  assert.deepEqual(plan.payload.authoritativeIds.salesAllMeterIds, ["04297696454", "04297696827"], "the geofence's own meter order");
  assert.match(plan.payload.selection.reason, /Non-GPS Sales Table · batch for geofence Gf ANNE/);
  assert.equal(plan.payload.displayRows[0].addressLine1, "22A Anne Street");
  // What prepareTargetedBatchDraft then saveSalesDraftFence do in the slice.
  const draft = { ...buildTargetedBatchDraft(plan.payload), savedFence: { id: "ANNE" } };
  assert.deepEqual([draft.id, draft.scopeKey, draft.retainedIds, draft.savedFence], [TB, "SCOPE", ["04297696454", "04297696827"], { id: "ANNE" }]);
  const intent = salesDraftIntent(draft);
  assert.deepEqual([intent.tbId, intent.geofenceId, intent.source, intent.lmPcode], [TB, "ANNE", "PREPAID_SALES_NON_GPS", "ZA5241"]);
  const gps = salesDraftForGeofence({ fence: anne, salesRows: ["04297696454", "04297696827"].map(id => sales(id, { hasUsableGps: true })), lmPcode: "ZA5241", scopeKey: "S" });
  assert.equal(gps.payload.source.type, "PREPAID_SALES");
});

test("Create its batch refuses what cannot become one batch", () => {
  const anne = fence("ANNE", link(TB, "UNLINKED"));
  assert.match(salesDraftForGeofence({ fence: anne, salesRows: [sales("04297696454")], lmPcode: "ZA5241" }).message, /1 of this geofence's Sales meters could not be read/);
  assert.match(salesDraftForGeofence({ fence: anne, salesRows: [sales("04297696454"), sales("04297696827", { hasUsableGps: true })], lmPcode: "ZA5241" }).message, /mix GPS and Non-GPS/);
  assert.match(salesDraftForGeofence({ fence: anne, salesRows: [sales("04297696454"), sales("04297696827", { lmPcode: "ZA5242" })], lmPcode: "ZA5241" }).message, /active LM/);
  assert.match(salesDraftForGeofence({ fence: fence("DONE", link(TB, "LINKED")), salesRows: [], lmPcode: "ZA5241" }).message, /no batch waiting/);
  assert.equal(salesDraftForGeofence({ fence: fence("TOWN"), lmPcode: "ZA5241" }).ok, false);
});

test("the page opens from both Sales tables, reads only, and Create its batch opens TB Draft on the geofence", async () => {
  const page = await read("../BatchesGeofencesPage.jsx");
  assert.match(page, /useGetPermanentSalesBatchesQuery\(\{ lmPcode \}/); assert.match(page, /useGetGeoFencesByLmQuery\(lmPcode/);
  assert.match(page, /row\.fence\.targetedBatch\.salesIds\.map\(id => getDoc\(doc\(db, "sales-all-meters", id\)\)\)/);
  assert.match(page, /window\.confirm\("This replaces the TB Draft you have open\. Continue\?"\)/);
  assert.match(page, /dispatch\(prepareTargetedBatchDraft\(plan\.payload\)\);\s*dispatch\(saveSalesDraftFence\(\{ tbId: plan\.payload\.id, fence: \{ id: row\.fence\.id \} \}\)\);\s*navigate\("\/operations\/targeted-batches\/draft"\);/);
  assert.match(page, /<input type="checkbox" checked=\{gapsOnly\}/);
  assert.doesNotMatch(page, /setDoc|updateDoc|deleteDoc|httpsCallable/, "the page itself writes nothing");
  const routes = await read("../../../routes/AppRoutes.jsx");
  assert.match(routes, /path="\/sales\/batches-geofences"[\s\S]{0,160}<BatchesGeofencesPage \/>/);
  assert.match(await read("../../../layouts/ConsoleLayout.jsx"), /pathname === "\/sales\/batches-geofences"\) \{\s*return "Batches & Geofences";/);
  assert.match(await read("../NonGpsBatchPlanningPage.jsx"), /navigate\("\/sales\/batches-geofences", \{ state: \{ from: \{ path: "\/sales\/non-gps-batch-planning", label: "Non-GPS Sales Table" \} \} \}\)\}>\s*Batches &amp; Geofences/);
  assert.match(await read("../PrepaidSales.jsx"), /navigate\("\/sales\/batches-geofences", \{ state: \{ from: \{ path: "\/sales\/table", label: "GPS Sales Table" \} \} \}\)\}>\s*Batches &amp; Geofences/);
});

// Rules TB-R044 (1.3.20): groups, standard table, Columns chooser, Back link.
test("the owner's default columns; a remembered choice is read safely", () => {
  assert.deepEqual(Object.entries(defaultBatchGeofenceColumns()).filter(([, shown]) => shown).map(([key]) => key), ["batchId", "batchMeters", "status", "geofence", "geofenceCreated"]);
  assert.deepEqual(BATCH_GEOFENCE_COLUMNS.map(column => column.group), ["batch", "batch", "batch", "batch", "batch", "link", "geofence", "geofence", "geofence", "geofence", "geofence", "geofence", "geofence"]);
  assert.equal(Object.values(allBatchGeofenceColumns()).every(Boolean), true);
  assert.deepEqual(readBatchGeofenceColumns(null), defaultBatchGeofenceColumns());
  assert.deepEqual(readBatchGeofenceColumns([true]), defaultBatchGeofenceColumns());
  const remembered = readBatchGeofenceColumns({ kind: true, batchId: false, status: "yes", unknown: true });
  assert.deepEqual([remembered.kind, remembered.batchId, remembered.status, Object.hasOwn(remembered, "unknown")], [true, false, true, false]);
});

test("filter, then sort, then page, as the iREPS registry table standard", () => {
  const geofences = [fence("A", { ...link("TGB_20260915_010101_AAAA", "UNLINKED", ["1", "2", "3"]), name: "Gf W4 Anne1" }), fence("B", { ...link("TGB_20260915_020202_BBBB", "UNLINKED", ["1"]), name: "Gf W6 Acacia" }), fence("C", { name: "Gf W6 Town", createdAt: "2026-08-02T00:00:00.000Z" })];
  const rows = buildBatchGeofenceRows({ batches: [batch("TGB_20260810_101010_M6PQ", null, "2026-08-10T10:10:10.000Z")], geofences, uid: "U1" });
  assert.deepEqual(filterBatchGeofenceRows(rows, { filters: { geofence: "w6" } }).map(row => row.key).sort(), ["G:B", "G:C"]);
  assert.deepEqual(filterBatchGeofenceRows(rows, { filters: { geofenceCreated: "2026" }, gapsOnly: true }).map(row => row.key).sort(), ["G:A", "G:B"]);
  const bySavedFor = sortBatchGeofenceRows(rows, { key: "savedFor", direction: "asc" }).map(row => row.key);
  assert.deepEqual(bySavedFor.slice(0, 2), ["G:B", "G:A"]); assert.deepEqual(bySavedFor.slice(2).sort(), ["B:TGB_20260810_101010_M6PQ", "G:C"], "blanks last");
  assert.deepEqual(sortBatchGeofenceRows(rows, { key: "savedFor", direction: "desc" }).map(row => row.key).slice(0, 2), ["G:A", "G:B"]);
  assert.equal(sortBatchGeofenceRows(rows, { key: "" }), rows, "no sort keeps newest first");
  assert.deepEqual(BATCH_GEOFENCE_PAGE_SIZES, [5, 10, 25, 50, 100]);
  const many = Array.from({ length: 12 }, (_, index) => ({ key: String(index) }));
  assert.deepEqual([paginateBatchGeofenceRows(many, 3, 5).rows.length, paginateBatchGeofenceRows(many, 3, 5).totalPages], [2, 3]);
  assert.equal(paginateBatchGeofenceRows(many, 9, 5).page, 3, "a page past the end shows the last page");
  const download = batchGeofenceDownloadColumns();
  assert.equal(download.length, BATCH_GEOFENCE_COLUMNS.length + 1, "every column, shown or hidden, plus Action");
  assert.equal(download.at(-1).value(rows.find(row => row.key === "G:A")), "Create its batch");
});

test("the page groups the columns, pages above and below, downloads every filtered row, and goes back", async () => {
  const page = await read("../BatchesGeofencesPage.jsx");
  const columnsButton = page.indexOf(">Columns</button>"), gpsLink = page.indexOf('to="/sales/table" style={styles.linkButton}>GPS Sales Table');
  assert.ok(columnsButton > 0 && gpsLink > columnsButton, "Columns sits left of GPS Sales Table");
  assert.match(page, /<Link to=\{back\.path\} style=\{styles\.backLink\}>← Back to \{back\.label\}<\/Link>\s*<section style=\{styles\.header\}>/, "Back sits above the heading");
  assert.match(page, /const shown = \[\.\.\.BATCH_GEOFENCE_COLUMNS\.filter\(column => columns\[column\.key\] && column\.group === "batch"\),\s*\.\.\.BATCH_GEOFENCE_COLUMNS\.filter\(column => columns\[column\.key\] && column\.group === "link"\), ACTION,/);
  assert.match(page, /index > 0 && shown\[index\]\.group !== shown\[index - 1\]\.group \? styles\.divider : null/);
  assert.equal(page.match(/\{pagination\}/g).length, 2, "pagination above and below");
  assert.match(page, /visibleRows=\{sorted\} columns=\{batchGeofenceDownloadColumns\(\)\}/, "download every filtered and sorted row, not the page");
  assert.match(page, /\{current\.rows\.map\(row =>/, "the body renders the current page only");
  assert.match(page, /try \{ window\.localStorage\.setItem\(COLUMNS_STORAGE_KEY/);
  assert.deepEqual(pageReturn({ from: { path: "/sales/table", label: "GPS Sales Table" } }, { path: "/x", label: "X" }), { path: "/sales/table", label: "GPS Sales Table" });
  assert.deepEqual(pageReturn({ from: { path: "https://evil.example" } }, { path: "/x", label: "X" }), { path: "/x", label: "X" }, "only in-app pages");
});
