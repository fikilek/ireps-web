import { toggleMdBgoSelection } from "./allocationModel.js";
import { parseGeometry, geoJsonPolygonToGooglePaths } from "../geofence-map-helpers.js";
import { buildTrnBgoDisplayRows } from "../trnBgoRowsView.js";

function toMillis(val) {
  if (!val) return 0;
  if (typeof val === "number") return val;
  if (typeof val?.toMillis === "function") return val.toMillis();
  if (typeof val?.seconds === "number") return val.seconds * 1000;
  const parsed = Date.parse(String(val));
  return Number.isFinite(parsed) ? parsed : 0;
}

function readGpsPoint(raw) {
  if (!raw || typeof raw !== "object") return null;
  const lat = Number(raw.latitude ?? raw.lat);
  const lng = Number(raw.longitude ?? raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

function formatAllocatedTarget(batch = {}) {
  const target = batch?.assignment?.targets?.[0] || batch?.target || null;
  const name = String(
    target?.name || target?.label || target?.targetName || batch?.targetName || batch?.bgo?.targetName || "",
  ).trim();
  if (!name || name.toUpperCase() === "NAV") return "Unallocated";
  const type = String(target?.type || target?.targetType || "").trim().toUpperCase();
  return type && !name.toUpperCase().startsWith(`${type}:`) ? `${type}: ${name}` : name;
}

export function buildTrnAllocationModel({ batches = [], wards = [], progressByBatchId = {} } = {}) {
  const items = [];
  let readyNotOnMap = 0;

  for (const batch of batches) {
    if (!batch?.contractVersion) continue;
    const ward = wards.find((w) => (w.wardPcode || w.id) === batch.wardPcode) || null;
    const geometry = ward ? parseGeometry(ward.geometry) : null;
    const polygons =
      geometry?.type === "MultiPolygon"
        ? geometry.coordinates.map((coordinates) => geoJsonPolygonToGooglePaths({ type: "Polygon", coordinates }))
        : geometry?.type === "Polygon"
          ? [geoJsonPolygonToGooglePaths(geometry)]
          : [];
    const hasFence = polygons.some((paths) => paths[0]?.length >= 3);
    if (!hasFence && batch.workflowState === "READY_FOR_ALLOCATION") {
      readyNotOnMap += 1;
    }

    const targets = Array.isArray(batch.assignment?.targets) ? batch.assignment.targets : [];
    const workflowState = String(batch.workflowState || "").trim().toUpperCase();
    const state =
      workflowState === "READY_FOR_ALLOCATION" && !targets.length
        ? "READY"
        : ["ISSUED", "ACCEPTED"].includes(workflowState) || targets.length > 0
          ? "ISSUED"
          : "UNAVAILABLE";

    const totalMeters = Number(batch.totalRows || 0);
    const liveCounts = progressByBatchId?.[batch.id] || null;
    const inProgress = Number(liveCounts?.inProgressRows ?? batch.progress?.inProgress ?? 0);
    const completed = Number(liveCounts?.completedRows ?? batch.progress?.completed ?? 0);
    const workStatus =
      workflowState === "COMPLETED" || (totalMeters > 0 && completed >= totalMeters)
        ? "COMPLETED"
        : inProgress > 0 || completed > 0 || workflowState === "IN_PROGRESS"
          ? "IN_PROGRESS"
          : "NOT_STARTED";
    const workStatusTooltip =
      workStatus === "COMPLETED"
        ? `Completed (${completed} of ${totalMeters} completed)`
        : workStatus === "IN_PROGRESS"
          ? `In Progress (${inProgress} in progress, ${completed} completed of ${totalMeters})`
          : `Not Started (0 of ${totalMeters} worked)`;
    const fieldworkStarted = workStatus !== "NOT_STARTED";
    const canAllocate = !fieldworkStarted && !["COMPLETED", "CLOSED", "CANCELLED"].includes(workflowState);

    items.push({
      bgoBatchId: batch.id,
      geofenceId: ward?.id || batch.wardPcode || "",
      name: batch.id,
      erfCount: totalMeters,
      unitLabel: "meters",
      state,
      workflowState,
      workStatus,
      workStatusTooltip,
      targetName: targets[0]?.name || batch.bgo?.targetName || "",
      allocatedTo: formatAllocatedTarget(batch),
      fieldworkStarted,
      canAllocate,
      wardPcode: batch.wardPcode || "",
      wardLabel: ward?.name || batch.wardPcode || "NAv",
      createdAtMs: Math.max(
        toMillis(batch.createdAt),
        toMillis(batch.metadata?.createdAt),
        toMillis(batch.updatedAt),
      ),
      fence: hasFence
        ? {
            ...ward,
            polygon: ward.geometry,
            allocationPolygons: polygons,
            geometry: { points: polygons.flatMap((paths) => paths[0] || []) },
          }
        : null,
    });
  }

  items.sort((a, b) => {
    if (b.createdAtMs !== a.createdAtMs) return b.createdAtMs - a.createdAtMs;
    return String(b.bgoBatchId).localeCompare(String(a.bgoBatchId));
  });

  return {
    items,
    readyNotOnMap,
    counts: {
      ready: items.filter((x) => x.state === "READY").length,
      issued: items.filter((x) => x.state === "ISSUED").length,
    },
  };
}

export function buildTrnAllocationMeterPins({ rawRows = [], asts = [], premises = [], erfs = [] } = {}) {
  const displayRows = buildTrnBgoDisplayRows({ rawRows, asts });
  const astById = new Map((Array.isArray(asts) ? asts : []).filter((a) => a?.id).map((a) => [a.id, a]));
  const premiseById = new Map((Array.isArray(premises) ? premises : []).filter((p) => p?.id).map((p) => [p.id, p]));
  const erfById = new Map((Array.isArray(erfs) ? erfs : []).filter((e) => e?.id).map((e) => [e.id, e]));

  const pins = [];
  for (const row of displayRows) {
    const raw = row.raw || {};
    const liveAst = row.astId ? astById.get(row.astId) : null;
    const premiseId = raw.premiseId || raw.premise?.id || liveAst?.premiseId || "";
    const livePremise = premiseId ? premiseById.get(premiseId) : null;
    const erfId = row.erfId || livePremise?.erfId || liveAst?.erfId || "";
    const liveErf = erfId ? erfById.get(erfId) : null;
    const position =
      readGpsPoint(liveAst?.gps) ||
      readGpsPoint(liveAst?.astData?.location?.gps) ||
      readGpsPoint(liveAst?.ast?.location?.gps) ||
      readGpsPoint(liveAst?.location?.gps) ||
      readGpsPoint(raw?.ast?.location?.gps) ||
      readGpsPoint(livePremise?.gps) ||
      readGpsPoint(livePremise?.geometry?.centroid) ||
      readGpsPoint(livePremise?.location?.gps) ||
      readGpsPoint(raw?.premise?.location?.gps) ||
      readGpsPoint(raw?.premise?.gps) ||
      readGpsPoint(liveErf?.centroid) ||
      readGpsPoint(liveErf?.geometry?.centroid);
    if (!position) continue;

    pins.push({
      id: row.id,
      meterNo: row.meterNo,
      address: row.address,
      erfNo: row.erfNo,
      meterStatus: row.meterStatus,
      position,
    });
  }
  return pins;
}

export function toggleTrnAllocationSelection(ids, item, items) {
  const next = toggleMdBgoSelection(ids, item);
  const count = items
    .filter((row) => next.ids.includes(row.bgoBatchId))
    .reduce((sum, row) => sum + Number(row.erfCount || 0), 0);
  return count > 200 ? { ids, message: `That selection contains ${count} meters. Maximum per allocation action is 200.` } : next;
}
