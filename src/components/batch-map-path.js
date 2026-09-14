// Targeted Batch rules TB-R043: where a batch list's map button goes, and where the Batch
// Map's back button returns. Only in-app paths are accepted as a return target.
export function batchMapPath(tbId) {
  return `/sales/reporting/${encodeURIComponent(tbId)}/map`;
}

export function batchMapReturn(state) {
  const from = state?.from;
  const path = typeof from?.path === "string" ? from.path : "";
  if (!path.startsWith("/") || path.startsWith("//")) return { path: "/sales/reporting", label: "Reporting" };
  return { path, label: String(from?.label || "").trim() || "list" };
}
