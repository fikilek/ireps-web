// Targeted Batch rules TB-R063 (1.3.66): a different meter at the ERF completes the Sales meter.
//
// A Sales meter is expected at an ERF. When a meter with a DIFFERENT number is captured at that ERF, the
// meter on the Sales list is not there any more — it has been replaced. Leaving it Not Started sends a team
// back to an address where there is nothing to find, and lets it be batched again for ever. So it is
// completed (owner, 2026-09-20: "there's a meter there that actually has replaced it. You need to say it's
// completed"). The owner's case: meter 04298620077 was captured at ERF 3496 while the Sales meter expected
// there, 04297704464, stayed Not Started.
//
// What the server does, on every capture that records a meter, after the work is committed:
//  1. finds the Sales meters expected at that ERF — a Sales record whose own ERF is that ERF, and any
//     tb_rows sitting on it — and passes over any whose number is the one just captured;
//  2. writes on each of them what was found (`differentMeterFound`, one bounded map, the first find wins);
//  3. the work status then reads Completed everywhere (classifySalesWorkStatus, sales-batch-policy.js)
//     WITHOUT making the Sales meter VISIBLE and without touching meter_master, because that number
//     genuinely is not there;
//  4. the batch row closes as Completed, marked "a different meter was found here", with the number found
//     beside the number expected (the O: / F: the Batch Report shows), reusing the closing shapes of
//     TB-R056 (rowFollowsSales.js) and recounting the parent as section 14 does.
//
// Credit follows the finder. When the batch's own team or service provider found it, the find is linked to
// the batch as a batch completion is (`derived.targetedBatch`). When an outsider found it through the
// illegal-connection gate (TB-R062), the row still closes but the find is NOT linked to the batch, so the
// Allocation Matrix counts it as that worker's own transaction, not the batch team's completed work.
//
// A Sales meter with no batch is treated the same way, because the check is on the ERF, not on the batch.
//
// Everything is one transaction per Sales meter, reads before writes, with deterministic history IDs, so a
// repeat writes nothing (as TB-R056 does). The work itself is already committed when this runs, so a
// failure here is never allowed to fail the worker's submission: it is logged for the office instead.
import {
  classifySalesWorkStatus, exactSalesTbRef, inspectDifferentMeterFound, inspectSalesTbRefsIntegrity,
  inspectSavedErfDecision, nonblank, resolveSalesTargetedBatchMembership, singlePipelineErf,
} from "../salesAllMeters/sales-batch-policy.js";
import { buildSalesAllMetersOperationalMetadataPatch } from "../salesAllMeters/helpers.js";
import { TARGETED_BATCH_COLLECTIONS, normalizeMeterNo } from "./helpers.js";
import { batchAllocation, explicitlyUnallocated, profileName, profileRole, profileServiceProviderId, readWorkErfId, workerInside } from "./batch-work-guard.js";
import { teamOnDate } from "../teams/field-work-summary.js";
import { TEAM_MEMBER_HISTORY } from "../teams/member-history.js";
import {
  closedRowFields, closedTbRef, executionFallback, millis, parentAfter, parentPatch,
  parentState, plainRow, rowState, rowStatus, statusOf, storedCounts, trnMark,
} from "./rowFollowsSales.js";

export const RULE = "TB-R063";
export const RULES_VERSION = "1.3.66";
// The one new field on the Sales record. Bounded: one map with exactly the keys the Sales schema names, and
// the first find wins, so a second capture at the same ERF never grows it.
export const FIELD = "differentMeterFound";
// What the row is marked with. `tb_rows.execution.outcome` is a free string; these are its TB-R063 words.
export const ROW_OUTCOME = "DIFFERENT_METER_FOUND_AT_ERF";
export const OUTCOME_LABEL = "A different meter was found here";
export const ROW_CLOSED_EVENT = "TARGETED_BATCH_ROW_CLOSED";
export const DECISIONS = Object.freeze({ NONE: "NONE", RECORD: "RECORD", LOG: "LOG" });
export const ROW_ACTIONS = Object.freeze({ CLOSE: "CLOSE", HOLD: "HOLD", NO_BATCH: "NO_BATCH", ALREADY_COMPLETED: "ALREADY_COMPLETED" });
// An ERF holds a handful of Sales meters and batch rows. A page that fills up means iREPS has not seen the
// whole ERF; the rule then settles what it read and says so, because the work itself is already written.
export const ERF_SCAN_LIMIT = 100;

