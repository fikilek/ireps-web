// Targeted Batch rules TB-R059 (1.3.62): a batch is work given to a team. While a meter sits in a batch
// that is allocated, only that TEAM or service provider may do any work on that meter — whatever form the
// work comes from. Everybody else is refused and nothing is written.
//
// The meter is free when it is in no batch, when nobody has been given the work of its batch, when the
// worker is in the batch's team or under its service provider, when the batch's own work on the meter is
// finished (its row is Completed — owner decision 2026-09-19) or when the Sales meter is already VISIBLE.
// A batch being allocated, or whose allocation failed, already names a team, so it is not free (1.3.62).
//
// When iREPS cannot check, the work is refused and nothing is written (1.3.62): a membership or a batch
// that cannot be read never lets work through. The worker is told one plain sentence and the phone keeps
// the work to try again.
//
// Targeted Batch rules TB-R062 (1.3.65) locks the ERF, not the meter number. A worker who types a different
// number at the same place walked past TB-R059, which the owner proved on DEV: a meter ending 4817 captured
// at ERF 3490 while the batch's own 4816 stayed Not Started. So while a batch is allocated, every ERF one of
// its rows sits on belongs to that team, and nobody outside it may record meter work there — not the batch's
// meter, not a different number, not a second or third meter at the same place.
//
// The one gate is a meter reported as ILLEGALLY CONNECTED: that work goes through, because stopping it would
// cost the municipality revenue and leave something dangerous in the ground. It stays an ordinary normal-path
// find — the batch's row is untouched, so the allocated team keeps its work and its count, and the finder and
// the team they belong to keep the credit (Teams rules TM-R001). Every use is recorded in
// `batch_erf_overrides`, one document per use, so the office can count them per worker AND per team.
// The gate never applies to the batch's own meter number: that stays TB-R059's ownership test.
//
// Pure decision plus a thin reader. The reader takes a read function, so a caller can gather the facts
// inside its own transaction or outside one, and every field-work callable calls it before it writes.
import { resolveSalesTargetedBatchMembership, timestampMillis } from "../salesAllMeters/sales-batch-policy.js";
import { teamOnDate } from "../teams/field-work-summary.js";
import { TEAM_MEMBER_HISTORY } from "../teams/member-history.js";
import { TARGETED_BATCH_COLLECTIONS, normalizeMeterNo } from "./helpers.js";

export const RULE = "TB-R059";
// Rules TB-R062 (1.3.65): the ERF test and its one gate. The refusal the worker is told is TB-R059's
// sentence, word for word, so the phone needs nothing new; the rule that refused it travels in the details.
export const ERF_RULE = "TB-R062";
export const RULES_VERSION = "1.3.65";
export const METER_IN_ANOTHER_TEAMS_BATCH = "METER_IN_ANOTHER_TEAMS_BATCH";
// Rules TB-R059 (1.3.62): the work is refused because iREPS could not check, not because the meter belongs
// to somebody else. Its own code, so the phone can tell the two refusals apart.
export const BATCH_CHECK_UNAVAILABLE = "BATCH_CHECK_UNAVAILABLE";
export const UNREADABLE_MESSAGE = "iREPS could not check which batch this meter is in. Nothing was saved. Please try again.";
export const GEOFENCES = "geo_fences";
export const PREMISES = "premises";
// Rules TB-R062 (1.3.65): one document per use of the illegally-connected gate, so the office can list them
// and count them per worker and per team. The document id is the TRN id, so a retry never counts twice.
export const BATCH_ERF_OVERRIDES = "batch_erf_overrides";
// An ERF holds a handful of batch rows. A page that fills up means iREPS has not seen the whole ERF, and the
// rule never lets work through because a read fell short, so a full page refuses instead (1.3.62).
export const ERF_ROWS_LIMIT = 100;

// Why the work was allowed. These four, and the four the rule names below them, are the whole list: a
// read that fails is never one of them (1.3.62).
export const ALLOWED = Object.freeze({
  NO_METER: "NO_METER_NUMBER",
  NO_SALES: "NO_SALES_RECORD",
  NO_BATCH: "NOT_IN_A_BATCH",
  NOT_ALLOCATED: "BATCH_NOT_ALLOCATED",
  OWN_TEAM: "WORKER_IN_BATCH_TEAM",
  OWN_SP: "WORKER_UNDER_BATCH_SERVICE_PROVIDER",
  ROW_COMPLETED: "BATCH_ROW_COMPLETED",
  VISIBLE: "METER_VISIBLE",
  // Rules TB-R062 (1.3.65): the ERF was another team's, and the gate let this meter through.
  ILLEGAL_CONNECTION: "ILLEGALLY_CONNECTED_METER",
  ERF_FREE: "ERF_FREE",
});
// What could not be read, kept on the refusal so the office can see which read failed.
export const UNREADABLE = Object.freeze({
  MEMBERSHIP: "BATCH_MEMBERSHIP_UNREADABLE",
  BATCH: "BATCH_NOT_READABLE",
  FACTS: "BATCH_FACTS_UNREADABLE",
  ERF_BATCH: "ERF_BATCH_NOT_READABLE",
  ERF_ROWS: "ERF_ROWS_NOT_FULLY_READ",
});

