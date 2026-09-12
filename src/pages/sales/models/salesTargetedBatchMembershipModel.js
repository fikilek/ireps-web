// Current batch membership follows rules 18.2 and TB-R037: a present
// targetedBatchId decides (null means no batch); tbRefs are read only when the
// field is absent on older Sales records.
const TARGETED_BATCH_ID_PATTERN = /^TGB_[0-9]{8}_[0-9]{6}_[A-Z0-9]{4}$/;

function validDocumentId(value) {
  return typeof value === "string" && value.trim().length > 0 &&
    !value.includes("/") &&
    [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) &&
    ![".", ".."].includes(value.trim());
}

function unresolved(reason, source = null) {
  return { state: "UNRESOLVED", tbId: null, source, reason };
}

export function resolveSalesTargetedBatchMembership(row = {}) {
  if (row?.targetedBatchIdInvalid === true) {
    return unresolved("Current Targeted Batch ID is malformed", "SCALAR");
  }
  if (Object.hasOwn(row, "targetedBatchId")) {
    const scalar = row.targetedBatchId;
    if (scalar === null) return { state: "NONE", tbId: null, source: "SCALAR", reason: null };
    // A malformed value is never repaired into a valid ID.
    if (typeof scalar !== "string" || !TARGETED_BATCH_ID_PATTERN.test(scalar)) {
      return unresolved("Current Targeted Batch ID is malformed", "SCALAR");
    }
    return { state: "MEMBER", tbId: scalar, source: "SCALAR",
      reason: "Already belongs to " + scalar };
  }

  if (row?.tbRefsIntegrity?.valid !== true || !Array.isArray(row?.tbRefs)) {
    return unresolved("Targeted Batch reference integrity is unresolved");
  }

  const ids = row.tbRefs.map((reference) =>
    validDocumentId(reference?.id) ? reference.id.trim() : null);
  const identities = ids.map((id) => id?.toUpperCase());
  // Raw integrity must survive normalizer filtering/deduplication. Also guard
  // callers that supply a contradictory normalized array with valid=true.
  if (ids.some((id) => id === null) || new Set(identities).size !== ids.length) {
    return unresolved("Targeted Batch references are malformed or duplicated");
  }

  if (ids.length === 0) {
    return { state: "NONE", tbId: null, source: null, reason: null };
  }
  if (ids.length > 1) {
    return unresolved("Multiple Targeted Batch references cannot establish one current batch", "LEGACY_TBREF");
  }
  return { state: "MEMBER", tbId: ids[0], source: "LEGACY_TBREF",
    reason: "Already belongs to " + ids[0] };
}

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