const text = value => String(value ?? "").trim();
const upper = value => text(value).toUpperCase();
const absent = value => value === undefined || value === null;
const withId = doc => ({ id: doc.id, ...(doc.data() || {}) });
const nullable = value => text(value) || null;

// ---------------------------------------------------------------- the Sales meters expected at an ERF
// The ERF a Sales meter is batched on, exactly as the resolver and the GPS Sales map choose it
// (sales-map-fence.js salesMapFenceErfId): its saved ERF decision, else its one pipeline ERF.
export function salesErfId(sales = {}) {
  const saved = inspectSavedErfDecision(sales);
  if (saved.established) return saved.erfId;
  const pipeline = singlePipelineErf(sales);
  return pipeline.ok ? pipeline.erfId : null;
}

// The ERF number Sales records carry for a GPS meter (`erfNumbers`), and the LM the ERF belongs to.
export const erfNumberOf = erf => text(erf?.sg?.erfNo);
export const erfLmPcode = erf => text(erf?.admin?.localMunicipality?.pcode);

// Every Sales meter expected at this ERF, found the two ways the rule names:
//  - a Sales record whose own ERF is that ERF: `erfId` when a saved decision established it, and — for GPS
//    Sales, which list their pipeline ERF numbers — `erfNumbers`, matched back on the ERF ID afterwards,
//    because ERF numbers repeat across towns;
//  - a batch row sitting on that ERF (`refs.erfId`), through its `salesAllMeterId`.
// Reads only, outside any transaction: each meter is then settled in its own transaction.
export async function findSalesMetersAtErf({ db, erfId, log = null }) {
  const id = text(erfId);
  if (!id) return { salesIds: [], truncated: false };
  const ids = new Set();
  let truncated = false;
  const collect = async (query) => {
    const snapshot = await query.limit(ERF_SCAN_LIMIT).get();
    if (snapshot.size >= ERF_SCAN_LIMIT) truncated = true;
    return snapshot.docs;
  };

  const erfSnapshot = await db.collection(TARGETED_BATCH_COLLECTIONS.erfs).doc(id).get();
  const erf = erfSnapshot.exists ? erfSnapshot.data() || {} : null;

  for (const doc of await collect(db.collection(TARGETED_BATCH_COLLECTIONS.sales).where("erfId", "==", id))) ids.add(doc.id);

  // GPS Sales name their ERF by number. The pair (lmPcode, erfNumbers) is an index this repo already has.
  const number = erfNumberOf(erf), lmPcode = erfLmPcode(erf);
  if (number && lmPcode) {
    const byNumber = await collect(db.collection(TARGETED_BATCH_COLLECTIONS.sales)
      .where("lmPcode", "==", lmPcode).where("erfNumbers", "array-contains", number));
    for (const doc of byNumber) if (salesErfId({ ...doc.data(), id: doc.id }) === id) ids.add(doc.id);
  }

  for (const doc of await collect(db.collection(TARGETED_BATCH_COLLECTIONS.rows).where("refs.erfId", "==", id))) {
    const salesId = normalizeMeterNo(doc.data()?.salesAllMeterId);
    if (salesId) ids.add(salesId);
  }

  if (truncated) log?.warn?.(`${RULE}: an ERF held more meters than one read returns, so only the first ${ERF_SCAN_LIMIT} were settled`, { rule: RULE, code: "TB_R063_ERF_SCAN_TRUNCATED", erfId: id });
  return { salesIds: [...ids].sort(), truncated };
}

