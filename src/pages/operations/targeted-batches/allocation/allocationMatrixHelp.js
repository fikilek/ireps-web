// Targeted Batch rules TB-R045: what each Allocation Matrix column means, how it is worked out,
// and its number for every TEAM / SP shown, with the project total, so nobody doubts a figure.
import { splitHundredPercent } from "./allocationMatrixModel.js";
const count = value => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const pct = value => `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
const plural = (value, word) => `${count(value)} ${word}${Number(value) === 1 ? "" : "s"}`;
const batchesLabel = value => `${count(value)} batch${Number(value) === 1 ? "" : "es"}`;

function projectTotals(all = []) {
  const sum = key => all.reduce((total, organisation) => total + Number(organisation?.matrix?.[key] || 0), 0);
  const work = key => all.reduce((total, organisation) => total + Number(organisation?.fieldWork?.[key] || 0), 0);
  return { assigned: sum("assigned"), notStarted: sum("notStarted"), inProgress: sum("inProgress"), completed: sum("completed"), batches: sum("batches"), rejectedBatches: sum("rejectedBatches"),
    transactions: work("transactions"), noAccess: work("noAccess") };
}
const partOf = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const totalWorkOf = organisation => Number(organisation?.matrix?.completed || 0) + Number(organisation?.fieldWork?.transactions || 0);

export const MATRIX_COLUMN_KEYS = Object.freeze(["type", "name", "batches", "assigned", "notStarted", "inProgress", "completed", "batchesShare", "projectedAssigned", "projectedBatchesShare",
  "transactions", "noAccess", "transactionsShare", "totalWork", "totalWorkShare"]);

// Rules TB-R045 (1.3.27) and Teams rules TM-R001: how work outside batches is credited.
const CREDIT = ["Each record counts for the team the worker belonged to on the day of the work. When a worker moves to another team, the work they did before stays with the old team, and the new team starts afresh from the day they joined.",
  "Work by a worker who was in no team that day is shown on the \"(no team)\" row of the worker's service provider. Team membership has been recorded since 15 September 2026; the members at that date count from the day their team was created."];

export function matrixColumnHelp(key, { organisations = [], allOrganisations = organisations, incomingMeters = 0 } = {}) {
  const totals = projectTotals(allOrganisations);
  const totalWork = totals.completed + totals.transactions;
  const [notStartedPct, inProgressPct, completedPct] = splitHundredPercent([totals.notStarted, totals.inProgress, totals.completed]);
  const projectPct = { notStarted: notStartedPct, inProgress: inProgressPct, completed: completedPct };
  // Rows that only carry work outside batches have no batches, so batch columns leave them out.
  const rows = fn => organisations.filter(organisation => !organisation.fieldWorkOnly).map(organisation => [organisation.name, fn(organisation.matrix || {}, organisation)]);
  const workRows = fn => organisations.map(organisation => [organisation.name, fn(organisation.fieldWork || {}, organisation)]);
  const listed = type => allOrganisations.filter(item => item.type === type && !item.fieldWorkOnly).length;
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
      total: `TEAMs: ${count(listed("TEAM"))} · SPs: ${count(listed("SP"))}`,
    };
    case "name": return {
      title: "TEAM / SP",
      paragraphs: ["The TEAM or service provider the batches were allocated to, and how many people belong to it.",
        "A \"(no team)\" row holds the work outside batches of a service provider's workers who were in no team. A team that is no longer listed keeps its row for the work it did."],
      rows: workRows((_, organisation) => (organisation.noTeam ? plural(organisation.fieldWork?.workers?.length, "worker") + " in no team"
        : organisation.fieldWorkOnly ? "Not in the current TEAM list" : plural(organisation.memberCount, "member"))),
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
    case "batchesShare": return {
      title: "Batches Share",
      paragraphs: ["The part of all the meters handed out in batches that went to this TEAM / SP.", `Overall assigned in batches: ${count(totals.assigned)} meters.`],
      formula: "Batches Share = this TEAM / SP's Meters Assigned ÷ Meters Assigned of all TEAMs and SPs together",
      rows: rows(matrix => `${count(matrix.assigned)} of ${count(totals.assigned)} = ${pct(matrix.batchesSharePct)}`),
      total: "All TEAMs and SPs together: 100%",
    };
    case "projectedAssigned": return {
      title: "Projected Assigned",
      paragraphs: [`What Meters Assigned would become if the batch being allocated (${plural(incomingMeters, "meter")}) went to this TEAM / SP.`],
      formula: "Projected Assigned = Meters Assigned + the batch's meters",
      rows: rows(matrix => `${count(matrix.assigned)} + ${count(incomingMeters)} = ${count(Number(matrix.assigned || 0) + Number(incomingMeters || 0))}`),
    };
    case "projectedBatchesShare": return {
      title: "Projected Batches Share",
      paragraphs: [`What Batches Share would become if the batch being allocated (${plural(incomingMeters, "meter")}) went to this TEAM / SP.`],
      formula: "Projected Batches Share = (Meters Assigned + the batch's meters) ÷ (Meters Assigned of all TEAMs and SPs + the batch's meters)",
      rows: rows(matrix => `(${count(matrix.assigned)} + ${count(incomingMeters)}) ÷ (${count(totals.assigned)} + ${count(incomingMeters)}) = ${pct(partOf(Number(matrix.assigned || 0) + Number(incomingMeters || 0), totals.assigned + Number(incomingMeters || 0)))}`),
    };
    case "transactions": return {
      title: "Transactions (outside batches)",
      paragraphs: ["One total of every iREPS transaction done outside a batch (the normal path) where the worker had access: meter discoveries, installations, removals, disconnections, reconnections, commissioning, readings, inspections and any other kind. They are counted together; this table does not split them by kind.",
        "A visit where access was refused is not a transaction; it is counted in No Access. Work done in a batch is in Completed, not here, so nothing is counted twice.",
        "A job issued from the office counts only once it is completed, for the worker who completed it, on the day it was completed. A job that is issued or accepted but not done yet is not counted.", ...CREDIT],
      rows: workRows(work => plural(work.transactions, "transaction")),
      total: `Project: ${plural(totals.transactions, "transaction")} outside batches`,
    };
    case "noAccess": return {
      title: "No Access (outside batches)",
      paragraphs: ["Visits outside any batch where the worker could not get into the premise and recorded No Access, whatever transaction they had come to do. They are not counted in Transactions.", ...CREDIT],
      rows: workRows(work => plural(work.noAccess, "visit")),
      total: `Project: ${plural(totals.noAccess, "visit")} with No Access outside batches`,
    };
    case "transactionsShare": return {
      title: "Transactions Share",
      paragraphs: ["The part of all the transactions done outside batches that this TEAM / SP did.", `All transactions outside batches: ${count(totals.transactions)}.`],
      formula: "Transactions Share = this row's Transactions ÷ the Transactions of all rows",
      rows: workRows(work => `${count(work.transactions)} of ${count(totals.transactions)} = ${pct(work.transactionsSharePct)}`),
      total: "All rows together: 100%",
    };
    case "totalWork": return {
      title: "Total Work",
      paragraphs: ["All the work this TEAM / SP has done: the meters Completed in its batches plus the Transactions outside batches.",
        "No Access visits and batch meters not yet completed are not finished work, so they are not in Total Work."],
      formula: "Total Work = Completed (batches) + Transactions (outside batches)",
      rows: workRows((work, organisation) => `${count(organisation.matrix?.completed)} + ${count(work.transactions)} = ${count(totalWorkOf(organisation))}`),
      total: `Project: ${count(totals.completed)} + ${count(totals.transactions)} = ${count(totalWork)}`,
    };
    case "totalWorkShare": return {
      title: "Total Work Share",
      paragraphs: ["The part of all the work done, in batches and outside them, that this TEAM / SP did.", `All work done: ${count(totalWork)}.`],
      formula: "Total Work Share = this row's Total Work ÷ the Total Work of all rows",
      rows: workRows((work, organisation) => `${count(totalWorkOf(organisation))} of ${count(totalWork)} = ${pct(work.totalWorkSharePct)}`),
      total: "All rows together: 100%",
    };
    default: return null;
  }
}
