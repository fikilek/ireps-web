import { hasUsableSalesGps } from "../../../../functions/salesAllMeters/sales-batch-policy.js";
import { formatAuthoritativeAddress } from "./nonGpsBatchPlanningModel.js";

// Targeted Batch rules TB-R044: Batches & Geofences. One row per batch–geofence pair, so the
// gaps are visible; Create its batch for a batch geofence whose batch was never created.
export const BATCH_GEOFENCE_STATUS = Object.freeze({
  LINKED: "Linked",
  NO_GEOFENCE: "No geofence",
  BATCH_NOT_CREATED: "Batch not created",
  BATCH_REMOVED: "Batch removed",
  AREA: "Area geofence",
});
const GAPS = new Set([BATCH_GEOFENCE_STATUS.NO_GEOFENCE, BATCH_GEOFENCE_STATUS.BATCH_NOT_CREATED]);
export const isBatchGeofenceGap = row => GAPS.has(row.status);

const text = value => String(value ?? "").trim();
const isoOf = value => {
  if (!value) return "";
  if (typeof value === "string") return value;
  const millis = value.toMillis?.() ?? (Number.isFinite(value.seconds) ? value.seconds * 1000 : NaN);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : "";
};

function batchSide(batch) {
  return { id: batch.id, createdAt: isoOf(batch.createdAt || batch.metadata?.createdAt), createdBy: text(batch.metadata?.createdByUser),
    meters: Number.isFinite(batch.totalRows) ? batch.totalRows : batch.counts?.totalRows ?? null,
    source: batch.source?.type === "PREPAID_SALES" ? "GPS Sales" : batch.source?.type === "PREPAID_SALES_NON_GPS" ? "Non-GPS Sales" : text(batch.source?.label) };
}
function geofenceSide(fence) {
  return { id: fence.id, name: text(fence.name) || fence.id, kind: fence.targetedBatch ? "Batch geofence" : "Area geofence", wardPcode: text(fence.wardPcode),
    createdAt: isoOf(fence.createdAt), createdBy: text(fence.createdByUser) === "NAv" ? "" : text(fence.createdByUser),
    batchMeters: Array.isArray(fence.targetedBatch?.salesIds) ? fence.targetedBatch.salesIds.length : null,
    salesMeters: fence.salesMeterCount ?? null, assets: Number.isFinite(fence.meterCount) ? fence.meterCount : null };
}

export function buildBatchGeofenceRows({ batches = [], geofences = [], uid = "" } = {}) {
  const fencesById = new Map(geofences.map(fence => [fence.id, fence]));
  const batchIds = new Set(batches.map(batch => batch.id));
  const paired = new Set();
  const rows = batches.map(batch => {
    const fence = batch.geofenceId ? fencesById.get(batch.geofenceId) : null;
    if (fence) paired.add(fence.id);
    return { key: `B:${batch.id}`, status: fence ? BATCH_GEOFENCE_STATUS.LINKED : BATCH_GEOFENCE_STATUS.NO_GEOFENCE,
      batch: batchSide(batch), plannedBatchId: "", geofence: fence ? geofenceSide(fence) : null, fence: fence || null, canCreateBatch: false, note: "" };
  });
  for (const fence of geofences) {
    if (paired.has(fence.id)) continue;
    const link = fence.targetedBatch;
    const status = !link ? BATCH_GEOFENCE_STATUS.AREA : link.linkState === "UNLINKED" && !batchIds.has(link.tbId) ? BATCH_GEOFENCE_STATUS.BATCH_NOT_CREATED : BATCH_GEOFENCE_STATUS.BATCH_REMOVED;
    const owner = Boolean(uid) && fence.createdByUid === uid;
    const meters = Array.isArray(link?.salesIds) ? link.salesIds.length : 0;
    const canCreateBatch = status === BATCH_GEOFENCE_STATUS.BATCH_NOT_CREATED && owner && meters >= 1 && meters <= 30 && fence.status === "ACTIVE";
    const note = status === BATCH_GEOFENCE_STATUS.BATCH_NOT_CREATED && !owner ? `Only ${geofenceSide(fence).createdBy || "the person who created it"} can create its batch`
      : status === BATCH_GEOFENCE_STATUS.BATCH_REMOVED ? "Its batch was removed; this geofence cannot be used again" : "";
    rows.push({ key: `G:${fence.id}`, status, batch: null, plannedBatchId: link?.tbId || "", geofence: geofenceSide(fence), fence, canCreateBatch, note });
  }
  const newest = row => row.batch?.createdAt || row.geofence?.createdAt || "";
  return rows.sort((left, right) => newest(right).localeCompare(newest(left)) || left.key.localeCompare(right.key));
}

