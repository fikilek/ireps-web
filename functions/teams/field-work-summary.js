// Targeted Batch rules TB-R045 (1.3.25) and Teams rules TM-R001: field work done outside batches
// (the normal path), credited to the team the worker belonged to on the date of the work.
const text = value => String(value ?? "").trim();

// Batch (sales path) work carries its batch; everything else is normal-path work.
export function isBatchTrn(trn = {}) {
  return trn.sourceModule === "SALES_TARGETED_BATCH" || Boolean(text(trn.targetedBatchContext?.tbId) || text(trn.derived?.targetedBatch?.tbId) || text(trn.accessData?.tbId));
}

function millisOf(value) {
  if (!value) return null;
  const millis = typeof value === "string" ? Date.parse(value) : typeof value === "number" ? value : value.toMillis?.() ?? (Number.isFinite(value.seconds) ? value.seconds * 1000 : NaN);
  return Number.isFinite(millis) ? millis : null;
}
export const trnMillis = trn => millisOf(trn?.metadata?.createdAt) ?? millisOf(trn?.metadata?.createdAtDatetime);

// Meter found with access; access refused; or any other field work (disconnection, reconnection…).
export function classifyTrn(trn = {}) {
  const access = text(trn.accessData?.access?.hasAccess).toLowerCase();
  if (access === "no") return "NO_ACCESS";
  if (trn.accessData?.trnType === "METER_DISCOVERY") return "DISCOVERED";
  return "OTHER";
}

// The worker's team on that date: the period covering it, the most recently joined if several.
// A record without a date uses the member's open period.
export function teamOnDate(periods = [], userUid, millis) {
  const covering = periods.filter(period => period.userUid === userUid).filter(period => {
    const joined = millisOf(period.joinedAt), left = millisOf(period.leftAt);
    if (millis === null) return left === null;
    return joined !== null && joined <= millis && (left === null || millis < left);
  });
  return covering.sort((a, b) => (millisOf(b.joinedAt) ?? 0) - (millisOf(a.joinedAt) ?? 0))[0] || null;
}

export function summarizeFieldWork({ trns = [], periods = [] } = {}) {
  const groups = new Map();
  const totals = { trns: trns.length, batchTrns: 0, normalTrns: 0, discovered: 0, noAccess: 0, other: 0 };
  for (const trn of trns) {
    if (isBatchTrn(trn)) { totals.batchTrns += 1; continue; }
    totals.normalTrns += 1;
    const uid = text(trn.metadata?.createdByUid), period = uid ? teamOnDate(periods, uid, trnMillis(trn)) : null;
    const spId = text(trn.serviceProvider?.id), spName = text(trn.serviceProvider?.name) || "Unknown service provider";
    const key = period ? `TEAM:${period.teamId}` : `NO_TEAM:${spId || "UNKNOWN"}`;
    const group = groups.get(key) || { key, type: period ? "TEAM" : "NO_TEAM", teamId: period?.teamId || null, spId: period ? null : spId || null,
      name: period ? period.teamName : `${spName} (no team)`, discovered: 0, noAccess: 0, other: 0, otherByType: {}, workers: [] };
    const kind = classifyTrn(trn);
    if (kind === "DISCOVERED") { group.discovered += 1; totals.discovered += 1; }
    else if (kind === "NO_ACCESS") { group.noAccess += 1; totals.noAccess += 1; }
    else { group.other += 1; totals.other += 1; const type = text(trn.accessData?.trnType) || "UNKNOWN"; group.otherByType[type] = (group.otherByType[type] || 0) + 1; }
    const worker = text(trn.metadata?.createdByUser) || uid || "Unknown";
    if (!group.workers.includes(worker)) group.workers.push(worker);
    groups.set(key, group);
  }
  return { totals, groups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}
