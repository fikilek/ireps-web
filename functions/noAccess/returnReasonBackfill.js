import { NO_ACCESS_RETURN_VISIT_REASON, isReturnVisitReason } from "./recordNoAccess.js";

// A spelling change must not reinterpret free-text Other explanations or alter agreements.
export function returnReasonPatch(access = {}, prefix = "accessData.access") {
  if (String(access.hasAccess).toLowerCase() !== "no" || !isReturnVisitReason(access.reasonCode || access.reason)) return {};
  const fields = prefix === "access" ? ["reason"] : ["reasonCode", "reason"];
  return Object.fromEntries(fields
    .filter(key => access[key] !== NO_ACCESS_RETURN_VISIT_REASON)
    .map(key => [`${prefix}.${key}`, NO_ACCESS_RETURN_VISIT_REASON]));
}
