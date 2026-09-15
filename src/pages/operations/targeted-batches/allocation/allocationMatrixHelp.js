// Targeted Batch rules TB-R045: what each Allocation Matrix column means, how it is worked out,
// and its number for every TEAM / SP shown, with the project total, so nobody doubts a figure.
import { splitHundredPercent } from "./allocationMatrixModel.js";
const count = value => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const pct = value => `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
const plural = (value, word) => `${count(value)} ${word}${Number(value) === 1 ? "" : "s"}`;
const batchesLabel = value => `${count(value)} batch${Number(value) === 1 ? "" : "es"}`;

function projectTotals(all = []) {
  const sum = key => all.reduce((total, organisation) => total + Number(organisation?.matrix?.[key] || 0), 0);
  return { assigned: sum("assigned"), notStarted: sum("notStarted"), inProgress: sum("inProgress"), completed: sum("completed"), batches: sum("batches"), rejectedBatches: sum("rejectedBatches") };
}
const partOf = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

export const MATRIX_COLUMN_KEYS = Object.freeze(["type", "name", "batches", "assigned", "notStarted", "inProgress", "completed", "projectShare", "projectedAssigned", "projectedShare"]);

export function matrixColumnHelp(key, { organisations = [], allOrganisations = organisations, incomingMeters = 0 } = {}) {
  const totals = projectTotals(allOrganisations);
  const [notStartedPct, inProgressPct, completedPct] = splitHundredPercent([totals.notStarted, totals.inProgress, totals.completed]);
  const projectPct = { notStarted: notStartedPct, inProgress: inProgressPct, completed: completedPct };
  const rows = fn => organisations.map(organisation => [organisation.name, fn(organisation.matrix || {}, organisation)]);
  const state = (field, label, meaning) => ({
    title: label,
    paragraphs: [meaning, `The percentage is ${label} ÷ Meters Assigned. Not Started + In Progress + Completed always equals Meters Assigned, and their three percentages add up to 100%.`],
    formula: `${label} % = ${label} ÷ Meters Assigned`,
    rows: rows(matrix => `${count(matrix[field])} of ${count(matrix.assigned)} = ${pct(matrix[`${field}Pct`])}`),
    total: `Project: ${count(totals[field])} of ${count(totals.assigned)} meters = ${pct(projectPct[field])}`,
  });
  switch (key) {
    case "type": return {
      title: "Type",
      paragraphs: ["TEAM is a field team of your company. SP is a subcontracted service provider. A batch is allocated to one TEAM or one SP."],
      rows: rows((_, organisation) => organisation.type),
      total: `TEAMs: ${count(allOrganisations.filter(item => item.type === "TEAM").length)} · SPs: ${count(allOrganisations.filter(item => item.type === "SP").length)}`,
    };
    case "name": return {
      title: "TEAM / SP",
      paragraphs: ["The TEAM or service provider the batches were allocated to, and how many people belong to it."],
      rows: rows((_, organisation) => plural(organisation.memberCount, "member")),
    };
    case "batches": return {
      title: "Batches",
      paragraphs: ["How many batches have been allocated to this TEAM / SP since the project started, whatever state they are in.",
        "Batches this TEAM / SP rejected are left out of every number in this table, because they are not its work. A batch whose records do not add up is left out too and listed in the warning at the top of the page."],
      rows: rows(matrix => `${batchesLabel(matrix.batches)}${matrix.rejectedBatches ? ` · ${count(matrix.rejectedBatches)} rejected, left out` : ""}`),
      total: `Project: ${batchesLabel(totals.batches)}${totals.rejectedBatches ? ` · ${count(totals.rejectedBatches)} rejected, left out` : ""}`,
    };
    case "assigned": return {
      title: "Meters Assigned",
      paragraphs: ["The total number of meters in all the batches allocated to this TEAM / SP since the project started, whatever state they are in. Completed meters stay in this number; it never goes down when work is done."],
      rows: rows(matrix => `${count(matrix.assigned)} meters in ${batchesLabel(matrix.batches)}`),
      total: `Project total: ${count(totals.assigned)} meters`,
    };
    case "notStarted": return state("notStarted", "Not Started", "Meters assigned to this TEAM / SP where no field work has been recorded yet: no premise captured, no No Access recorded and no meter captured. They are neither in progress nor completed.");
    case "inProgress": return state("inProgress", "In Progress", "Meters where field work has begun but is not finished: the premise has been captured or No Access has been recorded, but the meter has not been captured yet.");
    case "completed": return state("completed", "Completed", "Meters that have been found and captured in the field (meter discovery done). This is finished work, and the Completed percentage shows how far this TEAM / SP is through the meters assigned to it.");
    case "projectShare": return {
      title: "Project Share",
      paragraphs: ["The part of all the meters handed out in this project that went to this TEAM / SP.", `Overall assigned in the project: ${count(totals.assigned)} meters.`],
      formula: "Project Share = this TEAM / SP's Meters Assigned ÷ Meters Assigned of all TEAMs and SPs together",
      rows: rows(matrix => `${count(matrix.assigned)} of ${count(totals.assigned)} = ${pct(matrix.projectSharePct)}`),
      total: "All TEAMs and SPs together: 100%",
    };
    case "projectedAssigned": return {
      title: "Projected Assigned",
      paragraphs: [`What Meters Assigned would become if the batch being allocated (${plural(incomingMeters, "meter")}) went to this TEAM / SP.`],
      formula: "Projected Assigned = Meters Assigned + the batch's meters",
      rows: rows(matrix => `${count(matrix.assigned)} + ${count(incomingMeters)} = ${count(Number(matrix.assigned || 0) + Number(incomingMeters || 0))}`),
    };
    case "projectedShare": return {
      title: "Projected Project Share",
      paragraphs: [`What Project Share would become if the batch being allocated (${plural(incomingMeters, "meter")}) went to this TEAM / SP.`],
      formula: "Projected Project Share = (Meters Assigned + the batch's meters) ÷ (project total + the batch's meters)",
      rows: rows(matrix => `(${count(matrix.assigned)} + ${count(incomingMeters)}) ÷ (${count(totals.assigned)} + ${count(incomingMeters)}) = ${pct(partOf(Number(matrix.assigned || 0) + Number(incomingMeters || 0), totals.assigned + Number(incomingMeters || 0)))}`),
    };
    default: return null;
  }
}