// Rules TB-R044 (1.3.20): the columns, grouped Batch | Link | Geofence, with the owner's defaults.
// Action always shows in the Link group and is not a chooser column.
export const BATCH_GEOFENCE_GROUPS = Object.freeze([{ key: "batch", label: "Batch" }, { key: "link", label: "Link" }, { key: "geofence", label: "Geofence" }]);
export const BATCH_GEOFENCE_COLUMNS = Object.freeze([
  { key: "batchId", group: "batch", label: "Batch ID", show: true, value: row => row.batch?.id || (row.plannedBatchId ? `${row.plannedBatchId} (not created)` : "") },
  { key: "batchCreated", group: "batch", label: "Batch created", show: false, type: "date", value: row => row.batch?.createdAt || "" },
  { key: "batchBy", group: "batch", label: "Batch by", show: false, value: row => row.batch?.createdBy || "" },
  { key: "batchMeters", group: "batch", label: "Batch meters", show: true, type: "number", value: row => row.batch?.meters ?? null },
  { key: "source", group: "batch", label: "Source", show: false, value: row => row.batch?.source || "" },
  { key: "status", group: "link", label: "Status", show: true, value: row => row.status },
  { key: "geofence", group: "geofence", label: "Geofence", show: true, value: row => row.geofence?.name || "" },
  { key: "kind", group: "geofence", label: "Kind", show: false, value: row => row.geofence?.kind || "" },
  { key: "geofenceCreated", group: "geofence", label: "Geofence created", show: true, type: "date", value: row => row.geofence?.createdAt || "" },
  { key: "geofenceBy", group: "geofence", label: "Geofence by", show: false, value: row => row.geofence?.createdBy || "" },
  { key: "savedFor", group: "geofence", label: "Meters it was saved for", show: false, type: "number", value: row => row.geofence?.batchMeters ?? null },
  { key: "salesMeters", group: "geofence", label: "Sales meters in it", show: false, type: "number", value: row => row.geofence?.salesMeters ?? null },
  { key: "assets", group: "geofence", label: "Assets in it", show: false, type: "number", value: row => row.geofence?.assets ?? null },
]);
export function formatBatchGeofenceDate(iso) {
  const date = iso ? new Date(iso) : null;
  return !date || Number.isNaN(date.getTime()) ? "" : date.toLocaleString("en-ZA", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
export function displayBatchGeofenceValue(column, row) {
  const value = column.value(row);
  return value === null || value === undefined || value === "" ? "" : column.type === "date" ? formatBatchGeofenceDate(value) : String(value);
}
export const defaultBatchGeofenceColumns = () => Object.fromEntries(BATCH_GEOFENCE_COLUMNS.map(column => [column.key, column.show]));
export const allBatchGeofenceColumns = () => Object.fromEntries(BATCH_GEOFENCE_COLUMNS.map(column => [column.key, true]));
// A remembered choice from the browser; anything unknown falls back to the defaults.
export function readBatchGeofenceColumns(stored) {
  const defaults = defaultBatchGeofenceColumns();
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return defaults;
  return Object.fromEntries(BATCH_GEOFENCE_COLUMNS.map(column => [column.key, typeof stored[column.key] === "boolean" ? stored[column.key] : defaults[column.key]]));
}

// The iREPS registry table standard (ui-rules/registry-tables.md): filter, then sort, then page.
export const BATCH_GEOFENCE_PAGE_SIZES = Object.freeze([5, 10, 25, 50, 100]);
export function filterBatchGeofenceRows(rows, { filters = {}, gapsOnly = false } = {}) {
  const active = BATCH_GEOFENCE_COLUMNS.filter(column => text(filters[column.key]));
  return rows.filter(row => (!gapsOnly || isBatchGeofenceGap(row))
    && active.every(column => displayBatchGeofenceValue(column, row).toLowerCase().includes(text(filters[column.key]).toLowerCase())));
}
export function sortBatchGeofenceRows(rows, sort = {}) {
  const column = BATCH_GEOFENCE_COLUMNS.find(item => item.key === sort.key);
  if (!column) return rows;
  const direction = sort.direction === "desc" ? -1 : 1;
  const blank = value => value === null || value === undefined || value === "";
  const compare = (left, right) => {
    const a = column.value(left), b = column.value(right);
    if (blank(a) || blank(b)) return blank(a) === blank(b) ? 0 : blank(a) ? 1 : -1;
    return (column.type === "number" ? Number(a) - Number(b) : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" })) * direction;
  };
  return [...rows].sort((left, right) => compare(left, right) || left.key.localeCompare(right.key));
}
export function paginateBatchGeofenceRows(rows, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize)), current = Math.min(Math.max(1, page), totalPages);
  return { rows: rows.slice((current - 1) * pageSize, current * pageSize), page: current, totalPages };
}
// Download exports every column, shown or hidden, plus what the Action column says.
export const batchGeofenceDownloadColumns = () => [...BATCH_GEOFENCE_COLUMNS.map(column => ({ header: column.label, value: row => displayBatchGeofenceValue(column, row) })),
  { header: "Action", value: row => row.canCreateBatch ? "Create its batch" : row.note }];

// Create its batch: TB Draft for the geofence's meters under the batch ID it was saved for.
export function salesDraftForGeofence({ fence, salesRows = [], lmPcode, lmName = "", scopeKey }) {
  const link = fence?.targetedBatch;
  if (!link?.tbId || link.linkState !== "UNLINKED" || !Array.isArray(link.salesIds) || !link.salesIds.length) return { ok: false, message: "This geofence has no batch waiting to be created." };
  const byId = new Map(salesRows.map(row => [row.id, row]));
  const missing = link.salesIds.filter(id => !byId.has(id));
  if (missing.length) return { ok: false, message: `${missing.length} of this geofence's Sales meters could not be read (${missing.slice(0, 3).join(", ")}).` };
  const rows = link.salesIds.map(id => byId.get(id));
  if (rows.some(row => row.lmPcode !== lmPcode)) return { ok: false, message: "This geofence's meters are not all in the active LM." };
  const gps = rows.filter(hasUsableSalesGps).length;
  if (gps && gps !== rows.length) return { ok: false, message: "This geofence's meters mix GPS and Non-GPS Sales, so one batch cannot hold them." };
  const type = gps ? "PREPAID_SALES" : "PREPAID_SALES_NON_GPS", table = gps ? "GPS Sales Table" : "Non-GPS Sales Table";
  return { ok: true, payload: {
    id: link.tbId, scopeKey, source: { type, label: gps ? "GPS Sales" : "Non-GPS Sales", sourceId: null, fileName: null }, scope: { lmPcode, lmName },
    selection: { reason: `Selected from ${table} · batch for geofence ${text(fence.name) || fence.id}`, salesPeriodFrom: null, salesPeriodTo: null },
    authoritativeIds: { salesAllMeterIds: [...link.salesIds], uploadRowIds: [] },
    displayRows: rows.map((row, index) => ({ id: row.id, salesAllMeterId: row.id, rowNo: String(index + 1), meterNo: row.meterNo || row.id, addressLine1: formatAuthoritativeAddress(row), town: row.town || "", lmPcode })),
  } };
}