const text = value => String(value ?? "").trim();
const upper = value => text(value).toUpperCase();
// Letters and digits only, so "Illegal connection - meter disconnected" matches however the phone, an old
// queued form or a hand-typed correction spelled it: case, spacing and punctuation are all ignored.
const compact = value => upper(value).replace(/[^A-Z0-9]/g, "");
const sameId = (left, right) => Boolean(text(left)) && text(left) === text(right);
const rowExecutionStatus = row => upper(row?.execution?.status) || "NOT_STARTED";
// The members a team document lists now, read the way the batch execution guards read them.
export function teamMemberIds(team = {}) {
  const ids = new Set();
  const add = value => { const id = text(value); if (id) ids.add(id); };
  (Array.isArray(team?.memberUids) ? team.memberUids : []).forEach(add);
  (Array.isArray(team?.scope?.memberUserIds) ? team.scope.memberUserIds : []).forEach(add);
  [...(Array.isArray(team?.members) ? team.members : []), ...(Array.isArray(team?.users) ? team.users : [])]
    .forEach(member => (typeof member === "string" ? add(member) : [member?.uid, member?.id, member?.userId].forEach(add)));
  return ids;
}
// The worker's service provider, read from their profile the way every Targeted Batch path reads it.
export const profileServiceProviderId = profile => text(profile?.profile?.employment?.serviceProvider?.id || profile?.employment?.serviceProvider?.id || profile?.serviceProvider?.id);
export const profileRole = profile => upper(profile?.employment?.role || profile?.profile?.employment?.role || profile?.role);
export const profileName = profile => text(profile?.profile?.displayName || profile?.displayName || profile?.profile?.name || profile?.name);

// ---------------------------------------------------------------- TB-R062: reported as illegally connected
// The words the phone sends. The anomaly the worker picks on Meter Discovery, and the two normalisation
// actions for an illegal connection. The phone's own list is ireps-mobile/src/features/meters/formOptions.js
// (anomalies "Illegally Connected"; norm_actions "Illegal connection - meter disconnected" and
// "... - meter reconnected"); the two lists must agree or the gate would miss a real find.
export const ILLEGAL_ANOMALIES = Object.freeze(["Illegally Connected"]);
export const ILLEGAL_ACTIONS = Object.freeze([
  "Illegal connection - meter disconnected",
  "Illegal connection - meter reconnected",
]);
const ILLEGAL_ANOMALY_KEYS = new Set(ILLEGAL_ANOMALIES.map(compact));
const ILLEGAL_ACTION_KEYS = new Set(ILLEGAL_ACTIONS.map(compact));

// What a form says about the meter it is recording, gathered from every shape the server is handed: a Meter
// Discovery or Installation payload (`ast.anomalies`, `ast.normalisation.actionTaken`), an Inspection's
// captured AST, and an AST document read back for a lifecycle or commissioning transaction (`ast.ast`).
export function anomalyReport(source = {}) {
  const anomalies = new Set(), actions = new Set();
  const add = (set, value) => { const word = text(value); if (word) set.add(word); };
  // Several sources at once — this form's payload and the AST it is working on — as a plain list.
  if (Array.isArray(source)) {
    const parts = source.filter(Boolean).map(anomalyReport);
    return { anomalies: [...new Set(parts.flatMap(part => part.anomalies))], actions: [...new Set(parts.flatMap(part => part.actions))] };
  }
  for (const ast of [source, source?.ast, source?.ast?.ast, source?.inspection?.captured?.ast]) {
    if (!ast || typeof ast !== "object") continue;
    const reported = ast.anomalies || {};
    [reported.anomaly, reported.anomalyDetail, reported.anomalySelect?.name, reported.anomalySelect?.code].forEach(value => add(anomalies, value));
    (Array.isArray(reported.otherAnomalies) ? reported.otherAnomalies : []).forEach(value => add(anomalies, value));
    const taken = ast.normalisation?.actionTaken;
    (Array.isArray(taken) ? taken : [taken]).forEach(value => add(actions, value));
  }
  return { anomalies: [...anomalies], actions: [...actions] };
}

