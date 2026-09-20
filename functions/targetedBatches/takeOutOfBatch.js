// Targeted Batch rules TB-R060 (1.3.62): taking a meter out of a batch.
// Because work on a batched meter belongs to the batch's team (TB-R059), there must be a way to free a
// meter. A supervisor or manager takes it out, and the row leaves the batch exactly as a batch row follows
// its Sales meter removes one (TB-R056, rowFollowsSales.js REMOVE branch): REMOVED_FROM_BATCH on the Sales
// record with removalAudit, the batch's tbRef removed, targetedBatchId back to null, the row deleted, the
// batch recounted from its rows and its status set by section 14, ROW_REMOVED__<rowId> on the batch and
// <tbId>__REMOVED_FROM_BATCH on the Sales record.
// The reason is TAKEN_OUT_OF_BATCH and reasonText is the person's own words (required, at most 500).
// Refused: a Completed row or a meter already found on site (VISIBLE); the batch's last row (Delete Batch
// is how a batch is emptied); a meter that is not in that batch; a membership that cannot be read.
// Who may do it is Unallocate's own authority (TB-R048), applied by the callable: SPV or MNG, the batch's
// LM their active workbase, the main service provider, and the batch's own TEAM or SP inside it (1.3.62).
// Pure: no Firestore here. The callable (takeOutOfBatchCallable.js) reads the facts, this module decides and
// says exactly what to write. Sales schema 1.10.2 (TB6) gives the event shape.
import { resolveSalesTargetedBatchMembership, exactSalesTbRef, inspectSalesTbRefsIntegrity, classifySalesWorkStatus, nonblank } from "../salesAllMeters/sales-batch-policy.js";
import { buildSalesAllMetersOperationalMetadataPatch } from "../salesAllMeters/helpers.js";
import { parentAfter, parentState, rowState, rowStatus, executionFallback, parentPatch, storedCounts, statusOf, plainRow, ROW_REMOVED_EVENT } from "./rowFollowsSales.js";

export const RULE = "TB-R060";
export const RULES_VERSION = "1.3.62";
export const REASON = "TAKEN_OUT_OF_BATCH";
export const REASON_TEXT_MAX = 500;
export const ACTOR_ROLES = Object.freeze(["SPV", "MNG"]);
export const DECISIONS = Object.freeze({ REMOVE: "REMOVE", REFUSE: "REFUSE" });
// The run ID this change carries, in the batch history and in any entry keyed by it. One row, one run.
export const runIdOf = rowId => `${RULE}:${rowId}`;

const text = value => String(value ?? "").trim();

