import { NO_ACCESS_REASON_CODES, normalizeNoAccessReason, isReturnVisitReason } from "./recordNoAccess.js";

// Structural Discovery migration only. Preserve captured words; never infer an occupant's
// request, an appointment, a capture time, a premise or a physical meter state.
export function planDiscoveryAccessBackfill(record = {}) {
  const access = record.accessData?.access;
  if (record.accessData?.trnType !== "METER_DISCOVERY" || access?.hasAccess !== "no") return null;
  // Appointments under the former rule need the owner's historical-data decision.
  if (access.appointment != null) return null;
  if (access.appointmentRuleVersion != null && access.appointmentRuleVersion !== 2) return null;
  const words = String(access.reasonCode || access.reason || "").trim();
  if (!words || words.toUpperCase() === "NAV") return null;
  const canonical = NO_ACCESS_REASON_CODES.find(reason => reason.toUpperCase() === words.toUpperCase());
  if (isReturnVisitReason(words)) return null;
  const reason = normalizeNoAccessReason(canonical
    ? { reasonCode: canonical, reasonOther: access.reasonOther }
    : { reasonCode: "OTHER", reasonOther: String(access.reason || words).trim() });
  const values = { ...reason, appointment: null, appointmentRuleVersion: 2 };
  const patch = Object.fromEntries(Object.entries(values)
    .filter(([key, value]) => access[key] !== value)
    .map(([key, value]) => [`accessData.access.${key}`, value]));
  return Object.keys(patch).length ? patch : null;
}