// A report already gathered is used as it stands; anything else is a raw form or AST, and is gathered first.
const gathered = report => (Array.isArray(report?.anomalies) && Array.isArray(report?.actions) ? report : anomalyReport(report || {}));

// Rules TB-R062: is this meter reported as illegally connected? Either the anomaly says so, or the worker
// recorded an illegal-connection normalisation. Matched on the words themselves, never on a loose "illegal".
export function isIllegallyConnected(report) {
  const { anomalies, actions } = gathered(report);
  return anomalies.some(value => ILLEGAL_ANOMALY_KEYS.has(compact(value)))
    || actions.some(value => ILLEGAL_ACTION_KEYS.has(compact(value)));
}

// The worker's own words, kept on the record so the office reads what was reported, not a code.
export function illegalConnectionWords(report) {
  const { anomalies, actions } = gathered(report);
  return [
    ...anomalies.filter(value => ILLEGAL_ANOMALY_KEYS.has(compact(value))),
    ...actions.filter(value => ILLEGAL_ACTION_KEYS.has(compact(value))),
  ].join("; ");
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// "14 September 2026", in the field's own time. A date the batch does not hold is left out of the sentence.
export function allocationDateWords(value) {
  const millis = typeof value === "number" && Number.isFinite(value) ? value
    : typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value)
      : timestampMillis(value);
  if (millis === null || millis === undefined) return "";
  const parts = new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(millis));
  const part = type => parts.find(entry => entry.type === type)?.value;
  const day = Number(part("day")), month = Number(part("month")), year = part("year");
  return Number.isInteger(day) && MONTHS[month - 1] ? `${day} ${MONTHS[month - 1]} ${year}` : "";
}

// Rules TB-R059: one plain sentence naming the batch, its geofence, the team it is allocated to and the date.
export function refusalMessage({ tbId, geofenceName, targetType, targetName, allocatedAt, about = "meter" }) {
  const fence = text(geofenceName) ? `geofence ${text(geofenceName)}` : "no geofence";
  const isSp = upper(targetType) === "SP";
  const who = text(targetName) || (isSp ? "another service provider" : "another team");
  const when = allocationDateWords(allocatedAt);
  // TB-R062: at an ERF the worker may have typed another number, so the sentence names the place, not the meter.
  const what = about === "erf" ? "This ERF is in batch" : "This meter is in batch";
  return `${what} ${text(tbId)}, ${fence}, allocated to ${who}${when ? ` on ${when}` : ""}. Only that ${isSp ? "service provider" : "team"} can work on it.`;
}

export function batchAllocation(parent = {}) {
  const allocation = parent?.allocation || {}, target = allocation?.target || {};
  return {
    status: upper(allocation.status),
    type: upper(allocation.targetType || target.type),
    id: text(allocation.targetId) || text(target.id),
    name: text(allocation.targetName) || text(target.name),
    allocatedAt: allocation.allocatedAt ?? allocation.completedAt ?? allocation.startedAt ?? null,
  };
}

// Rules TB-R059 (1.3.62): nobody has been given this work. Only the plainly unallocated state counts —
// no status at all, an empty one or NOT_STARTED, and no TEAM or SP named. A batch being allocated, or
// whose allocation failed, already names a team, so it is not free.
export const explicitlyUnallocated = (allocation = {}) => ["", "NOT_STARTED"].includes(upper(allocation.status)) && !text(allocation.id);

// Is this worker inside the team or the service provider the batch is allocated to? One test, used by
// TB-R059 on the meter, by TB-R062 on the ERF and by TB-R063 (1.3.66) to decide whether a find at the
// batch's ERF is the batch's own work, so the credit follows the finder and never the wrong team.
export function workerInside({ allocation, allocatedTeam, finderUid, finderTeamId, finderSpId }) {
  if (allocation.type === "TEAM" && sameId(finderTeamId, allocation.id)) return "TEAM_HISTORY";
  if (allocation.type === "TEAM" && text(finderUid) && teamMemberIds(allocatedTeam).has(text(finderUid))) return "TEAM_MEMBER_LIST";
  if (allocation.type === "SP" && sameId(finderSpId, allocation.id)) return "SP";
  return "";
}

