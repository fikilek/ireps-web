import { getMdBgoBatchStatus, getMdBgoRowStatusCounts, isBmdBatch } from "./mdBgoRegisterModel.js";

const id = value => {
  const text = String(value ?? "").trim();
  return text && text.toUpperCase() !== "NAV" ? text : "";
};
const unique = values => new Set(values.map(id).filter(Boolean));
const raw = batch => batch.raw || batch;

export function resolveMdBgoDashboardWorkbase(auth = {}, geoState = {}) {
  const candidate = auth.activeWorkbase || auth.profile?.access?.activeWorkbase || auth.profile?.activeWorkbase || auth.activeLm || auth.workbases?.[0] || auth.profile?.access?.workbases?.[0] || geoState.selectedLm || {};
  return { lmPcode: id(candidate.lmPcode || candidate.pcode || candidate.id || candidate.localMunicipalityId), lmName: candidate.name || candidate.lmName || candidate.id || candidate.pcode || "NAv" };
}

export function mdBgoMunicipalCoverage(wards = [], summaries = [], batchedErfs = 0) {
  const byWard = new Map(summaries.map(summary => [summary.ward?.pcode, summary]));
  let total = 0;
  for (const ward of new Map(wards.map(w => [w.pcode || w.id, w])).values()) {
    const summary = byWard.get(ward.pcode || ward.id);
    const count = summary?.counts?.totalErfs;
    if (summary?.calculation?.state !== "READY" || !Number.isInteger(count) || count < 0) {
      return { total: null, unbatched: null, percent: null, error: "Municipal ERF coverage is unavailable until every ward summary is ready." };
    }
    total += count;
  }
  if (batchedErfs > total) return { total, unbatched: null, percent: null, error: "Batched ERFs exceed the municipal ERF total. Coverage needs reconciliation." };
  return { total, unbatched: total - batchedErfs, percent: total ? 100 * batchedErfs / total : 0, error: "" };
}

export function buildMdBgoDashboard({ batches = [], rows = [], wards = [], summaries = [] } = {}) {
  const currentBatches = [...new Map(batches.filter(b => isBmdBatch(b) && String(raw(b).workflow?.state || b.workflowState).toUpperCase() !== "CANCELLED").map(b => [b.id, b])).values()];
  const batchIds = new Set(currentBatches.map(b => b.id));
  const activeRows = [...new Map(rows.filter(row => batchIds.has(row.bgoBatchId || row.batchId) && row.workflow?.state !== "CANCELLED").map(row => [row.id, row])).values()];
  const counts = getMdBgoRowStatusCounts(activeRows);
  const allErfs = new Set(), allPremises = new Set(), allMeters = new Set();
  const result = currentBatches.map(batch => {
    const data = raw(batch);
    const batchRows = activeRows.filter(row => (row.bgoBatchId || row.batchId) === batch.id);
    const worklist = data.worklist?.erfRefs || batch.erfRefs || [];
    const erfs = unique(worklist.map(ref => typeof ref === "string" ? ref : ref.id || ref.erfId));
    // Seed rows also retain canonical ERF identity if a worklist is absent.
    batchRows.forEach(row => { const key = id(row.erf?.id || row.refs?.erfId || row.erfId); if (key) erfs.add(key); });
    const premises = unique(batchRows.map(row => row.refs?.premiseId || row.premise?.id));
    const meters = unique(batchRows.map(row => row.refs?.meterId || row.meter?.id));
    erfs.forEach(key => allErfs.add(key)); premises.forEach(key => allPremises.add(key)); meters.forEach(key => allMeters.add(key));
    const progress = counts.get(batch.id) || { total: 0, inProgress: 0, completed: 0 };
    const target = batch.target || data.target || data.assignment?.target || data.bgo?.target || {};
    const targetId = id(batch.targetId || target.id || data.bgo?.targetId);
    return {
      id: batch.id,
      name: batch.geofenceName || data.geofenceRef?.name || data.geofence?.name || data.bgo?.geofenceRef?.name || "NAv",
      wardPcode: batch.scope?.wardPcode || data.scope?.wardPcode || "",
      status: getMdBgoBatchStatus({ ...batch, workflowState: batch.workflowState || data.workflow?.state }),
      team: targetId ? id(batch.targetName || target.name || data.bgo?.targetName) || "NAv" : "Unallocated",
      ...progress, notStarted: progress.total - progress.inProgress - progress.completed,
      erfs: erfs.size, premises: premises.size, meters: meters.size,
      completion: progress.total ? 100 * progress.completed / progress.total : 0,
    };
  }).sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
  const totals = result.reduce((sum, batch) => ({ total: sum.total + batch.total, notStarted: sum.notStarted + batch.notStarted, inProgress: sum.inProgress + batch.inProgress, completed: sum.completed + batch.completed }), { total: 0, notStarted: 0, inProgress: 0, completed: 0 });
  return { batches: result, ...totals, batchCount: result.length, erfs: allErfs.size, premises: allPremises.size, meters: allMeters.size, completion: totals.total ? 100 * totals.completed / totals.total : 0, coverage: mdBgoMunicipalCoverage(wards, summaries, allErfs.size) };
}

export function mdBgoChartScale(batches) {
  const maximum = Math.max(1, ...batches.map(batch => batch.total));
  const unit = 10 ** Math.floor(Math.log10(maximum));
  const step = Math.max(1, Math.ceil(maximum / unit / 5) * unit);
  const max = Math.ceil(maximum / step) * step;
  return { max, ticks: Array.from({ length: max / step + 1 }, (_, i) => i * step) };
}
