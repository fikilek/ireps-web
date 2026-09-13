import { validDocumentId } from "../../../../functions/salesAllMeters/sales-batch-policy.js";
export { resolveSalesTargetedBatchMembership } from "../../../../functions/salesAllMeters/sales-batch-policy.js";

export function getSalesTargetedBatchMembershipLabel(membership) {
  if (membership?.state === "NONE") return "Not Batched";
  if (membership?.state === "MEMBER" && validDocumentId(membership.tbId)) return membership.tbId;
  return "Unresolved";
}

export function getSalesTargetedBatchMembershipFilterKey(membership) {
  if (membership?.state === "NONE") return "NONE";
  if (membership?.state === "MEMBER" && validDocumentId(membership.tbId)) return "MEMBER:" + membership.tbId;
  return "UNRESOLVED";
}