// Rules TB-R059: the meter's own batch. Pure: the caller hands it the facts, including the geofence name.
export function decideMeterBatchWork({ sales, parent, row, allocatedTeam = null, geofenceName = "", finderUid = "", finderTeamId = "", finderSpId = "", meterNo = "", tbId = "" } = {}) {
  const allow = (code, details = {}) => ({ allowed: true, code, details: { meterNo: text(meterNo) || null, ...details } });
  // Rules TB-R059 (1.3.62): iREPS could not check, so the work is refused and nothing is written.
  const cannotCheck = (reason, details = {}) => ({
    allowed: false,
    code: BATCH_CHECK_UNAVAILABLE,
    message: UNREADABLE_MESSAGE,
    details: { rule: RULE, rulesVersion: RULES_VERSION, meterNo: text(meterNo) || null, reason, ...details },
  });
  if (!text(meterNo)) return allow(ALLOWED.NO_METER);
  if (!sales) return allow(ALLOWED.NO_SALES);
  const membership = resolveSalesTargetedBatchMembership(sales);
  if (membership.state === "NONE") return allow(ALLOWED.NO_BATCH);
  if (membership.state !== "MEMBER" || !text(membership.tbId)) return cannotCheck(UNREADABLE.MEMBERSHIP, { detail: membership.reason || null });
  const batchId = text(membership.tbId) || text(tbId);
  // A VISIBLE Sales meter is completed (the owner's settled definition), so the batch holds no work on it.
  if (upper(sales?.master?.visibility) === "VISIBLE") return allow(ALLOWED.VISIBLE, { tbId: batchId });
  if (!parent) return cannotCheck(UNREADABLE.BATCH, { tbId: batchId });
  const allocation = batchAllocation(parent);
  // Only a batch nobody has been given the work of is free; anything else is tested against the worker.
  if (explicitlyUnallocated(allocation)) {
    return allow(ALLOWED.NOT_ALLOCATED, { tbId: batchId, rowId: text(row?.id) || null, targetType: allocation.type || null, targetId: allocation.id || null });
  }
  // Owner decision 2026-09-19: once the batch's work on the meter is done its row is Completed, and later
  // work (a reading, an inspection, a disconnection) is ordinary work that anyone may do.
  if (rowExecutionStatus(row) === "COMPLETED") return allow(ALLOWED.ROW_COMPLETED, { tbId: batchId, rowId: text(row?.id) || null });
  // Rules TB-R059: the team the worker belongs to now, from their profile and the team list. Either the
  // membership period that is still open (TM-R001) or the team's own member list places the worker in it.
  const inside = workerInside({ allocation, allocatedTeam, finderUid, finderTeamId, finderSpId });
  // GMR-R038 (1.6.0): the row is carried on the allowed paths too, not only when work is refused. The
  // work belongs to this batch row, and a transaction that does not say so reads as done outside any
  // batch and leaves the row blind to the meter found on it.
  if (inside === "TEAM_HISTORY" || inside === "TEAM_MEMBER_LIST") return allow(ALLOWED.OWN_TEAM, { tbId: batchId, rowId: text(row?.id) || null, targetId: allocation.id, matchedBy: inside });
  if (inside === "SP") return allow(ALLOWED.OWN_SP, { tbId: batchId, rowId: text(row?.id) || null, targetId: allocation.id });
  const details = {
    rule: RULE, rulesVersion: RULES_VERSION, meterNo: text(meterNo) || null, tbId: batchId,
    rowId: text(row?.id) || null, geofenceId: text(parent?.geofenceId) || null, geofenceName: text(geofenceName) || null,
    targetType: allocation.type, targetId: allocation.id, targetName: allocation.name || null,
    allocatedOn: allocationDateWords(allocation.allocatedAt) || null,
    workerTeamId: text(finderTeamId) || null, workerServiceProviderId: text(finderSpId) || null,
  };
  return {
    allowed: false,
    code: METER_IN_ANOTHER_TEAMS_BATCH,
    message: refusalMessage({ tbId: batchId, geofenceName, targetType: allocation.type, targetName: allocation.name, allocatedAt: allocation.allocatedAt }),
    details,
  };
}