// ---------------------------------------------------------------- who found it
// The worker who captured the meter, read once for the whole capture: their profile (name, role, service
// provider) and the team they belonged to at the find time (Teams rules TM-R001). Read by userUid alone,
// so no new index is needed. Returns null when the worker cannot be established.
export async function readFinder({ db, uid, atMs = null }) {
  const id = text(uid);
  if (!id) return null;
  const [profileSnapshot, periodsSnapshot] = await Promise.all([
    db.collection(TARGETED_BATCH_COLLECTIONS.users).doc(id).get(),
    db.collection(TEAM_MEMBER_HISTORY).where("userUid", "==", id).get(),
  ]);
  const profile = profileSnapshot.exists ? profileSnapshot.data() || {} : {};
  const period = teamOnDate(periodsSnapshot.docs.map(withId), id, atMs);
  const spId = profileServiceProviderId(profile);
  return {
    uid: id,
    user: profileName(profile) || text(period?.userName),
    role: profileRole(profile),
    teamId: nullable(period?.teamId),
    teamName: nullable(period?.teamName ?? period?.teamId),
    serviceProviderId: nullable(spId),
    serviceProviderName: nullable(profile?.profile?.employment?.serviceProvider?.name || profile?.employment?.serviceProvider?.name || profile?.serviceProvider?.name),
  };
}

// ---------------------------------------------------------------- the record written on the Sales meter
// Exactly the keys the Sales schema names, in one bounded map (sales-batch-policy.js
// DIFFERENT_METER_FOUND_KEYS decides what counts as a valid record).
export function buildDifferentMeterFoundRecord({ find, finder, tbId = null, rowId = null, creditedToBatch = false, foundAt }) {
  return {
    version: 1,
    meterNo: normalizeMeterNo(find.meterNo),
    erfId: text(find.erfId),
    trnId: text(find.trnId),
    trnType: text(find.trnType),
    astId: nullable(find.astId),
    foundAt,
    finder: {
      uid: text(finder.uid), user: text(finder.user), role: text(finder.role),
      teamId: nullable(finder.teamId), teamName: nullable(finder.teamName),
      serviceProviderId: nullable(finder.serviceProviderId), serviceProviderName: nullable(finder.serviceProviderName),
    },
    tbId: nullable(tbId), rowId: nullable(rowId),
    creditedToBatch: Boolean(creditedToBatch),
    rule: RULE, rulesVersion: RULES_VERSION,
  };
}

