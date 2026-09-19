// Targeted Batch rules 1.3.52, TB-R056: a batch row follows its Sales meter.
// When a Sales meter of a batch becomes VISIBLE (found on site by any route), its batch row (tb_rows) follows:
//   - found by the batch's own TEAM or SP        -> the row closes as Completed (as TB-R053 section 1 closes a row);
//   - found by another TEAM/SP, or not allocated -> the row goes out of the batch (as TB-R053 removes a row);
//   - the finder cannot be established           -> nothing changes, the case is logged.
// The batch is recounted from its rows and its status follows section 14 (TB-R053 section 4); a batch left with no
// rows is deleted and its history kept. Sales schema 1.10.0 (TB1, TB2, TB6, TB8) and tb_rows schema give the shapes.
//
// Pure: no Firestore here. The transaction (rowFollowsSalesTrigger.js) reads the facts, this module decides and says
// exactly what to write; timestamps are compared as milliseconds and turned back into the caller's Timestamps.
// The close/remove writes are copied from the one-off LIVE tool functions/scripts/tb-old-batch-cleanup (planner.js,
// cleanup.mjs), which production code must not import, and from the production batch completion (premiseLink.js).
import { resolveSalesTargetedBatchMembership, exactSalesTbRef, inspectSalesTbRefsIntegrity, classifySalesWorkStatus, timestampMillis, nonblank } from "../salesAllMeters/sales-batch-policy.js";
import { buildSalesAllMetersOperationalMetadataPatch } from "../salesAllMeters/helpers.js";
import { teamOnDate, isBatchTrn } from "../teams/field-work-summary.js";

export const RULE = "TB-R056";
export const RULES_VERSION = "1.3.56";
export const NEW_SCHEMA = "0.3.0";
export const OUTCOME = "METER_DISCOVERED_OUTSIDE_BATCH";
// Rules 1.3.56: a Meter Installation by the batch's own team closes the row too (owner, 2026-09-19), with its own row outcome.
export const OUTCOME_BY_FIND = Object.freeze({ METER_DISCOVERY: OUTCOME, METER_INSTALLATION: "METER_INSTALLED_OUTSIDE_BATCH" });
const rowOutcome = plan => OUTCOME_BY_FIND[plan.findType] || OUTCOME;
export const DECISIONS = Object.freeze({ NONE: "NONE", CLOSE: "CLOSE", REMOVE: "REMOVE", LOG: "LOG" });
export const REMOVAL_REASONS = Object.freeze({ ANOTHER_TEAM: "FOUND_BY_ANOTHER_TEAM", UNALLOCATED: "FOUND_WHILE_UNALLOCATED" });
export const COUNT_KEYS = Object.freeze(["totalRows", "acceptedRows", "rejectedRows", "allocatableRows", "allocatedRows", "unallocatedRows", "executionStartedRows", "completedRows"]);
export const ROW_REMOVED_EVENT = "TARGETED_BATCH_ROW_REMOVED";
export const ROW_CLOSED_EVENT = "TARGETED_BATCH_ROW_CLOSED";
export const BATCH_DELETED_EVENT = "TARGETED_BATCH_DELETED";

const upper = value => String(value ?? "").trim().toUpperCase();
const text = value => String(value ?? "").trim();
const absent = value => value === undefined || value === null;
// AST metadata times are ISO strings; batch times are Firestore Timestamps.
export const millis = value => (typeof value === "string" ? (Number.isFinite(Date.parse(value)) ? Date.parse(value) : null) : timestampMillis(value));
export const rowStatus = row => row?.execution?.status || "NOT_STARTED";
// As premiseLink.js normalizeMeterNo: upper case, spaces removed.
export const normMeterNo = value => String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
// The history run ID a TB-R056 change carries (Sales schema TB6: cleanupRunId is "TB-R056:" and the find's TRN ID).
export const runIdOf = trnId => `${RULE}:${trnId}`;

// ---------------------------------------------------------------- when it runs
// The trigger acts only when master.visibility changes to VISIBLE. Its own Sales write is VISIBLE -> VISIBLE and does nothing.
export const becameVisible = (before, after) => after?.master?.visibility === "VISIBLE" && before?.master?.visibility !== "VISIBLE";