// Every refusal, in plain words for the person at the screen. meter is the meter number, batch the batch ID.
const MESSAGES = Object.freeze({
  REASON_REQUIRED: () => "Say in your own words why the meter must come out of the batch.",
  REASON_TOO_LONG: () => `The reason is longer than ${REASON_TEXT_MAX} characters. Please shorten it.`,
  ACTOR_INCOMPLETE: () => "Your user record has no name or role, so nothing was changed.",
  ACTOR_ROLE: () => "Only a supervisor or a manager may take a meter out of a batch.",
  // Rules TB-R060 (1.3.62): the same authority as Unallocate. A batch outside the person's authority is
  // answered in the same words as a batch that is not there, so nobody learns of another LM's batches.
  ACTOR_NO_SERVICE_PROVIDER: () => "Your user record is not linked to a main service provider, so nothing was changed.",
  TARGET_OUTSIDE_MNC: ({ batch }) => `Batch ${batch} is allocated outside your service provider, so nothing was changed.`,
  TARGET_UNREADABLE: ({ batch }) => `Who batch ${batch} is allocated to cannot be read. Nothing was changed; the office must look at the batch.`,
  SALES_MISSING: ({ meter }) => `Meter ${meter} has no Sales record, so it cannot be taken out of a batch.`,
  MEMBERSHIP_UNRESOLVED: ({ meter }) => `Which batch meter ${meter} belongs to cannot be read. Nothing was changed; the office must sort the meter's batch references out first.`,
  NOT_IN_BATCH: ({ meter, batch }) => `Meter ${meter} is not in batch ${batch}.`,
  PARENT_MISSING: ({ batch }) => `Batch ${batch} could not be read, so nothing was changed.`,
  PARENT_IDENTITY: ({ batch }) => `Batch ${batch} does not match its own record. Nothing was changed; the office must look at the batch.`,
  ROW_MISSING: ({ meter, batch }) => `Batch ${batch} has no row for meter ${meter}.`,
  ROW_DUPLICATE: ({ meter, batch }) => `Batch ${batch} has more than one row for meter ${meter}. Nothing was changed; the office must look at the batch.`,
  ROW_IDENTITY: ({ batch }) => `The rows of batch ${batch} do not all belong to it. Nothing was changed; the office must look at the batch.`,
  ROW_COMPLETED: ({ meter, batch }) => `Meter ${meter} is completed in batch ${batch}. Completed work is never released.`,
  METER_VISIBLE: ({ meter }) => `Meter ${meter} has been found on site, so it is completed. Completed work is never released.`,
  LAST_ROW: ({ meter, batch }) => `Meter ${meter} is the last meter in batch ${batch}. Use Delete Batch to empty a batch.`,
  TBREF_INVALID: ({ meter, batch }) => `The reference to batch ${batch} on meter ${meter} cannot be read. Nothing was changed; the office must look at the meter.`,
  TBREFS_INVALID_AFTER: ({ meter }) => `Taking meter ${meter} out would leave its batch references unreadable. Nothing was changed; the office must look at the meter.`,
  ALREADY_TAKEN_OUT: ({ meter, batch }) => `Meter ${meter} has already been taken out of batch ${batch}.`,
  SALES_METADATA_INVALID: ({ meter }) => `The Sales record of meter ${meter} is incomplete, so nothing was changed.`,
  BATCH_WOULD_BE_EMPTY: ({ batch }) => `Batch ${batch} would be left with no meters. Use Delete Batch to empty a batch.`,
  PARENT_NOT_ACCEPTED: ({ batch }) => `Batch ${batch} has not been accepted, but work has started on it. Nothing was changed; the office must look at the batch.`,
  PARENT_WOULD_REOPEN_COMPLETED: ({ batch }) => `Batch ${batch} is completed, and taking this meter out would reopen it. Nothing was changed.`,
  PARENT_STARTED_TIME_UNKNOWN: ({ batch }) => `Batch ${batch} has no start time on its started work. Nothing was changed; the office must look at the batch.`,
  PARENT_COMPLETED_TIME_UNKNOWN: ({ batch }) => `Batch ${batch} has no completion time on its completed work. Nothing was changed; the office must look at the batch.`,
  POLICY_ERROR: ({ meter }) => `Meter ${meter} could not be checked, so nothing was changed.`,
});
export const REFUSAL_CODES = Object.freeze(Object.keys(MESSAGES));
export function refusalMessage(code, { meter = "this meter", batch = "the batch" } = {}) {
  const build = MESSAGES[code];
  return build ? build({ meter, batch }) : `Meter ${meter} could not be taken out of batch ${batch}.`;
}

// The person's own words: required, trimmed, at most 500 characters (rules TB-R060, Sales schema TB6).
export function inspectReasonText(value) {
  const trimmed = text(value);
  if (!trimmed) return { ok: false, code: "REASON_REQUIRED" };
  if (trimmed.length > REASON_TEXT_MAX) return { ok: false, code: "REASON_TOO_LONG" };
  return { ok: true, reasonText: trimmed };
}

