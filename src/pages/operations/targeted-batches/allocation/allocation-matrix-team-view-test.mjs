import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { addFieldWorkToMatrix, buildOrganisationAllocationMatrixResult, projectMatrixAllocation, splitHundredPercent } from "./allocationMatrixModel.js";
import { matrixColumnHelp, MATRIX_COLUMN_KEYS } from "./allocationMatrixHelp.js";

// Targeted Batch rules TB-R045: the Allocation Matrix TEAM / SP view.
// Numbers are shown in the viewer's own format, as the table does.
const n = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
function batch({ id, targetId = "KAISER", targetName = "Kaiser Team", totalRows, completedRows = 0, startedRows = completedRows, acceptance = "ACCEPTED", execution = "IN_PROGRESS" }) {
  return { id, source: { type: "PREPAID_SALES_NON_GPS" }, creation: { state: "READY", expectedRows: totalRows }, status: "ALLOCATED",
    allocation: { status: "ALLOCATED", targetType: "TEAM", targetId, targetName }, acceptance: { status: acceptance }, execution: { status: execution },
    counts: { totalRows, allocatedRows: totalRows, unallocatedRows: 0, completedRows, executionStartedRows: startedRows } };
}
function rowsFor(item) {
  return Array.from({ length: item.counts.totalRows }, (_, index) => ({ id: `${item.id}_${index}`, tbId: item.id,
    allocation: { status: "ALLOCATED", targetType: "TEAM", targetId: item.allocation.targetId }, execution: { status: "NOT_STARTED" } }));
}
const teams = [{ id: "KAISER", name: "Kaiser Team", memberCount: 2, status: "ACTIVE" }, { id: "SIMO", name: "Simo Team", memberCount: 1, status: "ACTIVE" }];

test("three numbers make up Meters Assigned, their percentages make exactly 100%, and Progress is Completed %", () => {
  assert.deepEqual(splitHundredPercent([1, 1, 1]), [33.4, 33.3, 33.3], "never 99.9%");
  assert.deepEqual(splitHundredPercent([0, 0, 0]), [0, 0, 0]);
  const batches = [batch({ id: "B1", totalRows: 248, completedRows: 142, startedRows: 170 }), batch({ id: "B2", targetId: "SIMO", targetName: "Simo Team", totalRows: 180, completedRows: 148, startedRows: 160 })];
  const { organisations } = buildOrganisationAllocationMatrixResult({ batches, rows: batches.flatMap(rowsFor), teams });
  const kaiser = organisations.find(item => item.id === "KAISER").matrix;
  assert.deepEqual([kaiser.assigned, kaiser.notStarted, kaiser.inProgress, kaiser.completed], [248, 78, 28, 142]);
  assert.equal(kaiser.notStarted + kaiser.inProgress + kaiser.completed, kaiser.assigned);
  assert.equal(Math.round((kaiser.notStartedPct + kaiser.inProgressPct + kaiser.completedPct) * 10), 1000);
  assert.equal(kaiser.completedPct, 57.3, "142 ÷ 248");
  const shares = organisations.map(item => item.matrix.projectSharePct);
  assert.equal(Math.round(shares.reduce((sum, value) => sum + value, 0) * 10), 1000, "Project Shares add up to 100%");
  assert.equal(kaiser.projectSharePct, 57.9, "248 ÷ 428");
});

test("a rejected batch is left out of the TEAM's numbers and counted as rejected", () => {
  const batches = [batch({ id: "B1", totalRows: 10, completedRows: 4 }), batch({ id: "B2", totalRows: 6, acceptance: "REJECTED", execution: "NOT_STARTED" })];
  const kaiser = buildOrganisationAllocationMatrixResult({ batches, rows: batches.flatMap(rowsFor), teams }).organisations.find(item => item.id === "KAISER");
  assert.deepEqual([kaiser.matrix.batches, kaiser.matrix.rejectedBatches, kaiser.matrix.assigned, kaiser.matrix.notStarted], [1, 1, 10, 6]);
  assert.equal(kaiser.assignedMeters, 16, "the Allocate page's own numbers are unchanged");
});

test("the allocation preview adds the batch's meters to Meters Assigned and the project total", () => {
  const organisations = [{ id: "A", eligible: true, matrix: { assigned: 248 } }, { id: "B", eligible: true, matrix: { assigned: 700 } }];
  assert.deepEqual(projectMatrixAllocation({ organisation: organisations[0], allOrganisations: organisations, incomingMeters: 30 }),
    { incomingMeters: 30, projectAssigned: 948, projectedAssigned: 278, projectedProjectSharePct: 28.4 });
  assert.equal(projectMatrixAllocation({ organisation: { ...organisations[0], eligible: false }, allOrganisations: organisations, incomingMeters: 30 }), null);
  assert.equal(projectMatrixAllocation({ organisation: organisations[0], allOrganisations: organisations, incomingMeters: 0 }), null);
});