// ---------------------------------------------------------------- the decision, for one Sales meter
// facts: { salesId, find { meterNo, erfId, trnId, trnType, astId, premiseId, findAtMs }, finder,
//          sales, parent, rows[] (every row of the batch, with id), allocatedTeam, trn, historyExists }
export function decideDifferentMeterAtErf(facts = {}) {
  const { salesId, find, finder } = facts;
  const out = (decision, code, extra = {}) => ({ decision, code, salesId, ...extra });
  const log = (code, extra = {}) => out(DECISIONS.LOG, code, extra);
  try {
    if (!find || !nonblank(find.erfId) || !nonblank(find.trnId) || !nonblank(find.trnType)) return log("FIND_INCOMPLETE");
    const found = normalizeMeterNo(find.meterNo);
    if (!found) return out(DECISIONS.NONE, "NO_METER_NUMBER");
    // The check is on the ERF: the Sales meter that is expected there, not the one just captured.
    if (found === normalizeMeterNo(salesId)) return out(DECISIONS.NONE, "SAME_METER");
    if (!finder || !nonblank(finder.uid) || !nonblank(finder.user) || !nonblank(finder.role)) return log("FINDER_UNKNOWN", { uid: finder?.uid ?? null });
    if (!Number.isFinite(find.findAtMs)) return log("FIND_TIME_UNKNOWN");
    const sales = facts.sales;
    if (!sales) return out(DECISIONS.NONE, "NO_SALES_RECORD");
    // A VISIBLE Sales meter IS completed (the owner's settled definition): there is nothing to settle.
    if (upper(sales?.master?.visibility) === "VISIBLE") return out(DECISIONS.NONE, "ALREADY_VISIBLE");
    const already = inspectDifferentMeterFound(sales);
    if (!already.valid) return log("RECORD_INVALID");
    // A repeat writes nothing: the first find wins, and it is its own idempotency key.
    if (already.found) return out(DECISIONS.NONE, "ALREADY_RECORDED", { recordedTrnId: already.record.trnId });

    const membership = resolveSalesTargetedBatchMembership(sales);
    if (membership.state === "UNRESOLVED") return log("MEMBERSHIP_UNRESOLVED", { detail: membership.reason });
    // A Sales meter with no batch is treated the same way: the record alone completes it.
    if (membership.state === "NONE") return out(DECISIONS.RECORD, "NO_BATCH", { rowAction: ROW_ACTIONS.NO_BATCH, creditedToBatch: false });

    const tbId = membership.tbId;
    const base = { tbId, creditedToBatch: false };
    const own = (facts.rows || []).filter(row => normalizeMeterNo(row.salesAllMeterId) === normalizeMeterNo(salesId));
    if (own.length !== 1) return log(own.length ? "ROW_DUPLICATE" : "ROW_MISSING", { ...base, rowIds: own.map(row => row.id) });
    const row = own[0];
    base.rowId = row.id;
    base.rowNo = row.rowNo ?? null;

    // Credit follows the finder: the batch's own team or service provider, tested exactly as the guard
    // tests it (TB-R059/TB-R062), and only while somebody has actually been given the batch's work.
    const allocation = batchAllocation(facts.parent || {});
    const allocated = Boolean(facts.parent) && !explicitlyUnallocated(allocation) && upper(allocation.status) === "ALLOCATED";
    const credited = allocated && Boolean(workerInside({
      allocation, allocatedTeam: facts.allocatedTeam,
      finderUid: finder.uid, finderTeamId: finder.teamId, finderSpId: finder.serviceProviderId,
    }));
    base.creditedToBatch = credited;
    base.allocation = { type: allocation.type || null, id: allocation.id || null, name: allocation.name || null };

    const hold = code => out(DECISIONS.RECORD, code, { ...base, rowAction: ROW_ACTIONS.HOLD, holdReason: code });
    // The row's own work is already done: the row needs no change, but the Sales meter still reads Completed.
    if (rowStatus(row) === "COMPLETED") return out(DECISIONS.RECORD, "ROW_ALREADY_COMPLETED", { ...base, rowAction: ROW_ACTIONS.ALREADY_COMPLETED });
    if (!["NOT_STARTED", "IN_PROGRESS"].includes(rowStatus(row))) return hold("ROW_STATUS_UNKNOWN");
    // A repeat of the rule finds its own history and closes nothing again.
    if (facts.historyExists) return hold("HISTORY_EXISTS");
    if (!facts.parent) return hold("PARENT_MISSING");
    // A batch nobody has been given the work of holds no work orders to close.
    if (!allocated) return hold("BATCH_NOT_ALLOCATED");
    if (row.tbId !== tbId || row.idConflict || (facts.rows || []).some(other => other.tbId !== tbId)) return hold("ROW_IDENTITY");

    const exact = exactSalesTbRef(sales, tbId);
    if (!exact.ok) return hold("TBREF_INVALID");
    const fw = exact.reference.fieldWork ?? null;
    if (fw?.status === "COMPLETED") return hold("TBREF_ALREADY_COMPLETED");
    if (nonblank(exact.reference.rowId) && exact.reference.rowId !== row.id) return hold("TBREF_ROW_DIFFERS");
    try { buildSalesAllMetersOperationalMetadataPatch({ existing: sales, operationTimestamp: { toMillis: () => 0 }, actorUid: finder.uid, actorUser: finder.user }); } catch { return hold("SALES_METADATA_INVALID"); }

    // Anything a batch completion would refuse (premiseLink.js assertParentReady / assertRowReady).
    if (facts.parent.status === "COMPLETED" || facts.parent.execution?.status === "COMPLETED") return hold("PARENT_ALREADY_COMPLETED");
    if (upper(facts.parent.creation?.state) !== "READY") return hold("PARENT_NOT_READY");
    if (facts.parent.acceptance?.status !== "ACCEPTED") return hold("PARENT_NOT_ACCEPTED");
    const rowDecision = upper(row.decision?.status || "");
    if (rowDecision !== "ACCEPT" || row.allocation?.allocatable === false || upper(row.allocation?.status) !== "ALLOCATED") return hold("ROW_NOT_READY");

    // The evidence the closing shapes need: the meter's own field record and the premise it sits on. A
    // premise the row already had is kept (as TB-R056 keeps it); otherwise the find's own premise.
    const astId = text(find.astId) || text(find.trnId);
    const premiseId = text(row.refs?.premiseId) || text(fw?.premiseId) || text(find.premiseId);
    if (!astId || !premiseId) return hold("FIND_EVIDENCE_MISSING");

    const rowStartedAt = row.execution?.startedAt;
    const rowStartMs = millis(rowStartedAt);
    if (!absent(rowStartedAt) && rowStartMs === null) return hold("ROW_START_UNKNOWN");
    // The row completes at the find time; a row started after the find completes at its start, so the
    // batch's timeline stays in order. The history keeps the real find time.
    const completedAtMs = rowStartMs !== null && rowStartMs > find.findAtMs ? rowStartMs : find.findAtMs;

    const before = parentState(facts.parent);
    const states = (facts.rows || []).map(rowState);
    const closed = states.map(state => (state.id === row.id
      ? { ...state, execution: { status: "COMPLETED", startedAt: state.execution.startedAt ?? find.findAtMs, completedAt: completedAtMs } }
      : state));
    const after = parentAfter(before, closed, executionFallback(closed));
    if (after.action !== "UPDATE") return hold(`PARENT_${after.reason || after.action}`);

    // The numbers side by side, the O: / F: the Batch Report shows. meterMatch is always false here: that
    // is the whole point of this rule.
    const targetedMeterNo = text(row.meter?.numberNormalized) || text(row.meter?.numberRaw) || text(salesId);
    return out(DECISIONS.RECORD, "ROW_CLOSED", {
      ...base, rowAction: ROW_ACTIONS.CLOSE, exactIndex: exact.index,
      // The closing shapes of TB-R056 (closedRowFields / closedTbRef) read these off the plan.
      astId, trnId: text(find.trnId), premiseId, premiseKept: Boolean(text(row.refs?.premiseId) || text(fw?.premiseId)),
      findAtMs: find.findAtMs, completedAtMs, foundBeforeRowStart: completedAtMs !== find.findAtMs,
      targetedMeterNo, discoveredMeterNo: normalizeMeterNo(find.meterNo), meterMatch: false,
      rowOutcome: ROW_OUTCOME, outcomeLabel: OUTCOME_LABEL, after,
      salesMeterStatus: classifySalesWorkStatus(sales),
    });
  } catch (error) {
    return log("POLICY_ERROR", { detail: error.message });
  }
}

