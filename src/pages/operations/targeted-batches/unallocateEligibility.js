// Targeted Batch rules TB-R048 (1.3.33): whether TB Register offers Unallocate for a batch, and why not.
// This is only a hint for the button; the Function re-reads every row and decides.

const text = (value) => String(value ?? "").trim();
const upper = (value) => text(value).toUpperCase();

export function hasFieldWorkStarted(upload = {}) {
  const executionStatus = upper(upload?.execution?.status);
  return (
    Number(upload?.counts?.executionStartedRows || 0) > 0 ||
    Number(upload?.counts?.completedRows || 0) > 0 ||
    Boolean(executionStatus && executionStatus !== "NOT_STARTED") ||
    Boolean(upload?.execution?.startedAt || upload?.execution?.completedAt) ||
    ["IN_PROGRESS", "COMPLETED"].includes(upper(upload?.status))
  );
}

export function getUnallocateEligibility(upload = {}, { uid, role } = {}) {
  const allocatedBy = text(upload?.allocation?.allocatedByUser) || "the user who allocated it";

  if (hasFieldWorkStarted(upload)) {
    return {
      allowed: false,
      reason: "Field work has started on this batch, so it keeps its TEAM or SP.",
    };
  }

  if (upload?.schemaVersion !== "0.3.0") {
    return {
      allowed: false,
      reason: "Older batches cannot be unallocated.",
    };
  }

  if (upper(upload?.status) !== "ALLOCATED" || upper(upload?.allocation?.status) !== "ALLOCATED" || !text(upload?.allocation?.targetId)) {
    return {
      allowed: false,
      reason: "The batch is not in a settled allocated state.",
    };
  }

  if (!["MNG", "SPV"].includes(upper(role))) {
    return {
      allowed: false,
      reason: `Only ${allocatedBy} or a manager can unallocate this batch.`,
    };
  }

  if (text(uid) && text(uid) === text(upload?.allocation?.allocatedByUid)) {
    return {
      allowed: true,
      authority: "ALLOCATOR",
      reason: "Take this batch back from its TEAM or SP. The backend rechecks every row first.",
    };
  }

  if (upper(role) === "MNG") {
    return {
      allowed: true,
      authority: "MANAGER_OVERRIDE",
      reason: `${allocatedBy} allocated this batch. As a manager you can unallocate it; it is recorded as an override.`,
    };
  }

  return {
    allowed: false,
    reason: `Only ${allocatedBy} or a manager can unallocate this batch.`,
  };
}
