// Targeted Batch rules TB-R058 (1.3.58): the window names the batch, so the office does not have to
// leave the Sales table to find out what it is looking at. Plain words, and the three statuses.
export const WORK_STATUS_TEXT = { NOT_STARTED: "Not Started", IN_PROGRESS: "In Progress", COMPLETED: "Completed" };
export const ACCEPTANCE_TEXT = { NOT_READY: "Not sent out yet", WAITING: "Waiting to be accepted", ACCEPTED: "Accepted", REJECTED: "Rejected" };
const upper = value => String(value ?? "").trim().toUpperCase();
const asText = (value, fallback = "NAv") => String(value ?? "").trim() || fallback;
export const workStatusText = value => WORK_STATUS_TEXT[upper(value)] || asText(value);
export const acceptanceText = value => ACCEPTANCE_TEXT[upper(value)] || asText(value);

// The batch type as TB Register names it (getBatchType).
export function batchTypeText(batch) {
  if (upper(batch?.selection?.planningMode) === "NON_GPS_STREET" || batch?.source?.type === "PREPAID_SALES_NON_GPS") return "Non-GPS";
  if (batch?.source?.type === "PREPAID_SALES") return "GPS";
  return "NAv";
}

export function allocationText(batch) {
  const name = String(batch?.allocation?.targetName || batch?.allocation?.target?.name || "").trim();
  const type = upper(batch?.allocation?.targetType || batch?.allocation?.target?.type);
  const allocated = upper(batch?.status) === "ALLOCATED" || upper(batch?.allocation?.status) === "ALLOCATED" || Boolean(batch?.allocation?.targetId || batch?.allocation?.target?.id);
  if (!allocated) return "Not allocated";
  const kind = type === "TEAM" ? "Team" : type ? "Service provider" : "";
  return [name || "Name missing", kind ? `(${kind})` : ""].filter(Boolean).join(" ");
}

