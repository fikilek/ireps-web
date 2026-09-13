import { SALES_BATCH_ID, SALES_ID, nonblank, isTimestamp, resolveSalesTargetedBatchMembership, classifySalesWorkStatus, exactSalesTbRef } from "../salesAllMeters/sales-batch-policy.js";

export function buildSalesBatchHistory({ type, tbId, rowId, salesId, geofenceId, erfId, membershipSource, actor, at, revision = null, reason = null, removalAudit }) {
  if (!["BATCHED", "REMOVED_FROM_BATCH"].includes(type) || !SALES_BATCH_ID.test(tbId) || !SALES_ID.test(salesId) || !nonblank(rowId) || !["SCALAR", "LEGACY_TBREFS"].includes(membershipSource) || !isTimestamp(at) || ![actor?.uid, actor?.user, actor?.role].every(nonblank)) throw new Error("Invalid Batch History evidence");
  const removed = type === "REMOVED_FROM_BATCH", id = `${tbId}__${type}`;
  if (removed && (!nonblank(reason) || !removalAudit)) throw new Error("Removal reason and audit are required");
  return { schemaVersion: 1, id, eventType: type, tbId, rowId, salesId, geofenceId: geofenceId ?? null, erfId: erfId ?? null, membershipBefore: removed ? tbId : null, membershipAfter: removed ? null : tbId, membershipSource, actor: { uid: actor.uid, user: actor.user, role: actor.role }, occurredAt: at, reason, idempotencyKey: id, salesMeterStatus: "NOT_STARTED", erfResolutionRevision: revision, ...(removed ? { removalAudit } : {}) };
}
export function inspectSalesRemoval(sales, tbId) {
  const membership = resolveSalesTargetedBatchMembership(sales);
  const exact = exactSalesTbRef(sales, tbId);
  if (membership.state !== "MEMBER" || membership.tbId !== tbId || !exact.ok) throw Object.assign(new Error("Sales membership or reference does not match the batch being removed"), { code: "SALES_REMOVAL_LINKAGE_CONFLICT" });
  if (classifySalesWorkStatus(sales) !== "NOT_STARTED" || Object.hasOwn(exact.reference, "fieldWork") || Object.hasOwn(exact.reference, "rowId")) throw Object.assign(new Error("Execution evidence permanently blocks deletion"), { code: "EXECUTION_STARTED" });
  return { membership, exact, remainingRefs: sales.tbRefs.filter((_, index) => index !== exact.index) };
}