// ---------------------------------------------------------------- rows taken out (option A, owner decision 2026-09-19)
// A batch with a geofence (0.3.0) keeps its creation record; Allocate, Unallocate and Delete count its rows as created
// minus the rows TB-R053 or TB-R056 took out, read live from the batch's own history (never from a stored count).
// TB-R053 entries carry the clean-up run ID (CLEANUP2_...); TB-R056 entries carry rule TB-R056.
export const isRuleRowRemoval = entry => entry?.event === ROW_REMOVED_EVENT && (entry.rule === RULE || /^CLEANUP2_/.test(text(entry.runId)));
export function countRowsTakenOut(historyEntries = []) {
  return new Set(historyEntries.filter(isRuleRowRemoval).map(entry => text(entry.rowId) || text(entry.id))).size;
}
export const rowsTakenOutQuery = (db, tbId) => db.collection("tb_uploads").doc(tbId).collection("history").where("event", "==", ROW_REMOVED_EVENT);
// read: the caller's reader (a transaction's get, so the check and the rows are read together).
export async function readRowsTakenOut({ db, read, tbId }) {
  const snapshot = await read(rowsTakenOutQuery(db, tbId));
  return countRowsTakenOut(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
}

// ---------------------------------------------------------------- the batch (TB-R053 section 4, copied from the clean-up planner)
export function countRows(rows) {
  return {
    totalRows: rows.length,
    acceptedRows: rows.filter(r => r.decision?.status === "ACCEPT").length,
    rejectedRows: rows.filter(r => r.decision?.status === "REJECT").length,
    allocatableRows: rows.filter(r => r.allocation?.allocatable === true).length,
    allocatedRows: rows.filter(r => r.allocation?.status === "ALLOCATED").length,
    unallocatedRows: rows.filter(r => r.allocation?.allocatable === true && r.allocation?.status !== "ALLOCATED").length,
    executionStartedRows: rows.filter(r => (r.execution?.status || "NOT_STARTED") !== "NOT_STARTED").length,
    completedRows: rows.filter(r => r.execution?.status === "COMPLETED").length,
  };
}
// Section 14 completion target, as premiseLink.js getTargetedBatchCompletionTarget.
export const completionTarget = counts => [counts.allocatableRows, counts.acceptedRows, counts.allocatedRows, counts.totalRows].find(n => Number.isInteger(n) && n > 0) || 0;
// A row as the counts and the status rule see it.
export const rowState = row => ({ id: row.id, execution: { status: rowStatus(row), startedAt: millis(row.execution?.startedAt), completedAt: millis(row.execution?.completedAt) },
  decision: { status: row.decision?.status ?? null }, allocation: { status: row.allocation?.status ?? null, allocatable: row.allocation?.allocatable ?? null } });
export const parentState = parent => ({ status: parent?.status ?? null, acceptance: parent?.acceptance?.status ?? null,
  execution: { status: parent?.execution?.status ?? null, startedAt: millis(parent?.execution?.startedAt), completedAt: millis(parent?.execution?.completedAt) },
  counts: Object.fromEntries(COUNT_KEYS.map(k => [k, parent?.counts?.[k] ?? null])) });
// "Kept, else the earliest row start / the latest row completion", from the rows the change leaves.
export function executionFallback(states) {
  const starts = states.map(s => s.execution.startedAt).filter(n => n !== null);
  const ends = states.filter(s => s.execution.status === "COMPLETED").map(s => s.execution.completedAt).filter(n => n !== null);
  return { startedAt: starts.length ? Math.min(...starts) : null, completedAt: ends.length ? Math.max(...ends) : null };
}
export function parentAfter(before, states, fallback) {
  const counts = countRows(states);
  if (!states.length) return { action: "DELETE", branch: "DELETE", counts, status: null, execution: null, warnings: [] };
  const target = completionTarget(counts);
  const branch = target > 0 && counts.completedRows >= target ? "COMPLETED" : counts.executionStartedRows > 0 ? "IN_PROGRESS" : "UNCHANGED";
  // Never back from COMPLETED to IN_PROGRESS; never IN_PROGRESS or COMPLETED without acceptance.
  if (branch === "IN_PROGRESS" && (before.status === "COMPLETED" || before.execution.status === "COMPLETED")) return { action: "HOLD", reason: "WOULD_REOPEN_COMPLETED", branch, counts };
  if (branch !== "UNCHANGED" && before.acceptance !== "ACCEPTED") return { action: "HOLD", reason: "NOT_ACCEPTED", branch, counts };
  const execution = branch === "COMPLETED" ? { status: "COMPLETED", startedAt: before.execution.startedAt ?? fallback.startedAt ?? null, completedAt: before.execution.completedAt ?? fallback.completedAt ?? null }
    : branch === "IN_PROGRESS" ? { status: "IN_PROGRESS", startedAt: before.execution.startedAt ?? fallback.startedAt ?? null, completedAt: null } : { ...before.execution };
  // "Kept, or else set": a time neither the batch nor any row can give is not written as null next to the status.
  if (branch !== "UNCHANGED" && execution.startedAt === null) return { action: "HOLD", reason: "STARTED_TIME_UNKNOWN", branch, counts };
  if (branch === "COMPLETED" && execution.completedAt === null) return { action: "HOLD", reason: "COMPLETED_TIME_UNKNOWN", branch, counts };
  const status = branch === "UNCHANGED" ? before.status : branch;
  // The Allocation Matrix drops a COMPLETED batch whose completed rows are not all its rows.
  return { action: "UPDATE", branch, counts, status, execution, warnings: branch === "COMPLETED" && counts.completedRows !== counts.totalRows ? ["COMPLETED_WITH_ROWS_NOT_COMPLETED"] : [] };
}

// Rule point 2 has no exception for older batches: Allocate of every Non-GPS batch (allocationCallable.js) counts its rows
// as created minus the rows taken out, so a removal never locks a batch out of allocation.

// ---------------------------------------------------------------- who found the meter
// The worker who captured the meter's field record: the AST meter_master links, whose TRN has the same ID. Their team is
// the one they belonged to on the find date (TM-R001); their service provider comes from their profile.
export const profileSpId = profile => text(profile?.profile?.employment?.serviceProvider?.id || profile?.employment?.serviceProvider?.id || profile?.serviceProvider?.id) || null;
export const profileRole = profile => text(profile?.employment?.role || profile?.profile?.employment?.role || profile?.role) || null;
export const profileName = profile => text(profile?.profile?.displayName || profile?.displayName || profile?.name || profile?.profile?.personal?.fullName) || null;
// facts: meterMaster, ast, trn, finderProfile, memberHistory. Returns { ok, reason?, finder? }.
export function establishFinder(facts) {
  const astId = facts.meterMaster?.refs?.asts?.id;
  if (!nonblank(astId)) return { ok: false, reason: "NO_FIELD_RECORD" };
  const ast = facts.ast;
  if (!ast || ast.id !== astId) return { ok: false, reason: "AST_MISSING", astId };
  const trnId = nonblank(ast.trnId) ? ast.trnId : ast.id;
  if (trnId !== ast.id) return { ok: false, reason: "AST_TRN_ID_DIFFERS", astId, trnId };
  if (!facts.trn || facts.trn.id !== trnId) return { ok: false, reason: "TRN_MISSING", astId, trnId };
  const uid = text(ast.metadata?.createdByUid);
  if (!uid || uid === "SYSTEM" || uid === "NAv") return { ok: false, reason: "NO_CREATOR", astId, trnId };
  const findAtMs = millis(ast.metadata?.createdAt);
  if (findAtMs === null) return { ok: false, reason: "FIND_TIME_UNKNOWN", astId, trnId, uid };
  const period = teamOnDate(facts.memberHistory || [], uid, findAtMs);
  const profile = facts.finderProfile;
  const spId = profileSpId(profile);
  if (!period && !spId) return { ok: false, reason: "NO_TEAM_OR_SERVICE_PROVIDER", astId, trnId, uid, findAtMs };
  const user = text(ast.metadata?.createdByUser) || profileName(profile);
  const role = profileRole(profile);
  // The history names the finder (Sales schema TB6: actor uid, user and role are required).
  if (!user || !role) return { ok: false, reason: "FINDER_PROFILE_INCOMPLETE", astId, trnId, uid, findAtMs };
  return { ok: true, finder: { uid, user, role, teamId: period?.teamId ?? null, teamName: period ? period.teamName ?? period.teamId : null, spId }, astId, trnId, findAtMs };
}

// The batch's TEAM or SP (allocationCallable.js / premiseLink.js getTargetedBatchAllocation).
export const allocationTarget = parent => ({ type: upper(parent?.allocation?.targetType || parent?.allocation?.target?.type), id: text(parent?.allocation?.targetId || parent?.allocation?.target?.id), name: text(parent?.allocation?.targetName || parent?.allocation?.target?.name) });
export const isOwnFind = (target, finder) => (target.type === "TEAM" ? Boolean(finder.teamId) && finder.teamId === target.id : Boolean(finder.spId) && finder.spId === target.id);
// The batch a batch (sales-path) TRN names (field-work-summary.js isBatchTrn), else null.
export const trnBatchId = trn => text(trn?.targetedBatchContext?.tbId) || text(trn?.derived?.targetedBatch?.tbId) || text(trn?.accessData?.tbId) || null;

// ---------------------------------------------------------------- the decision
// facts: { salesId, sales, parent, rows[] (every row of the batch, with id), meterMaster, ast, trn, finderProfile, memberHistory[],
//          history { rowClosed, rowRemoved, salesRemoved, batchDeleted } (booleans), namedByOthers (Sales IDs other than this
//          one naming the batch; read only when this row is the batch's last; null when not read), pointing { trnIds, premiseIds } }
export function decideRowFollowsSales(facts) {
  const { salesId, sales } = facts;
  const out = (decision, code, extra = {}) => ({ decision, code, salesId, ...extra });
  const log = (code, extra) => out(DECISIONS.LOG, code, extra);
  try {
    if (!sales) return log("SALES_MISSING");
    if (sales.master?.visibility !== "VISIBLE") return out(DECISIONS.NONE, "NOT_VISIBLE");
    const membership = resolveSalesTargetedBatchMembership(sales);
    if (membership.state === "NONE") return out(DECISIONS.NONE, "NO_BATCH");
    if (membership.state !== "MEMBER") return log("MEMBERSHIP_UNRESOLVED", { detail: membership.reason });
    const tbId = membership.tbId;
    const parent = facts.parent;
    if (!parent) return log("PARENT_MISSING", { tbId });
    const rows = facts.rows || [];
    const own = rows.filter(r => r.salesAllMeterId === salesId);
    if (!own.length) return log("ROW_MISSING", { tbId });
    if (own.length > 1) return log("ROW_DUPLICATE", { tbId, rowIds: own.map(r => r.id) });
    const row = own[0];
    const base = { tbId, rowId: row.id, rowNo: row.rowNo ?? null, rowStatus: rowStatus(row), schemaVersion: parent.schemaVersion ?? null };
    if (row.tbId !== tbId || row.idConflict || rows.some(r => r.tbId !== tbId)) return log("ROW_IDENTITY", base);
    // A sales-path find completes the row in the discovery itself, before the meter turns Visible.
    if (base.rowStatus === "COMPLETED") return out(DECISIONS.NONE, "ROW_ALREADY_COMPLETED", base);
    if (!["NOT_STARTED", "IN_PROGRESS"].includes(base.rowStatus)) return log("ROW_STATUS_UNKNOWN", base);
    // A repeat of the trigger finds its own history and does nothing.
    const h = facts.history || {};
    const clash = ["rowClosed", "rowRemoved", "salesRemoved"].filter(k => h[k]);
    if (clash.length) return log("HISTORY_EXISTS", { ...base, history: clash });

    const who = establishFinder(facts);
    if (!who.ok) return log(who.reason === "FIND_TIME_UNKNOWN" ? "FIND_TIME_UNKNOWN" : "FINDER_UNKNOWN", { ...base, detail: who.reason, astId: who.astId ?? null, trnId: who.trnId ?? null, uid: who.uid ?? null });
    const { finder, astId, trnId, findAtMs } = who;
    const find = { ...base, finder, astId, trnId, findAtMs, runId: runIdOf(trnId), membershipSource: membership.source };
    const exact = exactSalesTbRef(sales, tbId);
    if (!exact.ok) return log("TBREF_INVALID", { ...find, detail: exact.code });
    try { buildSalesAllMetersOperationalMetadataPatch({ existing: sales, operationTimestamp: { toMillis: () => 0 }, actorUid: finder.uid, actorUser: finder.user }); } catch { return log("SALES_METADATA_INVALID", find); }

    const before = parentState(parent);
    const states = rows.map(rowState);
    const allocationStatus = parent.allocation?.status;
    // A batch that is not allocated sent no team, whoever found the meter. Only the unallocated state creation and unallocation
    // write (NOT_STARTED, or none) means that; ALLOCATING or ALLOCATION_FAILED may already have rows with a team.
    let reason = null;
    if (allocationStatus !== "ALLOCATED") {
      if (!(absent(allocationStatus) || allocationStatus === "" || allocationStatus === "NOT_STARTED")) return log("ALLOCATION_STATE_UNCLEAR", { ...find, allocationStatus });
      reason = REMOVAL_REASONS.UNALLOCATED;
    } else {
      const target = allocationTarget(parent);
      if (!["TEAM", "SP"].includes(target.type) || !target.id) return log("ALLOCATION_TARGET_UNKNOWN", { ...find, target });
      if (!isOwnFind(target, finder)) reason = REMOVAL_REASONS.ANOTHER_TEAM;
      find.target = target;
    }

    if (reason) {
      // 2. Another team or SP found it, or the batch is not allocated: the row goes out of the batch.
      // A find made through this same batch (a sales-path TRN of this batch, for example another meter found at a row's
      // premise) is credited to the batch, whatever team TM-R001 gives the worker: it never takes a row of the batch out.
      if (isBatchTrn(facts.trn) && trnBatchId(facts.trn) === tbId) return log("TRN_ALREADY_BATCH", { ...find, wouldBe: reason, trnContext: tbId });
      const left = states.filter(s => s.id !== row.id);
      const after = parentAfter(before, left, executionFallback(left));
      if (after.action === "HOLD") return log(`PARENT_${after.reason}`, { ...find, wouldBe: reason });
      if (after.action === "DELETE") {
        // A batch left with no rows is deleted, after checking that no other Sales record still names it (deleteCallable.js).
        if (absent(parent.metadata?.createdAt) || !Array.isArray(facts.namedByOthers)) return log("DELETE_UNVERIFIABLE", { ...find, wouldBe: reason });
        if (facts.namedByOthers.length) return log("NAMED_BY_OTHER_SALES", { ...find, wouldBe: reason, namedBy: facts.namedByOthers });
        if (h.batchDeleted) return log("HISTORY_EXISTS", { ...find, history: ["batchDeleted"] });
      }
      const tbRefsAfter = sales.tbRefs.filter((_, i) => i !== exact.index);
      if (!inspectSalesTbRefsIntegrity(tbRefsAfter).valid) return log("TBREFS_INVALID_AFTER", find);
      return out(DECISIONS.REMOVE, reason, { ...find, reason, exactIndex: exact.index, removedTbRef: exact.reference, after, salesMeterStatus: classifySalesWorkStatus(sales) });
    }

    // 1. The batch is allocated to the finder's TEAM or SP: the row closes as Completed, as TB-R053 section 1 closes a row,
    // whenever the meter was found and on any ERF; a premise the row already had is kept. Anything a batch completion would
    // refuse, or that does not fit, is logged instead.
    const trn = facts.trn;
    const held = (code, extra = {}) => log(code, { ...find, ...extra });
    // A Meter Discovery or a Meter Installation with access (rules 1.3.56); both link meter_master to their AST.
    const findType = trn.accessData?.trnType;
    if (!Object.hasOwn(OUTCOME_BY_FIND, findType || "") || trn.accessData?.access?.hasAccess !== "yes") return held("FIND_NOT_DISCOVERY", { trnType: findType ?? null, hasAccess: trn.accessData?.access?.hasAccess ?? null });
    if (isBatchTrn(trn)) return held("TRN_ALREADY_BATCH", { trnContext: trn.targetedBatchContext?.tbId ?? trn.derived?.targetedBatch?.tbId ?? trn.accessData?.tbId ?? trn.sourceModule ?? null });
    const fw = exact.reference.fieldWork ?? null;
    if (fw?.status === "COMPLETED") return held("TBREF_ALREADY_COMPLETED");
    if (nonblank(exact.reference.rowId) && exact.reference.rowId !== row.id) return held("TBREF_ROW_DIFFERS");
    const rowPremiseId = nonblank(row.refs?.premiseId) ? row.refs.premiseId : null;
    const refPremiseId = nonblank(fw?.premiseId) ? fw.premiseId : null;
    if (rowPremiseId && refPremiseId && rowPremiseId !== refPremiseId) return held("ROW_AND_TBREF_PREMISES_DIFFER", { rowPremiseId, refPremiseId });
    const findPremiseId = nonblank(trn.accessData?.premise?.id) ? trn.accessData.premise.id : null;
    // A premise the row already had is kept (owner, 2026-09-19); else the find's premise.
    const premiseId = rowPremiseId || refPremiseId || findPremiseId;
    if (!premiseId) return held("FIND_PREMISE_MISSING");
    const linkDiffers = (value, expected) => nonblank(value) && value !== expected;
    if (linkDiffers(row.refs?.meterId, astId) || linkDiffers(fw?.meterId, astId) || linkDiffers(row.refs?.trnId, trnId) || linkDiffers(fw?.trnId, trnId)) return held("FIND_LINKS_DIFFER");
    if (parent.status === "COMPLETED" || parent.execution?.status === "COMPLETED") return held("PARENT_ALREADY_COMPLETED");
    // Anything a batch completion would refuse (premiseLink.js assertParentReady / assertRowReady).
    if (upper(parent.creation?.state) !== "READY") return held("PARENT_NOT_READY", { creationState: parent.creation?.state ?? null });
    const parentExecution = parent.execution?.status ?? (parent.schemaVersion === NEW_SCHEMA ? null : "NOT_STARTED");
    if (!["NOT_STARTED", "IN_PROGRESS"].includes(parentExecution)) return held("PARENT_NOT_READY", { executionStatus: parent.execution?.status ?? null });
    if (parent.acceptance?.status !== "ACCEPTED") return held("PARENT_NOT_ACCEPTED", { acceptance: parent.acceptance?.status ?? null });
    if (row.schemaVersion === NEW_SCHEMA && absent(row.execution?.status)) return held("ROW_NOT_READY", { rowExecution: null });
    const rowDecision = upper(row.decision?.status || (row.schemaVersion === NEW_SCHEMA ? "UNAVAILABLE" : "ACCEPT"));
    if (rowDecision !== "ACCEPT" || row.allocation?.allocatable === false || upper(row.allocation?.status) !== "ALLOCATED") return held("ROW_NOT_READY", { rowDecision, rowAllocatable: row.allocation?.allocatable ?? null, rowAllocation: row.allocation?.status ?? null });
    const discoveredMeterNo = trn.ast?.astData?.astNo;
    if (!nonblank(discoveredMeterNo)) return held("FIND_METER_NO_MISSING");
    // "startedAt kept". The row completes at the find time; a row started after the find (the team came back later)
    // completes at its start, so completedAt is never before startedAt. The history keeps the real find time.
    const rowStartedAt = row.execution?.startedAt;
    const rowStartMs = millis(rowStartedAt);
    if (!absent(rowStartedAt) && rowStartMs === null) return held("ROW_START_UNKNOWN");
    const completedAtMs = rowStartMs !== null && rowStartMs > findAtMs ? rowStartMs : findAtMs;
    const targetedMeterNo = row.meter?.numberNormalized || row.meter?.numberRaw || salesId;
    const meterMatch = Boolean(normMeterNo(targetedMeterNo)) && normMeterNo(targetedMeterNo) === normMeterNo(discoveredMeterNo);
    const closedStates = states.map(s => (s.id === row.id ? { ...s, execution: { status: "COMPLETED", startedAt: s.execution.startedAt ?? findAtMs, completedAt: completedAtMs } } : s));
    const after = parentAfter(before, closedStates, executionFallback(closedStates));
    if (after.action === "HOLD") return held(`PARENT_${after.reason}`);
    const rowErfId = row.refs?.erfId || sales.erfId || null;
    const findErfId = trn.accessData?.erfId || null;
    return out(DECISIONS.CLOSE, "FOUND_BY_BATCH_TEAM", { ...find, findType, completedAtMs, foundBeforeRowStart: completedAtMs !== findAtMs, exactIndex: exact.index, premiseId, findPremiseId, premiseKept: Boolean(rowPremiseId || refPremiseId), targetedMeterNo, discoveredMeterNo, meterMatch,
      rowErfId, findErfId, foundOnOtherErf: rowErfId && findErfId ? rowErfId !== findErfId : null, after });
  } catch (error) {
    return log("POLICY_ERROR", { detail: error.message });
  }
}

// ---------------------------------------------------------------- what a change writes
// What a close writes on the row and the tbRef (premiseLink.js completion shapes; TB-R053 closedRowFields / closedTbRef).
export function closedRowFields(row, plan, ts) {
  const findAt = ts(plan.findAtMs);
  return {
    execution: { status: "COMPLETED", startedAt: row.execution?.startedAt || findAt, completedAt: ts(plan.completedAtMs ?? plan.findAtMs), outcome: rowOutcome(plan) },
    refs: { erfId: row.refs?.erfId ?? null, premiseId: plan.premiseId, meterId: plan.astId, trnId: plan.trnId },
  };
}
export function closedTbRef(ref, row, plan, ts, now) {
  const fw = ref.fieldWork || {};
  return { ...ref, rowId: row.id, fieldWork: { ...fw, status: "COMPLETED", outcomeCode: "METER_DISCOVERED", outcomeLabel: "Meter Discovered",
    targetedMeterNo: plan.targetedMeterNo, discoveredMeterNo: plan.discoveredMeterNo, meterMatch: plan.meterMatch,
    premiseId: plan.premiseId, meterId: plan.astId, trnId: plan.trnId, submittedAt: fw.submittedAt || ts(plan.findAtMs), updatedAt: now } };
}
// Only derived.targetedBatch on the find's TRN, as a batch completion writes it (index.js onMeterDiscoveryCreated).
export const trnMark = (plan, batchCompleted) => ({ tbId: plan.tbId, rowId: plan.rowId, salesDocId: plan.salesId, premiseId: plan.premiseId, meterId: plan.astId, trnId: plan.trnId, meterMatch: plan.meterMatch, batchCompleted });

// A stored Timestamp is kept when the planned time is the same instant.
const tsOf = (existing, ms, ts) => (ms === null ? null : millis(existing) === ms ? existing : ts(ms));
const storedCounts = parent => Object.fromEntries(COUNT_KEYS.map(k => [k, parent.counts?.[k] ?? null]));
const statusOf = (status, execution) => ({ status: status ?? null, execution: execution?.status ?? null, startedAt: execution?.startedAt ?? null, completedAt: execution?.completedAt ?? null });
const plainRow = row => { const { idConflict: _conflict, ...data } = row; return data; };
const day = ms => new Date(ms).toISOString().slice(0, 10);

// Counts recounted from the rows, status per section 4; allocation, acceptance, creation and selection are never written.
function parentPatch(parent, after, actor, at, ts) {
  const patch = { ...Object.fromEntries(COUNT_KEYS.map(k => [`counts.${k}`, after.counts[k]])), "metadata.updatedAt": at, "metadata.updatedByUid": actor.uid, "metadata.updatedByUser": actor.user };
  if (after.branch !== "UNCHANGED") Object.assign(patch, { status: after.status, "execution.status": after.execution.status,
    "execution.startedAt": tsOf(parent.execution?.startedAt, after.execution.startedAt, ts), "execution.completedAt": tsOf(parent.execution?.completedAt, after.execution.completedAt, ts) });
  return patch;
}

// The exact writes of a CLOSE or REMOVE decision, in order: [{ op: "update" | "create" | "delete", path, data }].
// options: ts (milliseconds -> Timestamp), now (a Timestamp: tbRefs are arrays, which cannot hold a server timestamp),
// serverTime (the server-timestamp sentinel for every other time).
export function buildRowFollowsSalesWrites(plan, facts, { ts, now, serverTime }) {
  if (![DECISIONS.CLOSE, DECISIONS.REMOVE].includes(plan.decision)) return [];
  const { sales, parent } = facts;
  const row = facts.rows.find(r => r.id === plan.rowId);
  const { finder, after } = plan;
  const at = serverTime;
  const salesPath = `sales-all-meters/${plan.salesId}`;
  const parentPath = `tb_uploads/${plan.tbId}`;
  const salesMeta = buildSalesAllMetersOperationalMetadataPatch({ existing: sales, operationTimestamp: now, actorUid: finder.uid, actorUser: finder.user });
  if (salesMeta["metadata.updatedAt"]) salesMeta["metadata.updatedAt"] = at;
  const actor = { uid: finder.uid, name: finder.user, role: finder.role };
  const hMeta = { createdAt: at, createdByUid: finder.uid, createdByUser: finder.user, updatedAt: at, updatedByUid: finder.uid, updatedByUser: finder.user };
  const patch = after.action === "DELETE" ? null : parentPatch(parent, after, finder, at, ts);
  const statusAfter = after.action === "DELETE" ? { status: "DELETED", execution: null, startedAt: null, completedAt: null }
    : after.branch === "UNCHANGED" ? statusOf(parent.status, parent.execution)
      : statusOf(patch.status, { status: patch["execution.status"], startedAt: patch["execution.startedAt"], completedAt: patch["execution.completedAt"] });
  const finderRecord = { uid: finder.uid, user: finder.user, role: finder.role, teamId: finder.teamId, teamName: finder.teamName, spId: finder.spId };
  const common = { tbId: plan.tbId, rowId: plan.rowId, rowNo: plan.rowNo, salesId: plan.salesId, countsBefore: storedCounts(parent), countsAfter: after.counts,
    statusBefore: statusOf(parent.status, parent.execution), statusAfter, rule: RULE, runId: plan.runId, rulesVersion: RULES_VERSION,
    finder: finderRecord, astId: plan.astId, trnId: plan.trnId, findAt: ts(plan.findAtMs), actor, metadata: hMeta };
  const finderText = `${finder.teamName || (finder.spId ? `service provider ${finder.spId}` : "?")} (${finder.user}) on ${day(plan.findAtMs)}`;
  // A find matches the batch through the worker's team or their service provider. The note names the one that matched,
  // so nobody reads the worker's other organisation as the one credited.
  const matchedText = plan.target ? `${plan.target.name || plan.target.id} (${plan.target.type === "SP" ? "service provider" : "team"})` : "";
  const ownFindText = `${finder.user}${finder.teamName && plan.target?.type !== "SP" ? "" : finder.teamName ? `, of team ${finder.teamName},` : ""} on ${day(plan.findAtMs)}`;

  if (plan.decision === DECISIONS.CLOSE) {
    const fields = closedRowFields(row, plan, ts);
    const tbRefsAfter = sales.tbRefs.map((ref, i) => (i === plan.exactIndex ? closedTbRef(ref, row, plan, ts, now) : ref));
    const integrity = inspectSalesTbRefsIntegrity(tbRefsAfter);
    if (!integrity.valid) throw new Error(`The closed tbRefs of ${plan.salesId} would be invalid: ${integrity.issues.join(", ")}`);
    return [
      { op: "update", path: `tb_rows/${plan.rowId}`, data: { "execution.status": "COMPLETED", "execution.startedAt": fields.execution.startedAt, "execution.completedAt": fields.execution.completedAt, "execution.outcome": fields.execution.outcome,
        "refs.premiseId": fields.refs.premiseId, "refs.meterId": fields.refs.meterId, "refs.trnId": fields.refs.trnId,
        // As a batch completion names the capturer: the worker who made the find.
        "metadata.updatedAt": at, "metadata.updatedByUid": finder.uid, "metadata.updatedByUser": finder.user } },
      { op: "update", path: salesPath, data: { tbRefs: tbRefsAfter, ...salesMeta } },
      // Only derived.targetedBatch: the find then counts once in the Allocation Matrix, under Completed (batches) (TB-R045).
      { op: "update", path: `trns/${plan.trnId}`, data: { "derived.targetedBatch": trnMark(plan, after.status === "COMPLETED") } },
      { op: "update", path: parentPath, data: patch },
      { op: "create", path: `${parentPath}/history/ROW_CLOSED__${plan.rowId}`, data: { event: ROW_CLOSED_EVENT, ...common, rowBefore: plainRow(row), rowAfter: fields,
        findType: plan.findType ?? "METER_DISCOVERY", premiseKept: plan.premiseKept, foundBeforeRowStart: plan.foundBeforeRowStart ?? false, findPremiseId: plan.findPremiseId, rowErfId: plan.rowErfId, findErfId: plan.findErfId, foundOnOtherErf: plan.foundOnOtherErf, warnings: after.warnings || [],
        note: `Meter ${plan.salesId} became Visible, found by ${ownFindText} for ${matchedText}, which the batch is allocated to; the row is closed as Completed${plan.findType === "METER_INSTALLATION" ? " (found by a Meter Installation)" : ""}${plan.foundOnOtherErf ? ", found on another ERF" : ""}${plan.foundBeforeRowStart ? `, at the row's start ${new Date(plan.completedAtMs).toISOString()} because the row was started after the find` : ""} (rules ${RULES_VERSION}, ${RULE})` } },
    ];
  }

  const removalAudit = { parentStatus: parent.status ?? null, rowExecutionStatus: rowStatus(row), salesMeterStatus: plan.salesMeterStatus, parentAllocation: parent.allocation ?? null, parentAcceptance: parent.acceptance ?? null,
    rowAllocation: row.allocation ?? null, removedTbRef: plan.removedTbRef, cleanupRunId: plan.runId, ownerTbId: null, ownerRule: plan.reason };
  const eventId = `${plan.tbId}__REMOVED_FROM_BATCH`;
  const writes = [
    { op: "create", path: `${salesPath}/batchHistory/${eventId}`, data: { schemaVersion: 1, id: eventId, eventType: "REMOVED_FROM_BATCH", tbId: plan.tbId, rowId: plan.rowId, salesId: plan.salesId,
      geofenceId: parent.geofenceId ?? null, erfId: row.refs?.erfId ?? sales.erfId ?? null, membershipBefore: plan.tbId, membershipAfter: null, membershipSource: plan.membershipSource,
      // Sales schema TB6: the actor is the worker who made the find.
      actor: { uid: finder.uid, user: finder.user, role: finder.role }, occurredAt: at, reason: plan.reason, idempotencyKey: eventId, salesMeterStatus: plan.salesMeterStatus,
      erfResolutionRevision: sales.erfResolution?.revision ?? null, removalAudit } },
    { op: "update", path: salesPath, data: { tbRefs: sales.tbRefs.filter((_, i) => i !== plan.exactIndex), targetedBatchId: null, ...salesMeta } },
    { op: "delete", path: `tb_rows/${plan.rowId}` },
  ];
  if (after.action === "DELETE") {
    // A batch left with no rows is deleted; its history stays, with this entry (TB-R053 section 4).
    writes.push({ op: "create", path: `${parentPath}/history/BATCH_DELETED__${plan.runId}`, data: { event: BATCH_DELETED_EVENT, tbId: plan.tbId, lastRowId: plan.rowId, salesId: plan.salesId, parentBefore: parent,
      countsBefore: common.countsBefore, statusBefore: common.statusBefore, rule: RULE, runId: plan.runId, rulesVersion: RULES_VERSION, actor, metadata: hMeta,
      note: `Batch ${plan.tbId} has no rows left after meter ${plan.salesId} went out of it and is deleted; its history is kept (rules ${RULES_VERSION}, ${RULE})` } });
    writes.push({ op: "delete", path: parentPath });
  } else writes.push({ op: "update", path: parentPath, data: patch });
  writes.push({ op: "create", path: `${parentPath}/history/ROW_REMOVED__${plan.rowId}`, data: { event: ROW_REMOVED_EVENT, ...common, released: false, ownerTbId: null, ownerRule: plan.reason, reason: plan.reason,
    removedRow: plainRow(row), removedTbRef: plan.removedTbRef, pointingAtRow: { trnIds: facts.pointing?.trnIds ?? [], premiseIds: facts.pointing?.premiseIds ?? [] },
    note: `Meter ${plan.salesId} became Visible, found by ${finderText}${plan.reason === REMOVAL_REASONS.UNALLOCATED ? " while the batch was not allocated" : ", not the batch's own team or service provider"}; the row goes out of the batch and no team gets credit through it (rules ${RULES_VERSION}, ${RULE})` } });
  return writes;
}