// ---------------------------------------------------------------- what the decision writes
// [{ op: "update" | "create", path, data }], in order, built in full before the first write.
// options: ts (milliseconds -> Timestamp), now (a Timestamp: tbRefs are arrays, which cannot hold a server
// timestamp), serverTime (the server-timestamp sentinel for every other time).
export function buildDifferentMeterAtErfWrites(plan, facts, { ts, now, serverTime }) {
  if (plan.decision !== DECISIONS.RECORD) return [];
  const { sales, find, finder } = facts;
  const at = serverTime;
  const salesPath = `${TARGETED_BATCH_COLLECTIONS.sales}/${plan.salesId}`;
  const salesMeta = buildSalesAllMetersOperationalMetadataPatch({ existing: sales, operationTimestamp: now, actorUid: finder.uid, actorUser: finder.user });
  if (salesMeta["metadata.updatedAt"]) salesMeta["metadata.updatedAt"] = at;
  const record = buildDifferentMeterFoundRecord({
    find, finder, tbId: plan.tbId ?? null, rowId: plan.rowId ?? null,
    creditedToBatch: plan.creditedToBatch === true, foundAt: ts(find.findAtMs),
  });

  if (plan.rowAction !== ROW_ACTIONS.CLOSE) {
    return [{ op: "update", path: salesPath, data: { [FIELD]: record, ...salesMeta } }];
  }

  const row = facts.rows.find(entry => entry.id === plan.rowId);
  const parent = facts.parent;
  const fields = closedRowFields(row, plan, ts);
  const exact = exactSalesTbRef(sales, plan.tbId);
  const tbRefsAfter = sales.tbRefs.map((ref, index) => (index === plan.exactIndex ? closedTbRef(ref, row, plan, ts, now) : ref));
  const integrity = inspectSalesTbRefsIntegrity(tbRefsAfter);
  if (!exact.ok || !integrity.valid) throw new Error(`The closed tbRefs of ${plan.salesId} would be invalid: ${integrity.issues.join(", ")}`);
  const patch = parentPatch(parent, plan.after, finder, at, ts);
  const statusAfter = plan.after.branch === "UNCHANGED"
    ? statusOf(parent.status, parent.execution)
    : statusOf(patch.status, { status: patch["execution.status"], startedAt: patch["execution.startedAt"], completedAt: patch["execution.completedAt"] });
  const actor = { uid: finder.uid, name: finder.user, role: finder.role };
  const hMeta = { createdAt: at, createdByUid: finder.uid, createdByUser: finder.user, updatedAt: at, updatedByUid: finder.uid, updatedByUser: finder.user };
  const finderOrg = finder.teamName || (finder.serviceProviderName ? `service provider ${finder.serviceProviderName}` : finder.serviceProviderId ? "their service provider" : "no team");
  const day = new Date(find.findAtMs).toISOString().slice(0, 10);

  const writes = [
    { op: "update", path: `${TARGETED_BATCH_COLLECTIONS.rows}/${plan.rowId}`, data: {
      "execution.status": "COMPLETED", "execution.startedAt": fields.execution.startedAt,
      "execution.completedAt": fields.execution.completedAt, "execution.outcome": fields.execution.outcome,
      // TB-R064 (1.3.67): the number found, on the row itself.
      "execution.foundMeterNo": fields.execution.foundMeterNo,
      "refs.premiseId": fields.refs.premiseId, "refs.meterId": fields.refs.meterId, "refs.trnId": fields.refs.trnId,
      "metadata.updatedAt": at, "metadata.updatedByUid": finder.uid, "metadata.updatedByUser": finder.user } },
    { op: "update", path: salesPath, data: { [FIELD]: record, tbRefs: tbRefsAfter, ...salesMeta } },
  ];

  // Credit follows the finder. The batch's own team or service provider: the find is linked to the batch as
  // a batch completion is, so it counts once in the Allocation Matrix under Completed (batches) (TB-R045).
  // An outsider who came through the illegal-connection gate (TB-R062): the row still closes, but nothing
  // is linked, so the find stays that worker's own transaction and the batch's team is not credited.
  if (plan.creditedToBatch === true && !facts.trnAlreadyLinked) {
    writes.push({ op: "update", path: `trns/${find.trnId}`, data: { "derived.targetedBatch": trnMark({ ...plan, salesId: plan.salesId, premiseId: plan.premiseId, astId: plan.astId, trnId: find.trnId }, plan.after.status === "COMPLETED") } });
  }
  writes.push({ op: "update", path: `${TARGETED_BATCH_COLLECTIONS.uploads}/${plan.tbId}`, data: patch });
  writes.push({ op: "create", path: `${TARGETED_BATCH_COLLECTIONS.uploads}/${plan.tbId}/history/ROW_CLOSED__${plan.rowId}`, data: {
    event: ROW_CLOSED_EVENT, rule: RULE, rulesVersion: RULES_VERSION, runId: `${RULE}:${find.trnId}`,
    tbId: plan.tbId, rowId: plan.rowId, rowNo: plan.rowNo ?? null, salesId: plan.salesId,
    countsBefore: storedCounts(parent), countsAfter: plan.after.counts,
    statusBefore: statusOf(parent.status, parent.execution), statusAfter,
    finder: { uid: finder.uid, user: finder.user, role: finder.role, teamId: finder.teamId, teamName: finder.teamName, spId: finder.serviceProviderId },
    astId: plan.astId, trnId: find.trnId, trnType: find.trnType, findAt: ts(find.findAtMs), erfId: text(find.erfId),
    actor, metadata: hMeta, rowBefore: plainRow(row), rowAfter: fields,
    targetedMeterNo: plan.targetedMeterNo, discoveredMeterNo: plan.discoveredMeterNo, meterMatch: false,
    creditedToBatch: plan.creditedToBatch === true, premiseKept: plan.premiseKept,
    foundBeforeRowStart: plan.foundBeforeRowStart ?? false, warnings: plan.after.warnings || [],
    note: `A different meter (${plan.discoveredMeterNo}) was found at ERF ${text(find.erfId)}, where Sales meter ${plan.targetedMeterNo} was expected, by ${finderOrg} (${finder.user}) on ${day}; the Sales meter has been replaced, so the row is closed as Completed and the meter reads Completed without becoming Visible${plan.creditedToBatch === true ? "" : "; the finder is not in the batch's team, so the find is not credited to the batch"} (rules ${RULES_VERSION}, ${RULE})` } });
  return writes;
}

