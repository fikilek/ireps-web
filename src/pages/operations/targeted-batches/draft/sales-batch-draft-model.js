import { evaluateSalesBatchability, classifySalesWorkStatus, SALES_BATCH_MAX as SALES_BATCH_LIMIT, composeSalesGeocodingAddress, LOOKUP_OUTCOMES, salesMaterial } from "../../../../../functions/salesAllMeters/sales-batch-policy.js";
import { normalizeBatchGeometry, polygonFromPoints, strictlyInside, strictlyWithinWard } from "../../../../../functions/geofences/sales-batch-geometry.js";

export function buildRetainedSalesDraft(payload, id) {
  if (payload.proposedBatches?.length > 1) throw new Error("Sales selection opens one retained proposal");
  const rows = structuredClone(payload.displayRows || payload.rows || []);
  const source = payload.source?.type || payload.sourceType;
  const salesIds = [...(payload.authoritativeIds?.salesAllMeterIds || payload.salesAllMeterIds || rows.map(row => row.salesAllMeterId || row.id))];
  if (!salesIds.length || salesIds.length > SALES_BATCH_LIMIT || new Set(salesIds).size !== salesIds.length) throw new Error("Select 1–30 distinct Sales meters");
  const scope = { ...payload.scope, lmPcode: payload.scope?.lmPcode || payload.lmPcode };
  const selection = { ...payload.selection, planningMode: "ERF_GEOFENCE" };
  return { id, source: { type: source, label: source === "PREPAID_SALES" ? "GPS Sales" : "Non-GPS Sales" }, sourceType: source, scope, scopeKey: payload.scopeKey || null,
    selection, status: "DRAFT", createdAt: new Date().toISOString(), retainedIds: salesIds, displayRows: rows, rows,
    authoritativeIds: { salesAllMeterIds: salesIds, uploadRowIds: [] }, proposedBatches: [{ tbId: id, salesAllMeterIds: salesIds, rows, scope }],
    resolutions: {}, savedFence: null, confirmation: null, uncertainRequest: null };
}

export function salesDraftIntent(draft) {
  return { tbId: draft.id, lmPcode: draft.scope.lmPcode, source: draft.source.type, geofenceId: draft.savedFence?.id || null, salesIds: [...draft.retainedIds],
    reason: draft.selection.reason || "Selected Sales meters", salesPeriodFrom: draft.selection.salesPeriodFrom || null,
    salesPeriodTo: draft.selection.salesPeriodTo || null, resolutionProofs: Object.fromEntries(Object.entries(draft.resolutions).filter(([,row]) => row.proof).map(([id,row]) => [id,row.proof])) };
}

// Callable transport errors do not establish a completed per-meter lookup.
// A lost response also cannot prove whether the server ran, so promise only
// that the retained draft is unchanged; never invent an erfLookup outcome.
export function salesDraftResolutionFailure(error) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  const message = error?.error || error?.message;
  const unavailable = error?.uncertain || ["internal", "unavailable", "not-found", "deadline-exceeded", "cancelled", "unknown"].includes(code)
    || !message || /^(internal|failed to fetch|network error|network request failed)[.!]?$/i.test(message);
  return unavailable
    ? { code: "RESOLUTION_SERVICE_UNAVAILABLE", reason: "Couldn't locate meters right now. Your draft is unchanged. Press Locate meters again." }
    : { code: code || "RESOLUTION_REQUEST_FAILED", reason: salesDraftMessage(message) };
}

// Translate display text only; server codes, proofs and stored evidence stay intact.
export function salesDraftMessage(value) {
  return String(value || "")
    .replace(/\bRecheck resolution\b/gi, "Locate meters again")
    .replace(/;\s*retained draft is unchanged/gi, ". Your draft is unchanged.")
    .replace(/\bretained draft\b/gi, "draft")
    .replace(/\bgeocoded position\b/gi, "Position from address")
    .replace(/\bgeocoding\b/gi, "meter location service")
    .replace(/\bgeocoded\b/gi, "located from address")
    .replace(/\bgeocode\b/gi, "locate")
    .replace(/\bresolutions?\b/gi, "location check")
    .replace(/\bunresolved\b/gi, "not confirmed")
    .replace(/\bresolving\b/gi, "locating")
    .replace(/\bresolved\b/gi, "located")
    .replace(/\bresolve\b/gi, "locate");
}

export function salesDraftReturnPath(source) {
  return source === "PREPAID_SALES_NON_GPS" ? "/sales/non-gps-batch-planning" : "/sales/table";
}

