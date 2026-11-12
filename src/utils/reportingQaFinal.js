// Shared TB/BGO reporting presentation. QA review belongs to the registries.
export function reportingQaFinal({ completed, premise, meter, noAccess, stored }) {
  if (!completed) return "QA NAv";
  const norm = value => String(value || "").trim().toUpperCase().replaceAll("_", " ");
  if (!stored) {
    if ([premise, meter, noAccess].some(value => norm(value) === "QA FAIL")) return "QA FAIL";
    if (norm(premise) === "QA PASS" && norm(meter) === "QA PASS") return "QA PASS";
    return "QA NAv";
  }
  const value = norm(stored);
  if (["QA PENDING", "PENDING", "QA NAV", "NAV"].includes(value)) return "QA NAv";
  if (["QA PASS", "PASS"].includes(value)) return "QA PASS";
  if (["QA FAIL", "FAIL"].includes(value)) return "QA FAIL";
  if (["QA UPDATED", "UPDATED"].includes(value)) return "QA UPDATED";
  if (["COMPLETED", "NOT STARTED", "IN PROGRESS"].includes(value)) return value;
  return String(stored).trim();
}
