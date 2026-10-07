const RETURN_REASON = "Return visit requested";
const isReturnReason = value => [RETURN_REASON, "Occupant requested a return visit"]
  .some(reason => reason.toLowerCase() === String(value || "").trim().toLowerCase());

export function registryNoAccessDetails(access = {}) {
  const returnVisit = String(access.hasAccess).toLowerCase() === "no" &&
    isReturnReason(access.reasonCode || access.reason);
  const accessReason = returnVisit ? RETURN_REASON : access.reason || "NAv";
  if (!returnVisit) return { accessReason, returnAppointmentLabel: null };
  const at = access.appointment?.at;
  const date = typeof at === "string" && at.trim() ? new Date(at) : null;
  const returnAppointmentLabel = date && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Johannesburg", day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(date)
    : "NAv";
  return { accessReason, returnAppointmentLabel };
}