// ---------------------------------------------------------------- the decision
// facts: { tbId (the batch the action names), sales, parent, rows (every row of the batch, with id),
//          row (the row of this meter), actor { uid, user, role }, reasonText, salesId (else the row's Sales ID),
//          history { salesRemoved, rowRemoved } (booleans, optional), pointing { trnIds, premiseIds } (optional) }
// Returns a refusal { decision: "REFUSE", code, message } or the plan { decision: "REMOVE", ... } that
// buildTakeOutOfBatchWrites turns into writes.
export function decideTakeOutOfBatch(facts = {}) {
  // The facts are read inside the try, so nothing about them can throw out of here: the callable runs this
  // inside a transaction and every outcome must be a refusal it can report.
  let meter = "this meter", batch = "the batch";
  const refuse = (code, extra = {}) => ({ decision: DECISIONS.REFUSE, code, message: refusalMessage(code, { meter, batch }), meterNo: meter, ...extra });
  try {
    const { tbId: named, sales, parent, rows = [], row, actor, reasonText, salesId, history } = facts;
    meter = text(salesId) || text(row?.salesAllMeterId) || text(sales?.master?.id) || meter;
    batch = text(named) || batch;
    const reason = inspectReasonText(reasonText);
    if (!reason.ok) return refuse(reason.code);
    if (![actor?.uid, actor?.user, actor?.role].every(nonblank)) return refuse("ACTOR_INCOMPLETE");
    if (!ACTOR_ROLES.includes(actor.role)) return refuse("ACTOR_ROLE");
    if (!sales) return refuse("SALES_MISSING");

    const membership = resolveSalesTargetedBatchMembership(sales);
    if (membership.state === "UNRESOLVED") return refuse("MEMBERSHIP_UNRESOLVED", { detail: membership.reason });
    // The meter must be in a batch, and in the batch the action names.
    if (membership.state !== "MEMBER" || (text(named) && membership.tbId !== named)) return refuse("NOT_IN_BATCH");
    const tbId = membership.tbId;
    batch = tbId;
    if (!parent) return refuse("PARENT_MISSING", { tbId });
    if (nonblank(parent.id) && parent.id !== tbId) return refuse("PARENT_IDENTITY", { tbId });

    const own = rows.filter(item => item.salesAllMeterId === meter);
    if (!own.length) return refuse("ROW_MISSING", { tbId });
    if (own.length > 1) return refuse("ROW_DUPLICATE", { tbId, rowIds: own.map(item => item.id) });
    const target = own[0];
    if (row && row.id !== target.id) return refuse("ROW_MISSING", { tbId });
    if (target.tbId !== tbId || target.idConflict || rows.some(item => item.tbId !== tbId)) return refuse("ROW_IDENTITY", { tbId });
    const base = { tbId, rowId: target.id, rowNo: target.rowNo ?? null, rowStatus: rowStatus(target) };

    // A Completed row, or a meter already found on site, is done and is never released.
    if (base.rowStatus === "COMPLETED") return refuse("ROW_COMPLETED", base);
    const salesMeterStatus = classifySalesWorkStatus(sales);
    if (salesMeterStatus === "COMPLETED") return refuse("METER_VISIBLE", base);
    // Emptying a batch is a deletion: the batch goes through Delete Batch instead.
    if (rows.length <= 1) return refuse("LAST_ROW", base);
    // A repeat finds its own history and changes nothing.
    if (history?.salesRemoved || history?.rowRemoved) return refuse("ALREADY_TAKEN_OUT", base);

    const exact = exactSalesTbRef(sales, tbId);
    if (!exact.ok) return refuse("TBREF_INVALID", { ...base, detail: exact.code });
    const tbRefsAfter = sales.tbRefs.filter((_, index) => index !== exact.index);
    if (!inspectSalesTbRefsIntegrity(tbRefsAfter).valid) return refuse("TBREFS_INVALID_AFTER", base);
    try { buildSalesAllMetersOperationalMetadataPatch({ existing: sales, operationTimestamp: { toMillis: () => 0 }, actorUid: actor.uid, actorUser: actor.user }); } catch { return refuse("SALES_METADATA_INVALID", base); }

    // The batch is recounted from the rows it is left with, and its status follows section 14 (TB-R053 section 4).
    const left = rows.filter(item => item.id !== target.id).map(rowState);
    const after = parentAfter(parentState(parent), left, executionFallback(left));
    if (after.action === "DELETE") return refuse("BATCH_WOULD_BE_EMPTY", base);
    if (after.action === "HOLD") return refuse(`PARENT_${after.reason}`, base);

    return { decision: DECISIONS.REMOVE, code: REASON, meterNo: meter, salesId: meter, ...base, reason: REASON, reasonText: reason.reasonText,
      actor: { uid: actor.uid, user: actor.user, role: actor.role }, membershipSource: membership.source, salesMeterStatus,
      exactIndex: exact.index, removedTbRef: exact.reference, runId: runIdOf(target.id), after };
  } catch (error) {
    return refuse("POLICY_ERROR", { detail: error.message });
  }
}