// ---------------------------------------------------------------- TB-R062: the ERF test
// Rules TB-R062 (1.3.65): while a batch is allocated, every ERF one of its rows sits on belongs to that
// team. Pure: the caller hands it the batch rows found on this ERF, each already carrying its batch, that
// batch's geofence name and allocated team, and the Sales visibility of the meter the row is for.
//
// A row is passed over — the ERF is free of it — when:
//  - it is the row for the meter this work is recording: TB-R059 settled that meter above;
//  - its work is done (the row is Completed, or its Sales meter is VISIBLE, which IS completed);
//  - nobody has been given its batch's work;
//  - the worker is in its batch's team or under its service provider.
// A row a supervisor took out under TB-R060 is gone from tb_rows, so it stops matching by itself.
export function decideErfBatchWork({ erfId = "", erfRows = null, erfUnreadable = "", finderUid = "", finderTeamId = "", finderSpId = "", meterNo = "" } = {}) {
  const free = (code, details = {}) => ({ allowed: true, code, details: { meterNo: text(meterNo) || null, erfId: text(erfId) || null, ...details } });
  const cannotCheck = (reason, details = {}) => ({
    allowed: false, code: BATCH_CHECK_UNAVAILABLE, message: UNREADABLE_MESSAGE,
    details: { rule: ERF_RULE, rulesVersion: RULES_VERSION, meterNo: text(meterNo) || null, erfId: text(erfId) || null, reason, ...details },
  });
  if (text(erfUnreadable)) return cannotCheck(erfUnreadable);
  // No ERF was worked out, or the ERF carries no batch rows at all: there is nothing this rule can hold.
  if (!text(erfId) || !Array.isArray(erfRows) || erfRows.length === 0) return free(ALLOWED.ERF_FREE);
  const worked = normalizeMeterNo(meterNo);
  // GMR-R038 (1.6.0): the rows on this ERF that are the worker's own batch work, collected as the walk
  // passes over them. One of them means this capture belongs to that batch row; several mean the ERF
  // carries more than one open row of theirs (flats), and naming one would credit work to the wrong row.
  const ownRows = [];
  for (const entry of erfRows) {
    const row = entry?.row || {};
    if (sameId(normalizeMeterNo(row?.salesAllMeterId), worked)) continue;
    if (rowExecutionStatus(row) === "COMPLETED") continue;
    if (upper(entry?.visibility) === "VISIBLE") continue;
    if (!entry?.parent) return cannotCheck(UNREADABLE.ERF_BATCH, { tbId: text(row?.tbId) || null, rowId: text(row?.id) || null });
    const allocation = batchAllocation(entry.parent);
    if (explicitlyUnallocated(allocation)) {
      ownRows.push({ tbId: text(row?.tbId) || null, rowId: text(row?.id) || null, erfId: text(erfId) || null });
      continue;
    }
    if (workerInside({ allocation, allocatedTeam: entry.allocatedTeam, finderUid, finderTeamId, finderSpId })) {
      ownRows.push({ tbId: text(row?.tbId) || null, rowId: text(row?.id) || null, erfId: text(erfId) || null });
      continue;
    }
    return {
      allowed: false,
      code: METER_IN_ANOTHER_TEAMS_BATCH,
      // The rule's own words: TB-R059's sentence, naming the batch, its geofence, the team and the date.
      message: refusalMessage({ about: "erf", tbId: row?.tbId, geofenceName: entry.geofenceName, targetType: allocation.type, targetName: allocation.name, allocatedAt: allocation.allocatedAt }),
      details: {
        rule: ERF_RULE, rulesVersion: RULES_VERSION, matchedOn: "ERF",
        meterNo: text(meterNo) || null, erfId: text(erfId),
        tbId: text(row?.tbId) || null, rowId: text(row?.id) || null, rowMeterNo: text(row?.salesAllMeterId) || null,
        geofenceId: text(entry.parent?.geofenceId) || null, geofenceName: text(entry.geofenceName) || null,
        targetType: allocation.type, targetId: allocation.id, targetName: allocation.name || null,
        allocatedOn: allocationDateWords(allocation.allocatedAt) || null,
        workerTeamId: text(finderTeamId) || null, workerServiceProviderId: text(finderSpId) || null,
      },
    };
  }
  // GMR-R038: exactly one of the worker's own rows on this ERF, so the capture can say which batch row it
  // belongs to. More than one is ambiguous and nothing is named: see TB-R067 and the flats case.
  const ownRow = ownRows.length === 1 ? ownRows[0] : null;
  return free(ALLOWED.ERF_FREE, ownRow ? { ownRow, ownRowCount: 1 } : { ownRowCount: ownRows.length });
}