// ---------------------------------------------------------------- reading the facts, one Sales meter
export async function gatherDifferentMeterFacts({ db, get, salesId, find, finder }) {
  const facts = { salesId, find, finder, sales: null, parent: null, rows: [], allocatedTeam: null, historyExists: false, trnAlreadyLinked: false };
  const salesSnapshot = await get(db.doc(`${TARGETED_BATCH_COLLECTIONS.sales}/${salesId}`));
  facts.sales = salesSnapshot.exists ? salesSnapshot.data() : null;
  if (!facts.sales || upper(facts.sales?.master?.visibility) === "VISIBLE") return facts;
  if (inspectDifferentMeterFound(facts.sales).found) return facts;
  const membership = resolveSalesTargetedBatchMembership(facts.sales);
  if (membership.state !== "MEMBER" || !nonblank(membership.tbId)) return facts;
  const tbId = membership.tbId;
  const parentSnapshot = await get(db.doc(`${TARGETED_BATCH_COLLECTIONS.uploads}/${tbId}`));
  facts.parent = parentSnapshot.exists ? parentSnapshot.data() : null;
  facts.rows = (await get(db.collection(TARGETED_BATCH_COLLECTIONS.rows).where("tbId", "==", tbId))).docs
    .map(doc => { const data = doc.data() || {}; return { ...data, id: doc.id, ...(data.id !== undefined && data.id !== doc.id ? { idConflict: true } : {}) }; });
  const allocation = batchAllocation(facts.parent || {});
  if (allocation.type === "TEAM" && allocation.id) {
    const teamSnapshot = await get(db.doc(`teams/${allocation.id}`));
    facts.allocatedTeam = teamSnapshot.exists ? teamSnapshot.data() : null;
  }
  const own = facts.rows.filter(row => normalizeMeterNo(row.salesAllMeterId) === normalizeMeterNo(salesId));
  if (own.length === 1) {
    facts.historyExists = (await get(db.doc(`${TARGETED_BATCH_COLLECTIONS.uploads}/${tbId}/history/ROW_CLOSED__${own[0].id}`))).exists;
    // The find's own TRN. A TRN already linked to a batch keeps that link: one find is credited once.
    const trnSnapshot = await get(db.doc(`trns/${text(find.trnId)}`));
    facts.trnAlreadyLinked = trnSnapshot.exists && Boolean(trnSnapshot.data()?.derived?.targetedBatch);
  }
  return facts;
}