// ---------------------------------------------------------------- what the change writes
// The exact writes of a REMOVE decision, in order: [{ op: "create" | "update" | "delete", path, data }].
// options: ts (milliseconds -> Timestamp), now (a Timestamp), serverTime (the server-timestamp sentinel).
// The write list and every shape come from the REMOVE branch of rowFollowsSales.js, with this rule's actor,
// reason and the person's own words; Sales schema TB6 (1.10.2) governs the event.
export function buildTakeOutOfBatchWrites(plan, facts, { ts, now, serverTime }) {
  if (plan?.decision !== DECISIONS.REMOVE) return [];
  const { sales, parent } = facts;
  const row = facts.rows.find(item => item.id === plan.rowId);
  const { actor, after } = plan;
  const at = serverTime;
  const salesPath = `sales-all-meters/${plan.salesId}`;
  const parentPath = `tb_uploads/${plan.tbId}`;
  const salesMeta = buildSalesAllMetersOperationalMetadataPatch({ existing: sales, operationTimestamp: now, actorUid: actor.uid, actorUser: actor.user });
  if (salesMeta["metadata.updatedAt"]) salesMeta["metadata.updatedAt"] = at;
  const historyMeta = { createdAt: at, createdByUid: actor.uid, createdByUser: actor.user, updatedAt: at, updatedByUid: actor.uid, updatedByUser: actor.user };
  const patch = parentPatch(parent, after, actor, at, ts);
  const statusAfter = after.branch === "UNCHANGED" ? statusOf(parent.status, parent.execution)
    : statusOf(patch.status, { status: patch["execution.status"], startedAt: patch["execution.startedAt"], completedAt: patch["execution.completedAt"] });
  // Sales schema TB6: removalAudit is the exact bounded map; this rule adds no clean-up keys to it.
  const removalAudit = { parentStatus: parent.status ?? null, rowExecutionStatus: rowStatus(row), salesMeterStatus: plan.salesMeterStatus,
    parentAllocation: parent.allocation ?? null, parentAcceptance: parent.acceptance ?? null, rowAllocation: row.allocation ?? null, removedTbRef: plan.removedTbRef };
  const eventId = `${plan.tbId}__REMOVED_FROM_BATCH`;
  const who = `${actor.user} (${actor.role})`;
  return [
    { op: "create", path: `${salesPath}/batchHistory/${eventId}`, data: { schemaVersion: 1, id: eventId, eventType: "REMOVED_FROM_BATCH", tbId: plan.tbId, rowId: plan.rowId, salesId: plan.salesId,
      geofenceId: parent.geofenceId ?? null, erfId: row.refs?.erfId ?? sales.erfId ?? null, membershipBefore: plan.tbId, membershipAfter: null, membershipSource: plan.membershipSource,
      // Sales schema TB6: the actor is the supervisor or manager who took the meter out.
      actor: { uid: actor.uid, user: actor.user, role: actor.role }, occurredAt: at, reason: plan.reason, reasonText: plan.reasonText, idempotencyKey: eventId,
      salesMeterStatus: plan.salesMeterStatus, erfResolutionRevision: sales.erfResolution?.revision ?? null, removalAudit } },
    { op: "update", path: salesPath, data: { tbRefs: sales.tbRefs.filter((_, index) => index !== plan.exactIndex), targetedBatchId: null, ...salesMeta } },
    { op: "delete", path: `tb_rows/${plan.rowId}` },
    { op: "update", path: parentPath, data: patch },
    { op: "create", path: `${parentPath}/history/ROW_REMOVED__${plan.rowId}`, data: { event: ROW_REMOVED_EVENT, tbId: plan.tbId, rowId: plan.rowId, rowNo: plan.rowNo, salesId: plan.salesId,
      countsBefore: storedCounts(parent), countsAfter: after.counts, statusBefore: statusOf(parent.status, parent.execution), statusAfter,
      rule: RULE, runId: plan.runId, rulesVersion: RULES_VERSION, released: true, ownerTbId: null, ownerRule: plan.reason, reason: plan.reason, reasonText: plan.reasonText,
      removedRow: plainRow(row), removedTbRef: plan.removedTbRef, pointingAtRow: { trnIds: facts.pointing?.trnIds ?? [], premiseIds: facts.pointing?.premiseIds ?? [] },
      actor: { uid: actor.uid, user: actor.user, role: actor.role }, metadata: historyMeta,
      note: `${who} took meter ${plan.salesId} out of batch ${plan.tbId}: "${plan.reasonText}". The meter is free again and may be batched again; anybody may work on it (rules ${RULES_VERSION}, ${RULE})` } },
  ];
}
