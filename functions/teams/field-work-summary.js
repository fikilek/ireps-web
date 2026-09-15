// Targeted Batch rules TB-R045 (1.3.27) and Teams rules TM-R001: field work done outside batches
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

// Rules TB-R045 (1.3.26): access refused is No Access; every other record is a transaction,
// whatever its kind (discovery, installation, removal, disconnection, reconnection…).
export function classifyTrn(trn = {}) {
  const access = text(trn.accessData?.access?.hasAccess).toLowerCase();
  return access === "no" ? "NO_ACCESS" : "TRANSACTION";
}

// Rules TB-R045 (1.3.27): who did the work and when. A job (a record with a workflow, issued from
// the office or captured in the field) is work only once completed: it is the completing worker's,
// on the completion day. An unfinished job is no one's work yet (null).
export function workOf(trn = {}) {
  const workflow = trn.workflow;
  if (workflow && typeof workflow === "object") {
    if (text(workflow.state).toUpperCase() !== "COMPLETED") return null;
    return { job: true, uid: text(workflow.completedByUid) || text(trn.metadata?.createdByUid),
      name: text(workflow.completedByUser) || text(trn.metadata?.createdByUser), millis: millisOf(workflow.completedAt) ?? trnMillis(trn) };
  }
  return { job: false, uid: text(trn.metadata?.createdByUid), name: text(trn.metadata?.createdByUser), millis: trnMillis(trn) };
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

// usersSp: uid -> { id, name } of the worker's service provider. A job's record carries the issuer's
// service provider, so a completed job by a worker in no team uses the worker's own.
export function summarizeFieldWork({ trns = [], periods = [], usersSp = {} } = {}) {
  const groups = new Map();
  const totals = { trns: trns.length, batchTrns: 0, normalTrns: 0, unfinishedJobs: 0, transactions: 0, noAccess: 0 };
  for (const trn of trns) {
    if (isBatchTrn(trn)) { totals.batchTrns += 1; continue; }
    totals.normalTrns += 1;
    const work = workOf(trn);
    if (!work) { totals.unfinishedJobs += 1; continue; }
    const period = work.uid ? teamOnDate(periods, work.uid, work.millis) : null;
    const sp = (work.job && usersSp[work.uid]) || trn.serviceProvider || {};
    const spId = text(sp.id), spName = text(sp.name) || "Unknown service provider";
    const key = period ? `TEAM:${period.teamId}` : `NO_TEAM:${spId || "UNKNOWN"}`;
    const group = groups.get(key) || { key, type: period ? "TEAM" : "NO_TEAM", teamId: period?.teamId || null, spId: period ? null : spId || null,
      name: period ? period.teamName : `${spName} (no team)`, transactions: 0, noAccess: 0, workers: [] };
    if (classifyTrn(trn) === "NO_ACCESS") { group.noAccess += 1; totals.noAccess += 1; }
    else { group.transactions += 1; totals.transactions += 1; }
    const worker = work.name || work.uid || "Unknown";
    if (!group.workers.includes(worker)) group.workers.push(worker);
    groups.set(key, group);
  }
  return { totals, groups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}
