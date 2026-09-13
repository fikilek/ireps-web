import { evaluateSalesBatchability, classifySalesWorkStatus, SALES_BATCH_MAX as SALES_BATCH_LIMIT, composeSalesGeocodingAddress } from "../../../../../functions/salesAllMeters/sales-batch-policy.js";
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
  return { tbId: draft.id, lmPcode: draft.scope.lmPcode, source: draft.source.type, salesIds: [...draft.retainedIds],
    reason: draft.selection.reason || "Selected Sales meters", salesPeriodFrom: draft.selection.salesPeriodFrom || null,
    salesPeriodTo: draft.selection.salesPeriodTo || null, resolutionProofs: Object.fromEntries(Object.entries(draft.resolutions).filter(([,row]) => row.proof).map(([id,row]) => [id,row.proof])) };
}

// Callable transport errors do not establish a completed per-meter lookup.
// A lost response also cannot prove whether the server ran, so promise only
// that the retained draft is unchanged; never invent an erfLookup outcome.
export function salesDraftResolutionFailure(error, source) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  const message = error?.error || error?.message;
  const unavailable = error?.uncertain || ["internal", "unavailable", "not-found", "deadline-exceeded", "cancelled", "unknown"].includes(code)
    || !message || /^(internal|failed to fetch|network error|network request failed)[.!]?$/i.test(message);
  const service = source === "PREPAID_SALES_NON_GPS" ? "Geocoding" : "Resolution";
  return unavailable
    ? { code: "RESOLUTION_SERVICE_UNAVAILABLE", reason: `${service} service unavailable. Your draft is unchanged. Try Recheck resolution.` }
    : { code: code || "RESOLUTION_REQUEST_FAILED", reason: message };
}

// Missing or ineligible rows remain visible until the operator explicitly removes them.
export function projectSalesDraft(draft, live, { geometry = null, resolutionsCurrent = true, resolving = false, resolutionFailure = null, now = Date.now() } = {}) {
  const rows = draft.retainedIds.map(salesId => {
    const sales = live?.sales?.[salesId], resolved = draft.resolutions[salesId];
    const fallback = draft.displayRows.find(row => (row.salesAllMeterId || row.id) === salesId);
    let row = { ...resolved, salesId, salesWorkStatus: sales ? classifySalesWorkStatus(sales) : null, meterNo: sales?.meterNo || fallback?.meterNo || salesId,
      address: sales ? composeSalesGeocodingAddress(sales) : fallback?.addressLine1 || "", ready: false };
    if (!live?.ready) return { ...row, reason: live?.error || "Waiting for current draft data" };
    if (!sales) return { ...row, reason: "Sales meter is no longer available" };
    const policy = evaluateSalesBatchability(sales, { salesId, lmPcode: draft.scope.lmPcode, source: draft.source.type });
    if (!policy.batchable) return { ...row, reason: policy.reason };
    if (resolving) return { ...row, code: "RESOLUTION_PENDING", reason: "Checking coordinates and ERF…" };
    if (resolutionFailure) return { ...row, ...resolutionFailure };
    if (!resolutionsCurrent) return { ...row, code: "RESOLUTION_REQUIRED", reason: "Resolution has not been checked. Try Recheck resolution." };
    if (!resolved?.ready || !row.point || !row.erfId) return { ...row, reason: resolved?.reason || "Resolving coordinates and ERF" };
    if (!Number.isFinite(resolved.expiresAt) || now >= resolved.expiresAt) return { ...row, reason: "Resolution expired. Recheck resolution before continuing" };
    const erf = live.erfs[row.erfId], ward = live.wards[row.scope?.wardPcode];
    if (!erf || !ward) return { ...row, reason: "ERF or Ward data is unavailable" };
    if (draft.savedFence && !draft.savedFence.savedSalesIds.includes(salesId)) return { ...row, reason: "Outside the saved population; start a new draft to include this meter" };
    if (geometry) {
      try {
        if (!strictlyWithinWard(geometry, ward.geometry)) return { ...row, reason: "Geofence must be strictly inside the Ward" };
        if (!strictlyInside(erf.centroid, geometry)) return { ...row, reason: "ERF centroid is outside or on the geofence boundary" };
      } catch { return { ...row, reason: "ERF, Ward or geofence geometry is invalid" }; }
    }
    return { ...row, ready: true, reason: "Ready" };
  });
  const wards = [...new Set(rows.map(row => row.scope?.wardPcode).filter(Boolean))];
  const readyIds = rows.filter(row => row.ready).map(row => row.salesId);
  return { rows, wards, readyIds, canSave: live?.ready && wards.length === 1 && readyIds.length > 0 && Boolean(geometry),
    canCreate: live?.ready && wards.length === 1 && readyIds.length > 0 && Boolean(draft.savedFence) && live.fence?.id === draft.savedFence.id && live.fence?.linkState === "UNLINKED" && !live.parent,
    gate: wards.length > 1 ? "Retained meters span multiple Wards. Remove the named meters outside the intended Ward." : wards.length === 0 ? "Resolve at least one meter to establish the Ward." : "" };
}
export function draftGeometry(points, savedFence) {
  try { return savedFence ? normalizeBatchGeometry(savedFence.geometry) : polygonFromPoints(points); } catch { return null; }
}

export function confirmationIdentity(draft, live) {
  return JSON.stringify([draft.id, draft.retainedIds, draft.selection, draft.resolutions, draft.savedFence, live]);
}