// ---------------------------------------------------------------- one transaction, one Sales meter
export async function settleDifferentMeterForSales({ db, salesId, find, finder, Timestamp, FieldValue }) {
  return db.runTransaction(async tx => {
    const facts = await gatherDifferentMeterFacts({ db, get: ref => tx.get(ref), salesId, find, finder });
    const plan = decideDifferentMeterAtErf(facts);
    if (plan.decision !== DECISIONS.RECORD) return plan;
    const writes = buildDifferentMeterAtErfWrites(plan, facts, {
      ts: ms => Timestamp.fromMillis(ms), now: Timestamp.now(), serverTime: FieldValue.serverTimestamp(),
    });
    for (const write of writes) {
      const ref = db.doc(write.path);
      if (write.op === "create") tx.create(ref, write.data);
      else if (write.op === "update") tx.update(ref, write.data);
      else throw new Error(`Unknown write ${write.op}`);
    }
    return { ...plan, writes: writes.map(write => `${write.op} ${write.path}`) };
  });
}

// ---------------------------------------------------------------- what a callable calls
// Runs after the work is committed. The work is already written, so nothing here is ever allowed to fail
// the worker's submission: every failure is caught and logged for the office instead.
// TB-R063 (1.3.72, owner 2026-09-23): a capture made from a batch row belongs to THAT row and that Sales
// meter, and to nothing else. Before this, one meter captured at an ERF that carries many Sales meters — a
// complex, a block of flats, a business park — closed every other Sales meter there as "a different meter
// was found here": the owner captured one meter at ERF 689 and all thirteen rows of his batch closed. When
// the worker came from a batch row, the server knows the row, the Sales record and the number expected, so
// there is nothing to work out: only that Sales meter may be settled, and when the number matches the one
// the row was sent for, nothing is settled at all.
export async function recordDifferentMeterAtErf({
  db, Timestamp, FieldValue, meterNo, erfId = "", premiseId = "", trnId, trnType = "",
  astId = "", uid, foundAt = new Date().toISOString(), log = null, targetedBatchContext = null,
}) {
  const results = [];
  try {
    const meter = normalizeMeterNo(meterNo);
    if (!meter || !nonblank(text(trnId))) return results;
    // The ERF the work happened on, resolved exactly as the guard resolves it (TB-R062): the form's own
    // ERF first, and otherwise the premise it used, because a premise sits on an ERF.
    const erf = await readWorkErfId({ db, erfId, premiseId });
    if (!erf) return results;
    const findAtMs = millis(foundAt) ?? Date.parse(text(foundAt));
    const find = { meterNo: meter, erfId: erf, premiseId: text(premiseId), trnId: text(trnId), trnType: text(trnType), astId: text(astId), findAtMs: Number.isFinite(findAtMs) ? findAtMs : Date.now() };
    // The Sales meter the worker was sent for, when the capture came from a batch row.
    const rowSalesId = normalizeMeterNo(targetedBatchContext?.salesDocId || targetedBatchContext?.meterNo || "");

    const { salesIds } = rowSalesId
      ? { salesIds: [rowSalesId] }
      : await findSalesMetersAtErf({ db, erfId: erf, log });

    const expected = salesIds.filter(id => normalizeMeterNo(id) !== meter);
    if (!expected.length) return results;
    const finder = await readFinder({ db, uid, atMs: find.findAtMs });
    // One meter after another: every transaction may write the same batch.
    for (const salesId of expected) {
      try {
        const result = await settleDifferentMeterForSales({ db, salesId, find, finder, Timestamp, FieldValue });
        results.push(result);
        logDecision(result, find, log);
      } catch (error) {
        results.push({ decision: DECISIONS.LOG, code: "TRANSACTION_FAILED", salesId, detail: error?.message || String(error) });
        log?.error?.(`${RULE}: a different meter at the ERF could not be settled for a Sales meter, for the office`, { rule: RULE, code: "TB_R063_TRANSACTION_FAILED", salesId, erfId: erf, meterNo: meter, trnId: text(trnId), detail: error?.message || String(error) });
      }
    }
  } catch (error) {
    log?.error?.(`${RULE}: a different meter at the ERF could not be checked, for the office`, { rule: RULE, code: "TB_R063_CHECK_FAILED", erfId: text(erfId), meterNo: normalizeMeterNo(meterNo), trnId: text(trnId), detail: error?.message || String(error) });
  }
  return results;
}

function logDecision(result, find, log) {
  const summary = {
    rule: RULE, code: `TB_R063_${result.code}`, decision: result.decision, salesId: result.salesId,
    erfId: find.erfId, foundMeterNo: find.meterNo, trnId: find.trnId, trnType: find.trnType,
    tbId: result.tbId ?? null, rowId: result.rowId ?? null, rowAction: result.rowAction ?? null,
    creditedToBatch: result.creditedToBatch ?? null, detail: result.detail ?? null,
    parentAfter: result.after ? result.after.status : null, warnings: result.after?.warnings ?? [],
  };
  if (result.decision === DECISIONS.LOG) log?.warn?.(`${RULE}: a different meter at the ERF, nothing changed, for the office`, summary);
  else if (result.decision === DECISIONS.NONE) log?.info?.(`${RULE}: a different meter at the ERF, nothing to do`, summary);
  else log?.info?.(`${RULE}: a different meter was found at the ERF; the Sales meter reads Completed${result.rowAction === ROW_ACTIONS.CLOSE ? " and its batch row is closed" : ""}`, { ...summary, writes: result.writes });
}
