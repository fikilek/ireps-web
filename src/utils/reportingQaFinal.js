// Final QA is derived from current components, independently of execution.
export function reportingQaFinal({ premise, meter }) {
  const norm = value => String(value || "").trim().toUpperCase().replaceAll("_", " ");
  if ([premise, meter].some(value => norm(value) === "QA FAIL")) return "QA FAIL";
  if (norm(premise) === "QA PASS" && norm(meter) === "QA PASS") return "QA PASS";
  return "QA NAv";
}