test("every '?' explains the column with each TEAM's own numbers and the project total", () => {
  const organisations = [
    { name: "Kaiser Team", type: "TEAM", memberCount: 2, matrix: { batches: 16, rejectedBatches: 0, assigned: 248, notStarted: 78, inProgress: 28, completed: 142, notStartedPct: 31.5, inProgressPct: 11.3, completedPct: 57.2, projectSharePct: 26.2 } },
    { name: "Magubane Team", type: "TEAM", memberCount: 2, matrix: { batches: 16, rejectedBatches: 1, assigned: 700, notStarted: 342, inProgress: 0, completed: 358, notStartedPct: 48.9, inProgressPct: 0, completedPct: 51.1, projectSharePct: 73.8 } },
  ];
  for (const key of MATRIX_COLUMN_KEYS) {
    const help = matrixColumnHelp(key, { organisations, incomingMeters: 30 });
    assert.ok(help.title && help.paragraphs.length && help.rows.length === 2, key);
  }
  const assigned = matrixColumnHelp("assigned", { organisations });
  assert.deepEqual(assigned.rows[0], ["Kaiser Team", "248 meters in 16 batches"]); assert.equal(assigned.total, "Project total: 948 meters");
  assert.deepEqual(matrixColumnHelp("projectShare", { organisations }).rows[0], ["Kaiser Team", `248 of 948 = ${n(26.2)}%`]);
  assert.match(matrixColumnHelp("projectShare", { organisations }).paragraphs[1], /Overall assigned in the project: 948 meters/);
  assert.deepEqual(matrixColumnHelp("notStarted", { organisations }).rows[0], ["Kaiser Team", `78 of 248 = ${n(31.5)}%`]);
  assert.match(matrixColumnHelp("notStarted", { organisations }).paragraphs[0], /no premise captured, no No Access recorded and no meter captured/);
  assert.match(matrixColumnHelp("inProgress", { organisations }).paragraphs[0], /premise has been captured or No Access has been recorded, but the meter has not been captured yet/);
  assert.equal(matrixColumnHelp("progress", { organisations }), null, "Progress was removed (1.3.24); Completed % shows it");
  assert.match(matrixColumnHelp("completed", { organisations }).paragraphs[0], /shows how far this TEAM \/ SP is through the meters assigned to it/);
  assert.deepEqual(matrixColumnHelp("batches", { organisations }).rows[1], ["Magubane Team", "16 batches · 1 rejected, left out"]);
  assert.deepEqual(matrixColumnHelp("projectedShare", { organisations, incomingMeters: 30 }).rows[0], ["Kaiser Team", `(248 + 30) ÷ (948 + 30) = ${n(28.4)}%`]);
  assert.equal(matrixColumnHelp("unknown", { organisations }), null);
});

test("the page shows the new columns with a '?' on every heading, and the removed ones are gone", async () => {
  const page = await readFile(new URL("../../TargetedBatchAllocationMatrixPage.jsx", import.meta.url), "utf8");
  const headings = [...page.matchAll(/<Th help="([a-zA-Z]+)" onHelp=\{setHelpKey\}(?: divider)?>([^<]+)<\/Th>/g)].map(match => [match[1], match[2]]);
  assert.deepEqual(headings, [["type", "Type"], ["name", "TEAM / SP"], ["batches", "Batches"], ["assigned", "Meters Assigned"], ["notStarted", "Not Started"], ["inProgress", "In Progress"],
    ["completed", "Completed"], ["projectShare", "Project Share"], ["projectedAssigned", "Projected Assigned"], ["projectedShare", "Projected Project Share"],
    ["discovered", "Meters Discovered"], ["noAccess", "No Access"], ["otherWork", "Other Work"], ["allDiscovered", "All Meters Discovered"]]);
  assert.deepEqual(headings.map(([key]) => key), [...MATRIX_COLUMN_KEYS], "every column has its '?' window");
  for (const band of ["Batches (sales path)", "Outside batches (normal path)", "All Work"]) assert.match(page, new RegExp(`>${band.replace(/[()]/g, "\\$&")}</th>`), band);
  assert.match(page, /<Th help="discovered" onHelp=\{setHelpKey\} divider>/, "a divider starts each group");
  assert.match(page, /useGetFieldWorkSummaryByLmQuery\(\s*matrixLmPcode \? \{ lmPcode: matrixLmPcode \} : skipToken,\s*\)/, "the totals come from the server, never the field work records");
  for (const removed of [">Progress</Th>", "Eligibility", "Active Open", "Rejected / Unresolved", "Eligible Type Avg", "Vs Type Avg", "Integrity</Th>", "Two truths are kept separate", "Historically Assigned"]) assert.doesNotMatch(page, new RegExp(removed.replace("/", "\\/")), removed);
  assert.match(page, /<CountPercent count=\{matrix\.notStarted\} percent=\{matrix\.notStartedPct\} \/>/);
  assert.match(page, /setTimeout\(onOpen, HELP_HOVER_DELAY_MS\)/, "resting the pointer opens the window");
  assert.match(page, /if \(event\.key === "Escape"\) onClose\(\);/);
  assert.match(page, /Allocation integrity warning/, "the warning about inconsistent batches stays");
  for (const card of ["TEAMs / SPs", "Meters Assigned", "Not Started", "In Progress", "Completed", "All Meters Discovered"]) assert.match(page, new RegExp(`label="${card.replace("/", "\\/")}"`));
});