// Rules TB-R062 (1.3.65): what the office is given for every use of the gate, so a worker who keeps using
// it — or a team that does — is seen and not guessed at. Counted per worker by `worker.uid` and per team by
// `worker.teamId`, both plain equality reads that need no new index.
export function erfOverrideRecord({ refusal, meterNo, finderUid, finderName, finderTeamId, finderTeamName, finderSpId, anomaly }) {
  const details = refusal?.details || {};
  return {
    rule: ERF_RULE, rulesVersion: RULES_VERSION,
    worker: {
      uid: text(finderUid) || null, name: text(finderName) || null,
      teamId: text(finderTeamId) || null, teamName: text(finderTeamName) || null,
      serviceProviderId: text(finderSpId) || null,
    },
    erfId: text(details.erfId) || null,
    meterNo: normalizeMeterNo(meterNo) || null,
    batch: {
      tbId: text(details.tbId) || null, rowId: text(details.rowId) || null, rowMeterNo: text(details.rowMeterNo) || null,
      geofenceId: text(details.geofenceId) || null, geofenceName: text(details.geofenceName) || null,
      targetType: details.targetType || null, targetId: details.targetId || null, targetName: details.targetName || null,
      allocatedOn: details.allocatedOn || null,
    },
    anomaly: {
      text: illegalConnectionWords(anomaly) || null,
      reported: gathered(anomaly || {}).anomalies,
      actions: gathered(anomaly || {}).actions,
    },
  };
}

// The whole decision: TB-R059 on the meter first, then TB-R062 on the ERF, then the one gate.
export function decideBatchWork(facts = {}) {
  const meter = decideMeterBatchWork(facts);
  // The meter's own batch settles it. The gate never applies to the batch's own meter number, and a read
  // that failed is never gated either (1.3.62).
  if (!meter.allowed) return meter;
  const erf = decideErfBatchWork(facts);
  if (erf.allowed || erf.code === BATCH_CHECK_UNAVAILABLE) return erf.allowed ? meter : erf;
  // Rules TB-R062: the one gate. A meter reported as illegally connected goes through as an ordinary
  // normal-path find — the batch's row is untouched — and the use is recorded for the office.
  if (!isIllegallyConnected(facts.anomaly)) return erf;
  return {
    allowed: true,
    code: ALLOWED.ILLEGAL_CONNECTION,
    details: {
      meterNo: text(facts.meterNo) || null, erfId: erf.details.erfId, rule: ERF_RULE, rulesVersion: RULES_VERSION,
      anomalyText: illegalConnectionWords(facts.anomaly),
      refusedBy: erf.details, refusalMessage: erf.message,
    },
    override: erfOverrideRecord({
      refusal: erf, meterNo: facts.meterNo, anomaly: facts.anomaly,
      finderUid: facts.finderUid, finderName: facts.finderName,
      finderTeamId: facts.finderTeamId, finderTeamName: facts.finderTeamName, finderSpId: facts.finderSpId,
    }),
  };
}

export function batchWorkRefusalError(decision) {
  const error = new Error(decision.message);
  error.code = decision.code;
  error.irepsCode = decision.code;
  error.details = decision.details;
  return error;
}

export function assertBatchWorkAllowed(facts) {
  const decision = decideBatchWork(facts);
  if (!decision.allowed) throw batchWorkRefusalError(decision);
  return decision;
}

export const defaultRead = ref => ref.get();

// The meter an AST document is for: transactions that name only an AST (lifecycle, commissioning) start here.
export const astMeterNo = (ast = {}) => normalizeMeterNo(ast?.master?.id || ast?.ast?.astData?.astNo || ast?.astData?.astNo || "");

export async function readAstMeterNo({ db, read = defaultRead, astId }) {
  if (!text(astId)) return "";
  const snapshot = await read(db.collection("asts").doc(text(astId)));
  return snapshot?.exists ? astMeterNo(snapshot.data() || {}) : "";
}

const docData = async (read, ref) => { const snapshot = await read(ref); return snapshot?.exists ? snapshot.data() || {} : null; };

// Rules TB-R062 (1.3.65): the ERF the work is happening on. The form's own ERF is taken first; when it does
// not carry one, the premise it is using does, because a premise sits on an ERF.
export async function readWorkErfId({ db, read = defaultRead, erfId = "", premiseId = "" }) {
  const given = text(erfId);
  if (given && given !== "NAv") return given;
  const id = text(premiseId);
  if (!id || id === "NAv") return "";
  const premise = await docData(read, db.collection(PREMISES).doc(id));
  const fromPremise = text(premise?.erfId);
  return fromPremise && fromPremise !== "NAv" ? fromPremise : "";
}