// Missing or ineligible rows remain visible until the operator explicitly removes them.
// A located meter has no time limit (rules 18.4); it goes back to "Not located yet" only
// when its Sales record, ERF or Ward really changes.
export function projectSalesDraft(draft, live, { geometry = null, resolutionsCurrent = true, resolving = false, resolutionFailure = null } = {}) {
  const validFence = draft.savedFence?.status === "ACTIVE" && draft.savedFence?.targetedBatch?.tbId === draft.id;
  const oldFence = draft.savedFence?.status === "BATCH_ONLY";
  const rows = draft.retainedIds.map(salesId => {
    const sales = live?.sales?.[salesId], resolved = draft.resolutions[salesId];
    const fallback = draft.displayRows.find(row => (row.salesAllMeterId || row.id) === salesId);
    let row = { ...resolved, salesId, salesWorkStatus: sales ? classifySalesWorkStatus(sales) : null, meterNo: sales?.meterNo || fallback?.meterNo || salesId,
      address: sales ? composeSalesGeocodingAddress(sales) : fallback?.addressLine1 || "", erfNo: live?.erfs?.[resolved?.erfId]?.sg?.erfNo || "", ready: false };
    if (!live?.ready) return { ...row, reason: live?.error || "Waiting for current draft data" };
    if (!sales) return { ...row, reason: "Sales meter is no longer available" };
    const policy = evaluateSalesBatchability(sales, { salesId, lmPcode: draft.scope.lmPcode, source: draft.source.type });
    if (!policy.batchable) return { ...row, reason: policy.reason };
    if (resolving) return { ...row, code: "RESOLUTION_PENDING", reason: "Locating meters…" };
    if (resolutionFailure) return { ...row, ...resolutionFailure };
    if (!resolutionsCurrent) return { ...row, code: "RESOLUTION_REQUIRED", reason: "Not located yet. Press Locate meters again." };
    if (!resolved?.ready || !row.point || !row.erfId) return { ...row, reason: resolved?.reason || "Locating meters…" };
    const erf = live.erfs[row.erfId], ward = live.wards[row.scope?.wardPcode];
    if (!erf || !ward) return { ...row, reason: "ERF or Ward data is unavailable" };
    if (validFence && !draft.savedFence.targetedBatch.salesIds.includes(salesId)) return { ...row, reason: "Outside the saved population; start a new draft to include this meter" };
    if (geometry) {
      try {
        if (!strictlyWithinWard(geometry, ward.geometry)) return { ...row, reason: "Geofence must be strictly inside the Ward" };
        if (!strictlyInside(erf.centroid, geometry)) return { ...row, reason: "ERF centroid is outside or on the geofence boundary" };
      } catch { return { ...row, reason: "ERF, Ward or geofence geometry is invalid" }; }
    }
    return { ...row, ready: true, reason: "Ready" };
  });
  for (const row of rows) row.reason = salesDraftMessage(row.reason);
  const wards = [...new Set(rows.map(row => row.scope?.wardPcode).filter(Boolean))];
  const readyIds = rows.filter(row => row.ready).map(row => row.salesId);
  return { rows, wards, readyIds, canSave: live?.ready && wards.length === 1 && readyIds.length > 0 && Boolean(geometry),
    canCreate: live?.ready && wards.length === 1 && readyIds.length > 0 && validFence && live.fence?.id === draft.savedFence.id && live.fence?.targetedBatch?.linkState === "UNLINKED" && !live.parent,
    gate: oldFence ? "Create a new geofence for this draft; the earlier fence model cannot be used." : wards.length > 1 ? "Retained meters span multiple Wards. Remove the named meters outside the intended Ward." : wards.length === 0 ? "Locate at least one meter to find the Ward." : "" };
}
export function draftGeometry(points, savedFence) {
  try { return savedFence?.status === "ACTIVE" && savedFence.targetedBatch ? normalizeBatchGeometry(savedFence.geometry) : polygonFromPoints(points); } catch { return null; }
}

// Schema TB10: the lookup records and metadata are not Sales material. Recording a lookup
// must not make TB Draft locate the meters again or make a confirmation stale.
export function salesDraftMaterial(live) {
  if (!live?.sales) return live;
  return { ...live, sales: Object.fromEntries(Object.entries(live.sales).map(([id, row]) => [id, salesMaterial(row)])) };
}
export function salesDraftSignature(live) {
  return live?.ready ? JSON.stringify([salesDraftMaterial(live).sales, live.erfs, live.wards]) : "";
}

export function confirmationIdentity(draft, live) {
  return JSON.stringify([draft.id, draft.retainedIds, draft.selection, draft.resolutions, draft.savedFence, salesDraftMaterial(live)]);
}

export function salesDraftWardLabel(pcode, ward) {
  const number = ward?.code || ward?.wardNumber || (pcode?.match(/(\d{3})$/)?.[1] ? Number(pcode.slice(-3)) : null);
  return number ? `Ward ${Number(number)}` : ward?.name || "Ward not found";
}
export function salesDraftWardGroups(rows) {
  const groups = new Map();
  for (const row of rows) if (row.scope?.wardPcode) {
    const key = row.scope.wardPcode;
    if (!groups.has(key)) groups.set(key, { pcode: key, label: salesDraftWardLabel(key, { wardNumber: row.scope.wardNumber }), salesIds: [] });
    groups.get(key).salesIds.push(row.salesId);
  }
  return [...groups.values()];
}

const MANUAL_ERFING_CODES = new Set([...LOOKUP_OUTCOMES, "NEEDS_MANUAL_ERFING"]);
export function needsManualErfing(row = {}) {
  return MANUAL_ERFING_CODES.has(row.code) || /^Needs manual ERFing/.test(row.reason || "");
}

// Rules TB-R038 (1.3.14): the chips above the TB Draft list — one per Ward (W6: 17), one for
// meters needing manual ERFing, and one for meters not located yet. Each can be removed in
// bulk, except the only group left (Clear draft empties a draft).
export function salesDraftChipGroups(rows = []) {
  const wards = salesDraftWardGroups(rows).map(group => ({ key: group.pcode, kind: "ward", label: `W${Number(group.pcode.slice(-3))}`, title: group.label, salesIds: group.salesIds }));
  const unplaced = rows.filter(row => !row.scope?.wardPcode);
  const erfing = unplaced.filter(needsManualErfing).map(row => row.salesId);
  const unlocated = unplaced.filter(row => !needsManualErfing(row)).map(row => row.salesId);
  const groups = [...wards,
    ...(erfing.length ? [{ key: "manual-erfing", kind: "erfing", label: "Needs manual ERFing", title: "Needs manual ERFing", salesIds: erfing }] : []),
    ...(unlocated.length ? [{ key: "not-located", kind: "unlocated", label: "Not located", title: "Not located yet", salesIds: unlocated }] : [])];
  return groups.map(group => ({ ...group, removable: groups.length > 1 }));
}