// Rules TB-R045 (1.3.25) and Teams rules TM-R001: work outside batches.
const groups = [
  { key: "TEAM:KAISER", type: "TEAM", teamId: "KAISER", name: "Kaiser Team", discovered: 30, noAccess: 4, other: 3, otherByType: { METER_RECONNECTION: 2, METER_DISCONNECTION: 1 }, workers: ["Peter Peter"] },
  { key: "TEAM:GONE", type: "TEAM", teamId: "GONE", name: "Old Team", discovered: 5, noAccess: 0, other: 0, otherByType: {}, workers: ["Zamo Ngubs"] },
  { key: "NO_TEAM:RSTE", type: "NO_TEAM", spId: "RSTE", name: "RSTE (no team)", discovered: 7, noAccess: 1, other: 0, otherByType: {}, workers: ["Muzi Muzi", "Siya Siya"] },
];

test("work outside batches joins its TEAM's row; no-team work and teams no longer listed get their own rows", () => {
  const batches = [batch({ id: "B1", totalRows: 10, completedRows: 4 })];
  const { organisations } = buildOrganisationAllocationMatrixResult({ batches, rows: batches.flatMap(rowsFor), teams });
  const rows = addFieldWorkToMatrix(organisations, groups);
  const byKey = Object.fromEntries(rows.map(row => [row.key, row]));
  assert.deepEqual([byKey["TEAM:KAISER"].fieldWork.discovered, byKey["TEAM:KAISER"].fieldWork.noAccess, byKey["TEAM:KAISER"].fieldWork.other], [30, 4, 3]);
  assert.equal(byKey["TEAM:KAISER"].fieldWork.allDiscovered, 34, "4 Completed in batches + 30 discovered outside batches");
  assert.equal(byKey["TEAM:KAISER"].fieldWorkOnly, undefined, "a listed TEAM keeps its batch numbers");
  assert.deepEqual([byKey["TEAM:SIMO"].fieldWork.discovered, byKey["TEAM:SIMO"].fieldWork.allDiscovered], [0, 0]);
  assert.deepEqual([byKey["TEAM:GONE"].fieldWorkOnly, byKey["TEAM:GONE"].eligible, byKey["TEAM:GONE"].name, byKey["TEAM:GONE"].fieldWork.allDiscovered], [true, false, "Old Team", 5]);
  assert.deepEqual([byKey["NO_TEAM:RSTE"].type, byKey["NO_TEAM:RSTE"].noTeam, byKey["NO_TEAM:RSTE"].name, byKey["NO_TEAM:RSTE"].matrix.assigned], ["SP", true, "RSTE (no team)", 0]);
  assert.equal(projectMatrixAllocation({ organisation: byKey["NO_TEAM:RSTE"], allOrganisations: rows, incomingMeters: 30 }), null, "a (no team) row cannot be allocated a batch");
  assert.equal(organisations.find(item => item.key === "TEAM:KAISER").fieldWork, undefined, "the batch numbers are not changed");
  assert.deepEqual(addFieldWorkToMatrix(organisations, []).map(row => row.key), organisations.map(row => row.key), "before the totals arrive the rows are the same");
});

test("each '?' of work outside batches explains how work is credited, with each row's numbers", () => {
  const batches = [batch({ id: "B1", totalRows: 10, completedRows: 4 })];
  const rows = addFieldWorkToMatrix(buildOrganisationAllocationMatrixResult({ batches, rows: batches.flatMap(rowsFor), teams }).organisations, groups);
  const help = key => matrixColumnHelp(key, { organisations: rows, allOrganisations: rows });
  const row = (key, name) => help(key).rows.find(([rowName]) => rowName === name)[1];
  assert.equal(row("discovered", "Kaiser Team"), "30 meters"); assert.equal(help("discovered").total, "Project: 42 meters discovered outside batches");
  assert.match(help("discovered").paragraphs.join(" "), /nothing is counted twice.*the work they did before stays with the old team, and the new team starts afresh/);
  assert.match(help("noAccess").paragraphs.join(" "), /"\(no team\)" row of the worker's service provider/);
  assert.equal(row("noAccess", "RSTE (no team)"), "1 visit");
  assert.equal(row("otherWork", "Kaiser Team"), "3 (Meter disconnection 1, Meter reconnection 2)");
  assert.equal(row("allDiscovered", "Kaiser Team"), "4 + 30 = 34"); assert.equal(help("allDiscovered").total, "Project: 4 + 42 = 46 meters");
  assert.equal(row("name", "RSTE (no team)"), "2 workers in no team"); assert.equal(row("name", "Old Team"), "Not in the current TEAM list");
  assert.equal(help("assigned").rows.some(([name]) => name === "RSTE (no team)"), false, "batch columns leave out rows without batches");
  assert.equal(help("type").total, "TEAMs: 2 · SPs: 0", "only listed TEAMs and SPs are counted");
});