// Everything the decision needs: the Sales record, the batch, the batch's row for this meter, the geofence
// name, the worker's service provider and current team (Teams rules TM-R001: the open membership period,
// read by userUid alone so no new index is needed, then the open period is taken as teamOnDate does), and
// — for TB-R062 — every batch row that sits on the ERF this work is happening on, each with its batch.
export async function readBatchWorkFacts({ db, read = defaultRead, meterNo, uid, erfId = "", premiseId = "", anomaly = null }) {
  const id = normalizeMeterNo(meterNo);
  const facts = {
    meterNo: id, finderUid: text(uid), sales: null, parent: null, row: null, allocatedTeam: null, geofenceName: "",
    finderTeamId: "", finderSpId: "", finderName: "", finderTeamName: "", tbId: "",
    erfId: "", erfRows: null, erfUnreadable: "", anomaly: anomaly ? anomalyReport(anomaly) : null,
  };
  facts.sales = id ? await docData(read, db.collection(TARGETED_BATCH_COLLECTIONS.sales).doc(id)) : null;
  const membership = facts.sales ? resolveSalesTargetedBatchMembership(facts.sales) : { state: "NONE" };
  if (membership.state === "MEMBER" && text(membership.tbId)) facts.tbId = text(membership.tbId);
  facts.erfId = await readWorkErfId({ db, read, erfId, premiseId });

  // The worker, once, for both tests. Read only when there is something to test them against.
  if (text(uid) && (facts.tbId || facts.erfId)) {
    const [profileSnapshot, periodsSnapshot] = await Promise.all([
      read(db.collection(TARGETED_BATCH_COLLECTIONS.users).doc(text(uid))),
      read(db.collection(TEAM_MEMBER_HISTORY).where("userUid", "==", text(uid))),
    ]);
    const profile = profileSnapshot?.exists ? profileSnapshot.data() || {} : {};
    facts.finderSpId = profileServiceProviderId(profile);
    facts.finderRole = profileRole(profile);
    facts.finderName = profileName(profile);
    const periods = (periodsSnapshot?.docs || []).map(doc => ({ id: doc.id, ...(doc.data() || {}) }));
    const period = teamOnDate(periods, text(uid), null);
    facts.finderTeamId = text(period?.teamId);
    facts.finderTeamName = text(period?.teamName);
    if (!facts.finderName) facts.finderName = text(period?.userName);
  }

  // Each batch is read once, however many of its rows sit on this ERF.
  const batches = new Map();
  const readBatch = async (tbId) => {
    const key = text(tbId);
    if (!key) return { parent: null, geofenceName: "", allocatedTeam: null };
    if (batches.has(key)) return batches.get(key);
    const parent = await docData(read, db.collection(TARGETED_BATCH_COLLECTIONS.uploads).doc(key));
    const fenceId = text(parent?.geofenceId);
    const allocation = batchAllocation(parent || {});
    const [fence, team] = await Promise.all([
      fenceId ? docData(read, db.collection(GEOFENCES).doc(fenceId)) : Promise.resolve(null),
      allocation.type === "TEAM" && allocation.id ? docData(read, db.collection("teams").doc(allocation.id)) : Promise.resolve(null),
    ]);
    const entry = { parent, geofenceName: text(fence?.name), allocatedTeam: team };
    batches.set(key, entry);
    return entry;
  };

  if (facts.tbId) {
    const rowSnapshot = await read(db.collection(TARGETED_BATCH_COLLECTIONS.rows).where("tbId", "==", facts.tbId).where("salesAllMeterId", "==", id).limit(1));
    const rowDoc = rowSnapshot?.docs?.[0];
    facts.row = rowDoc ? { id: rowDoc.id, ...(rowDoc.data() || {}) } : null;
    const own = await readBatch(facts.tbId);
    facts.parent = own.parent;
    facts.geofenceName = own.geofenceName;
    facts.allocatedTeam = own.allocatedTeam;
  }

  // Rules TB-R062: every row of any batch that sits on this ERF. A single equality on refs.erfId, which
  // Firestore indexes on its own, so no new index is needed.
  if (facts.erfId) {
    const erfSnapshot = await read(db.collection(TARGETED_BATCH_COLLECTIONS.rows).where("refs.erfId", "==", facts.erfId).limit(ERF_ROWS_LIMIT));
    const docs = erfSnapshot?.docs || [];
    if (docs.length >= ERF_ROWS_LIMIT) {
      facts.erfUnreadable = UNREADABLE.ERF_ROWS;
      return facts;
    }
    const rows = docs.map(doc => ({ id: doc.id, ...(doc.data() || {}) }));
    facts.erfRows = [];
    for (const row of rows) {
      // Rows the test passes over on their face need nothing read for them.
      const rowMeter = normalizeMeterNo(row?.salesAllMeterId);
      if (rowExecutionStatus(row) === "COMPLETED" || (rowMeter && rowMeter === id)) {
        facts.erfRows.push({ row, parent: null, geofenceName: "", allocatedTeam: null, visibility: "" });
        continue;
      }
      const batch = await readBatch(row?.tbId);
      // A VISIBLE Sales meter IS completed (the owner's settled definition), so its batch holds no work on
      // it. Read only for a row that would otherwise stand in the way.
      const allocation = batchAllocation(batch.parent || {});
      const stands = batch.parent && !explicitlyUnallocated(allocation)
        && !workerInside({ allocation, allocatedTeam: batch.allocatedTeam, finderUid: text(uid), finderTeamId: facts.finderTeamId, finderSpId: facts.finderSpId });
      const rowSales = stands && rowMeter ? await docData(read, db.collection(TARGETED_BATCH_COLLECTIONS.sales).doc(rowMeter)) : null;
      facts.erfRows.push({ row, ...batch, visibility: upper(rowSales?.master?.visibility) });
    }
  }
  return facts;
}

