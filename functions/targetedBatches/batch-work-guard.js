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
// Pure decision plus a thin reader. The reader takes a read function, so a caller can gather the facts
// inside its own transaction or outside one, and every field-work callable calls it before it writes.
import { resolveSalesTargetedBatchMembership, timestampMillis } from "../salesAllMeters/sales-batch-policy.js";
import { teamOnDate } from "../teams/field-work-summary.js";
import { TEAM_MEMBER_HISTORY } from "../teams/member-history.js";
import { TARGETED_BATCH_COLLECTIONS, normalizeMeterNo } from "./helpers.js";

export const RULE = "TB-R059";
export const RULES_VERSION = "1.3.62";
export const METER_IN_ANOTHER_TEAMS_BATCH = "METER_IN_ANOTHER_TEAMS_BATCH";
// Rules TB-R059 (1.3.62): the work is refused because iREPS could not check, not because the meter belongs
// to somebody else. Its own code, so the phone can tell the two refusals apart.
export const BATCH_CHECK_UNAVAILABLE = "BATCH_CHECK_UNAVAILABLE";
export const UNREADABLE_MESSAGE = "iREPS could not check which batch this meter is in. Nothing was saved. Please try again.";
export const GEOFENCES = "geo_fences";

// Why the work was allowed. These four, and the three the rule names below them, are the whole list: a
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
});
// What could not be read, kept on the refusal so the office can see which read failed.
export const UNREADABLE = Object.freeze({
  MEMBERSHIP: "BATCH_MEMBERSHIP_UNREADABLE",
  BATCH: "BATCH_NOT_READABLE",
  FACTS: "BATCH_FACTS_UNREADABLE",
});

const text = value => String(value ?? "").trim();
const upper = value => text(value).toUpperCase();
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
export function refusalMessage({ tbId, geofenceName, targetType, targetName, allocatedAt }) {
  const fence = text(geofenceName) ? `geofence ${text(geofenceName)}` : "no geofence";
  const isSp = upper(targetType) === "SP";
  const who = text(targetName) || (isSp ? "another service provider" : "another team");
  const when = allocationDateWords(allocatedAt);
  return `This meter is in batch ${text(tbId)}, ${fence}, allocated to ${who}${when ? ` on ${when}` : ""}. Only that ${isSp ? "service provider" : "team"} can work on it.`;
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

// The decision. Pure: the caller hands it the facts, including the geofence name.
export function decideBatchWork({ sales, parent, row, allocatedTeam = null, geofenceName = "", finderUid = "", finderTeamId = "", finderSpId = "", meterNo = "", tbId = "" } = {}) {
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
    return allow(ALLOWED.NOT_ALLOCATED, { tbId: batchId, targetType: allocation.type || null, targetId: allocation.id || null });
  }
  // Owner decision 2026-09-19: once the batch's work on the meter is done its row is Completed, and later
  // work (a reading, an inspection, a disconnection) is ordinary work that anyone may do.
  if (rowExecutionStatus(row) === "COMPLETED") return allow(ALLOWED.ROW_COMPLETED, { tbId: batchId, rowId: text(row?.id) || null });
  // Rules TB-R059: the team the worker belongs to now, from their profile and the team list. Either the
  // membership period that is still open (TM-R001) or the team's own member list places the worker in it.
  if (allocation.type === "TEAM" && sameId(finderTeamId, allocation.id)) return allow(ALLOWED.OWN_TEAM, { tbId: batchId, targetId: allocation.id, matchedBy: "TEAM_HISTORY" });
  if (allocation.type === "TEAM" && text(finderUid) && teamMemberIds(allocatedTeam).has(text(finderUid))) return allow(ALLOWED.OWN_TEAM, { tbId: batchId, targetId: allocation.id, matchedBy: "TEAM_MEMBER_LIST" });
  if (allocation.type === "SP" && sameId(finderSpId, allocation.id)) return allow(ALLOWED.OWN_SP, { tbId: batchId, targetId: allocation.id });
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

// Everything the decision needs: the Sales record, the batch, the batch's row for this meter, the geofence
// name, and the worker's service provider and current team (Teams rules TM-R001: the open membership period,
// read by userUid alone so no new index is needed, then the open period is taken as teamOnDate does).
export async function readBatchWorkFacts({ db, read = defaultRead, meterNo, uid }) {
  const id = normalizeMeterNo(meterNo);
  const facts = { meterNo: id, finderUid: text(uid), sales: null, parent: null, row: null, allocatedTeam: null, geofenceName: "", finderTeamId: "", finderSpId: "", tbId: "" };
  if (!id) return facts;
  const salesSnapshot = await read(db.collection(TARGETED_BATCH_COLLECTIONS.sales).doc(id));
  facts.sales = salesSnapshot?.exists ? salesSnapshot.data() || {} : null;
  if (!facts.sales) return facts;
  const membership = resolveSalesTargetedBatchMembership(facts.sales);
  if (membership.state !== "MEMBER" || !text(membership.tbId)) return facts;
  facts.tbId = text(membership.tbId);
  const [parentSnapshot, rowSnapshot, profileSnapshot, periodsSnapshot] = await Promise.all([
    read(db.collection(TARGETED_BATCH_COLLECTIONS.uploads).doc(facts.tbId)),
    read(db.collection(TARGETED_BATCH_COLLECTIONS.rows).where("tbId", "==", facts.tbId).where("salesAllMeterId", "==", id).limit(1)),
    text(uid) ? read(db.collection(TARGETED_BATCH_COLLECTIONS.users).doc(text(uid))) : Promise.resolve(null),
    text(uid) ? read(db.collection(TEAM_MEMBER_HISTORY).where("userUid", "==", text(uid))) : Promise.resolve(null),
  ]);
  facts.parent = parentSnapshot?.exists ? parentSnapshot.data() || {} : null;
  const rowDoc = rowSnapshot?.docs?.[0];
  facts.row = rowDoc ? { id: rowDoc.id, ...(rowDoc.data() || {}) } : null;
  const profile = profileSnapshot?.exists ? profileSnapshot.data() || {} : {};
  facts.finderSpId = profileServiceProviderId(profile);
  facts.finderRole = profileRole(profile);
  const periods = (periodsSnapshot?.docs || []).map(doc => ({ id: doc.id, ...(doc.data() || {}) }));
  facts.finderTeamId = text(teamOnDate(periods, text(uid), null)?.teamId);
  const allocation = batchAllocation(facts.parent || {});
  const fenceId = text(facts.parent?.geofenceId);
  const [fenceSnapshot, teamSnapshot] = await Promise.all([
    fenceId ? read(db.collection(GEOFENCES).doc(fenceId)) : Promise.resolve(null),
    allocation.type === "TEAM" && allocation.id ? read(db.collection("teams").doc(allocation.id)) : Promise.resolve(null),
  ]);
  facts.geofenceName = fenceSnapshot?.exists ? text(fenceSnapshot.data()?.name) : "";
  facts.allocatedTeam = teamSnapshot?.exists ? teamSnapshot.data() || {} : null;
  return facts;
}

// What a callable calls: read the facts, decide, log. A read that fails refuses the work (1.3.62).
export async function checkBatchWork({ db, read = defaultRead, meterNo, uid, log = null }) {
  const insideTransaction = read !== defaultRead;
  let facts;
  try {
    facts = await readBatchWorkFacts({ db, read, meterNo, uid });
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
  else if (!decision.allowed) log?.warn?.(`${RULE}: work refused, the meter is in another team's batch`, { uid: text(uid) || null, ...decision.details });
  return decision;
}
