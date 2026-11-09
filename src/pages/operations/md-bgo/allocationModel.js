import { wardNumberFromPcode } from "../../../../functions/geofences/geofence-name.js";

export const MD_BGO_ALLOCATION_MAX = 15;
export const MD_BGO_ALLOCATION_STATES = Object.freeze({ READY: "READY", ISSUED: "ISSUED", UNAVAILABLE: "UNAVAILABLE" });
const text = value => String(value ?? "").trim();
const upper = value => text(value).toUpperCase();

export function buildMdBgoAllocationModel({ batches = [], geofences = [] } = {}) {
  const fences = Array.isArray(geofences) ? geofences : [];
  const items = [];
  let readyNotOnMap = 0;
  for (const batch of Array.isArray(batches) ? batches : []) {
    const raw = batch.raw || batch;
    const mode = upper(batch.batchMode || raw.batchMode || raw.bgo?.batchMode);
    const operation = upper(batch.operationType || raw.operationType || raw.trnType);
    if (mode !== "BMD" && operation !== "METER_DISCOVERY") continue;
    const geofenceId = text(batch.geofenceId || batch.geofenceRef?.id || raw.geofenceId || raw.geofenceRef?.id);
    const fence = fences.find(item => item.id === geofenceId) || fences.find(item => item.bgo?.batchId === batch.id) || null;
    const workflow = upper(batch.workflowState || raw.workflow?.state);
    const issued = ["ISSUED", "ACCEPTED", "IN_PROGRESS", "COMPLETED"].includes(workflow);
    const assigned = Boolean(raw.bgo?.targetId || batch.targetId || raw.assignment?.targets?.length);
    if (!fence) { if (workflow === "READY_FOR_ALLOCATION") readyNotOnMap += 1; continue; }
    const count = Number(batch.summary?.erfCount ?? raw.summary?.erfCount ?? raw.worklist?.erfRefs?.length ?? 0) || 0;
    const targetName = text(batch.targetName || batch.target?.name || raw.bgo?.targetName || raw.assignment?.targets?.[0]?.name);
    const state = issued ? MD_BGO_ALLOCATION_STATES.ISSUED : workflow === "READY_FOR_ALLOCATION" && !assigned ? MD_BGO_ALLOCATION_STATES.READY : MD_BGO_ALLOCATION_STATES.UNAVAILABLE;
    const wardPcode = text(batch.scope?.wardPcode || raw.scope?.wardPcode || fence.parents?.wardPcode);
    const wardNumber = wardNumberFromPcode(wardPcode);
    items.push({ bgoBatchId: batch.id || raw.id, geofenceId: fence.id, name: text(fence.name || batch.geofenceRef?.name || raw.geofenceRef?.name || fence.id),
      erfCount: count, state, targetName, wardPcode, wardLabel: wardNumber ? `Ward ${wardNumber}` : wardPcode || "Ward unknown", fence });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { items, readyNotOnMap, counts: { ready: items.filter(item => item.state === MD_BGO_ALLOCATION_STATES.READY).length,
    issued: items.filter(item => item.state === MD_BGO_ALLOCATION_STATES.ISSUED).length } };
}

export function toggleMdBgoSelection(ids = [], item) {
  if (!item || item.state !== MD_BGO_ALLOCATION_STATES.READY) return { ids, message: "" };
  if (ids.includes(item.bgoBatchId)) return { ids: ids.filter(id => id !== item.bgoBatchId), message: "" };
  if (ids.length >= MD_BGO_ALLOCATION_MAX) return { ids, message: `At most ${MD_BGO_ALLOCATION_MAX} batches can be allocated in one step.` };
  return { ids: [...ids, item.bgoBatchId], message: "" };
}

export function mdBgoAllocationSelection(items = [], ids = []) {
  const byId = new Map(items.map(item => [item.bgoBatchId, item]));
  const selected = ids.map(id => byId.get(id)).filter(item => item?.state === MD_BGO_ALLOCATION_STATES.READY);
  return { items: selected, dropped: ids.filter(id => !selected.some(item => item.bgoBatchId === id)), batches: selected.length,
    erfs: selected.reduce((sum, item) => sum + item.erfCount, 0), wards: [...new Set(selected.map(item => item.wardLabel))] };
}

export function mdBgoAllocationFailure(failure = {}, selection = {}, target = null) {
  if (failure.uncertain || failure.data?.uncertain) return { kind: "uncertain", title: "Allocation not confirmed", tone: "warning", lines: [
    "The connection dropped before iREPS confirmed the result, so the batches may or may not be issued.",
    `Check the live map. If a batch is still ready, retry the same selection for ${target?.name || "the same TEAM or SP"}.`] };
  const detail = failure.data || failure;
  const message = detail.message || failure.message || "The allocation failed.";
  const batchId = detail.bgoBatchId || detail.batchId;
  const item = selection.items?.find(candidate => candidate.bgoBatchId === batchId);
  return { kind: "failed", title: "Nothing was allocated", tone: "error", lines: [item ? `${item.name} (${item.bgoBatchId}): ${message}` : message,
    batchId ? "Remove that batch from the allocation window, then try again." : "Nothing changed. Check the reason above, then try again."] };
}