// What a callable calls: read the facts, decide, log. A read that fails refuses the work (1.3.62).
export async function checkBatchWork({ db, read = defaultRead, meterNo, uid, erfId = "", premiseId = "", anomaly = null, log = null }) {
  const insideTransaction = read !== defaultRead;
  let facts;
  try {
    facts = await readBatchWorkFacts({ db, read, meterNo, uid, erfId, premiseId, anomaly });
  } catch (error) {
    const details = { rule: RULE, rulesVersion: RULES_VERSION, meterNo: normalizeMeterNo(meterNo) || null, uid: text(uid) || null, reason: UNREADABLE.FACTS, detail: error?.message || String(error) };
    log?.error?.(`${RULE}: the batch could not be checked, so the work is refused and nothing is written`, details);
    const refusal = { allowed: false, code: BATCH_CHECK_UNAVAILABLE, message: UNREADABLE_MESSAGE, details };
    // Inside a transaction the read itself failed. The error is never swallowed: it is thrown on, so the
    // transaction is abandoned with nothing written and a mistake in this code — a read after a write —
    // surfaces instead of hiding behind a refusal every worker would see. The worker still gets the
    // sentence the rule requires, and the cause travels with it.
    if (insideTransaction) throw Object.assign(batchWorkRefusalError(refusal), { cause: error });
    return refusal;
  }
  const decision = decideBatchWork(facts);
  if (decision.code === BATCH_CHECK_UNAVAILABLE) log?.error?.(`${RULE}: the batch could not be checked, so the work is refused and nothing is written`, { uid: text(uid) || null, ...decision.details });
  // Rules TB-R062: the gate was used. Warned as well as recorded, so it shows in the logs the office reads.
  else if (decision.code === ALLOWED.ILLEGAL_CONNECTION) log?.warn?.(`${ERF_RULE}: an illegally connected meter was allowed on another team's ERF, and the use is recorded`, { uid: text(uid) || null, ...decision.details });
  else if (!decision.allowed) log?.warn?.(`${decision.details?.rule || RULE}: work refused, the ${decision.details?.matchedOn === "ERF" ? "ERF belongs to another team's batch" : "meter is in another team's batch"}`, { uid: text(uid) || null, ...decision.details });
  return decision;
}

// Rules TB-R062 (1.3.65): record one use of the gate. The document id is the TRN id, so a retry of the same
// submission never counts twice. Written where the work itself is written: inside the caller's transaction
// when it has one, so a use is never recorded for work that did not go through.
export const defaultWrite = (ref, value) => ref.set(value);

export async function recordErfOverride({ db, write = defaultWrite, decision, trnId, trnType = "", now = new Date().toISOString(), log = null }) {
  if (decision?.code !== ALLOWED.ILLEGAL_CONNECTION || !decision?.override || !text(trnId)) return null;
  const record = { ...decision.override, id: text(trnId), trnId: text(trnId), trnType: text(trnType) || null, recordedAt: now };
  await write(db.collection(BATCH_ERF_OVERRIDES).doc(text(trnId)), record);
  log?.warn?.(`${ERF_RULE}: batch ERF override recorded`, { trnId: record.trnId, erfId: record.erfId, meterNo: record.meterNo, workerUid: record.worker.uid, workerTeamId: record.worker.teamId, tbId: record.batch.tbId, allocatedTo: record.batch.targetName });
  return record;
}
