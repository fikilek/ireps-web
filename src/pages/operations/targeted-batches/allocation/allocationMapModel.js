// Targeted Batch rules TB-R047 (1.3.31): the Allocation Map. Every batch geofence of the LM on one map,
// labelled with its name and meter count; ready batches are selected by clicking and allocated together
// to one TEAM or SP, at most 15 in one step.
import { wardNumberFromPcode } from "../../../../../functions/geofences/geofence-name.js";

export const ALLOCATION_MAP_MAX = 15;
export const ALLOCATION_MAP_STATES = Object.freeze({ READY: "READY", ALLOCATED: "ALLOCATED", UNAVAILABLE: "UNAVAILABLE" });

const text = value => String(value ?? "").trim();
const upper = value => text(value).toUpperCase();
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const batchPlural = count => `${count} batch${count === 1 ? "" : "es"}`;

function isAllocated(batch = {}) {
  return upper(batch.allocation?.status) === "ALLOCATED" || Boolean(text(batch.allocation?.targetId));
}

// The same test as TB Allocation for a Sales batch that is allocated in one step (schema 0.3.0).
function canBeAllocated(batch = {}) {
  const execution = upper(batch.execution?.status);
  return batch.schemaVersion === "0.3.0" && ["PREPAID_SALES", "PREPAID_SALES_NON_GPS"].includes(batch.source?.type)
    && upper(batch.creation?.state) === "READY" && (!execution || execution === "NOT_STARTED") && !isAllocated(batch);
}

function linkedFence(batch, fences) {
  const fence = fences.find(item => item.targetedBatch?.tbId === batch.id) || fences.find(item => item.id === batch.geofenceId) || null;
  return fence && upper(fence.status) === "ACTIVE" ? fence : null;
}

export function allocationMapLabel(item) {
  return [item.name, plural(item.meters, "meter"), ...(item.state === ALLOCATION_MAP_STATES.ALLOCATED && item.targetName ? [item.targetName] : [])].join(" · ");
}

export function buildAllocationMapModel({ batches = [], geofences = [] } = {}) {
  const fences = Array.isArray(geofences) ? geofences : [];
  const items = [];
  let readyNotOnMap = 0;
  for (const batch of Array.isArray(batches) ? batches : []) {
    const fence = linkedFence(batch, fences);
    const ready = canBeAllocated(batch);
    if (!fence) { if (ready || (!isAllocated(batch) && upper(batch.creation?.state) === "READY")) readyNotOnMap += 1; continue; }
    const state = isAllocated(batch) ? ALLOCATION_MAP_STATES.ALLOCATED
      : ready && upper(fence.targetedBatch?.linkState) === "LINKED" ? ALLOCATION_MAP_STATES.READY : ALLOCATION_MAP_STATES.UNAVAILABLE;
    const wardPcode = text(batch.scope?.wardPcode || fence.parents?.wardPcode);
    const wardNumber = wardNumberFromPcode(wardPcode);
    const item = {
      tbId: batch.id, geofenceId: fence.id, name: text(fence.name) || fence.id, wardPcode, wardLabel: wardNumber ? `Ward ${wardNumber}` : wardPcode || "Ward unknown",
      meters: Number(batch.counts?.totalRows ?? batch.creation?.createdRows ?? 0) || 0, state, targetName: text(batch.allocation?.targetName), fence,
    };
    items.push({ ...item, label: allocationMapLabel(item) });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { items, readyNotOnMap, counts: { ready: items.filter(item => item.state === ALLOCATION_MAP_STATES.READY).length, allocated: items.filter(item => item.state === ALLOCATION_MAP_STATES.ALLOCATED).length } };
}

// Clicking a ready geofence adds it to the allocation window; clicking it again removes it.
export function toggleAllocationSelection(selectedIds = [], item) {
  if (!item || item.state !== ALLOCATION_MAP_STATES.READY) return { selectedIds, message: "" };
  if (selectedIds.includes(item.tbId)) return { selectedIds: selectedIds.filter(id => id !== item.tbId), message: "" };
  if (selectedIds.length >= ALLOCATION_MAP_MAX) return { selectedIds, message: `At most ${ALLOCATION_MAP_MAX} batches can be allocated in one step.` };
  return { selectedIds: [...selectedIds, item.tbId], message: "" };
}

// The allocation window: the selected batches (in the order clicked) that are still ready, and totals.
export function allocationSelection(items = [], selectedIds = []) {
  const byId = new Map(items.map(item => [item.tbId, item]));
  const selected = selectedIds.map(id => byId.get(id)).filter(item => item && item.state === ALLOCATION_MAP_STATES.READY);
  const dropped = selectedIds.filter(id => !selected.some(item => item.tbId === id));
  return { items: selected, dropped, batches: selected.length, meters: selected.reduce((sum, item) => sum + item.meters, 0),
    wards: [...new Set(selected.map(item => item.wardLabel))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) };
}

export function allocateButtonLabel(selection, target) {
  if (!selection?.batches) return "Select batches on the map";
  if (!target) return "Choose a TEAM or SP";
  return `Allocate ${batchPlural(selection.batches)} (${plural(selection.meters, "meter")}) to ${target.name}`;
}
