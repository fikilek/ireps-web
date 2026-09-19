// Targeted Batch rules 1.3.52, TB-R056: a batch row follows its Sales meter. Every branch of the pure policy.
import test from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { becameVisible, countRowsTakenOut, decideRowFollowsSales, buildRowFollowsSalesWrites, parentAfter, parentState, rowState, executionFallback, establishFinder, isOwnFind,
  runIdOf, DECISIONS, OUTCOME, RULE } from "../targetedBatches/rowFollowsSales.js";
import { inspectSalesTbRefsIntegrity } from "../salesAllMeters/sales-batch-policy.js";

const TB = "TGB_20260913_120000_AB12";
const SALES = "07000000001";
const CREATED = Timestamp.fromMillis(Date.parse("2026-09-13T12:00:00Z"));
const ALLOCATED_AT = Timestamp.fromMillis(Date.parse("2026-09-14T08:00:00Z"));
const FIND_AT = "2026-09-18T09:30:00.000Z";
const FIND_MS = Date.parse(FIND_AT);
const TRN = "TRN_MDIS_1789000000000_FIND1";
const ts = ms => Timestamp.fromMillis(ms);
const NOW = Timestamp.fromMillis(Date.parse("2026-09-19T10:00:00Z"));
const SERVER = { serverTimestamp: true };
const options = { ts, now: NOW, serverTime: SERVER };

const rowOf = (n, salesId, extra = {}) => ({ id: `TBR_20260913_120000_AB12_00000${n}`, tbId: TB, rowNo: n, schemaVersion: "0.3.0", salesAllMeterId: salesId,
  meter: { numberNormalized: salesId, numberRaw: salesId }, decision: { status: "ACCEPT" },
  allocation: { allocatable: true, status: "ALLOCATED", targetType: "TEAM", targetId: "TEAM1" },
  execution: { status: "NOT_STARTED", startedAt: null, completedAt: null, outcome: null }, refs: { erfId: "ERF1", premiseId: null, meterId: null, trnId: null }, ...extra });

// A three-meter 0.3.0 batch, allocated to TEAM1 and accepted; meter SALES (row 1) became Visible, found by FWR1 of TEAM1.
function facts(over = {}) {
  const rows = [rowOf(1, SALES), rowOf(2, "07000000002"), rowOf(3, "07000000003")];
  return {
    salesId: SALES,
    sales: { master: { id: SALES, visibility: "VISIBLE" }, targetedBatchId: TB, tbRefs: [{ id: TB, date: CREATED }], erfId: "ERF1",
      metadata: { createdAt: CREATED, createdByUid: "ORIGINAL", createdByUser: "Original", updatedAt: CREATED, updatedByUid: "ORIGINAL", updatedByUser: "Original" } },
    parent: { id: TB, schemaVersion: "0.3.0", status: "ALLOCATED", geofenceId: "GF1", source: { type: "PREPAID_SALES" }, creation: { state: "READY", createdRows: 3, expectedRows: 3 },
      allocation: { status: "ALLOCATED", targetType: "TEAM", targetId: "TEAM1", targetName: "Team One", completedAt: ALLOCATED_AT },
      acceptance: { status: "ACCEPTED" }, execution: { status: "NOT_STARTED", startedAt: null, completedAt: null },
      counts: { totalRows: 3, acceptedRows: 3, rejectedRows: 0, allocatableRows: 3, allocatedRows: 3, unallocatedRows: 0, executionStartedRows: 0, completedRows: 0 },
      metadata: { createdAt: CREATED } },
    rows,
    meterMaster: { refs: { asts: { id: TRN }, sales: { id: SALES } } },
    ast: { id: TRN, trnId: TRN, metadata: { createdAt: FIND_AT, createdByUid: "FWR1", createdByUser: "Field Worker" } },
    trn: { id: TRN, accessData: { trnType: "METER_DISCOVERY", access: { hasAccess: "yes" }, premise: { id: "PREM1" }, erfId: "ERF1" }, ast: { astData: { astNo: SALES } } },
    finderProfile: { profile: { displayName: "Field Worker" }, employment: { role: "FWR", serviceProvider: { id: "SP1" } } },
    memberHistory: [{ id: "TEAM1__FWR1__1", teamId: "TEAM1", teamName: "Team One", userUid: "FWR1", joinedAt: "2026-09-01T00:00:00.000Z", leftAt: null }],
    history: { rowClosed: false, rowRemoved: false, salesRemoved: false, batchDeleted: false },
    namedByOthers: null,
    pointing: { trnIds: [], premiseIds: [] },
    ...over,
  };
}
const decide = over => decideRowFollowsSales(facts(over));
const code = over => decide(over).code;
const withParent = (patch, over = {}) => { const f = facts(over); return { ...f, parent: { ...f.parent, ...patch } }; };
const unallocated = () => ({ status: "NOT_STARTED", completedAt: null });

test("the trigger runs only when master.visibility changes to VISIBLE", () => {
  assert.equal(becameVisible({ master: { visibility: "INVISIBLE" } }, { master: { visibility: "VISIBLE" } }), true);
  assert.equal(becameVisible(undefined, { master: { visibility: "VISIBLE" } }), true);
  assert.equal(becameVisible({}, { master: { visibility: "VISIBLE" } }), true);
  assert.equal(becameVisible({ master: { visibility: "VISIBLE" } }, { master: { visibility: "VISIBLE" } }), false, "its own Sales write (VISIBLE -> VISIBLE) does nothing");
  assert.equal(becameVisible({ master: { visibility: "VISIBLE" } }, { master: { visibility: "INVISIBLE" } }), false);
  assert.equal(becameVisible({ master: { visibility: "INVISIBLE" } }, undefined), false);
});

test("option A counts only rows TB-R053 or TB-R056 took out, once each", () => {
  assert.equal(countRowsTakenOut([]), 0);
  assert.equal(countRowsTakenOut([
    { event: "TARGETED_BATCH_ROW_REMOVED", rowId: "R1", rule: RULE, runId: runIdOf("T1") },
    { event: "TARGETED_BATCH_ROW_REMOVED", rowId: "R2", runId: "CLEANUP2_20260919T080000" },
    { event: "TARGETED_BATCH_ROW_REMOVED", rowId: "R2", runId: "CLEANUP2_20260919T090000" },
    { event: "TARGETED_BATCH_ROW_REMOVED", rowId: "R3", runId: "DEDUPE_20260916T080000" },
    { event: "TARGETED_BATCH_ROW_CLOSED", rowId: "R4", rule: RULE },
    { event: "TARGETED_BATCH_UNALLOCATED" },
  ]), 2);
});

test("nothing happens when the meter is not visible, in no batch, or its row is already completed", () => {
  assert.equal(code({ sales: { ...facts().sales, master: { visibility: "INVISIBLE" } } }), "NOT_VISIBLE");
  assert.equal(decide({ sales: { ...facts().sales, targetedBatchId: null } }).decision, DECISIONS.NONE);
  assert.equal(code({ sales: { ...facts().sales, targetedBatchId: null } }), "NO_BATCH");
  const noRefs = { ...facts().sales, tbRefs: [] }; delete noRefs.targetedBatchId;
  assert.equal(code({ sales: noRefs }), "NO_BATCH", "a legacy record without references is in no batch");
  const rows = facts().rows; rows[0] = { ...rows[0], execution: { status: "COMPLETED" } };
  const done = decide({ rows });
  assert.deepEqual([done.decision, done.code], [DECISIONS.NONE, "ROW_ALREADY_COMPLETED"], "a sales-path find already completed the row");
});

test("anything it cannot decide is logged and nothing is written", () => {
  const logged = over => { const r = decide(over); assert.equal(r.decision, DECISIONS.LOG, JSON.stringify(r)); return r.code; };
  assert.equal(logged({ sales: null }), "SALES_MISSING");
  assert.equal(logged({ sales: { ...facts().sales, targetedBatchId: "BAD" } }), "MEMBERSHIP_UNRESOLVED");
  const two = { ...facts().sales, tbRefs: [{ id: TB, date: CREATED }, { id: "TGB_20260913_120001_AB13", date: CREATED }] }; delete two.targetedBatchId;
  assert.equal(logged({ sales: two }), "MEMBERSHIP_UNRESOLVED");
  assert.equal(logged({ parent: null }), "PARENT_MISSING");
  assert.equal(logged({ rows: facts().rows.slice(1) }), "ROW_MISSING");
  assert.equal(logged({ rows: [...facts().rows, { ...rowOf(4, SALES), id: "TBR_X" }] }), "ROW_DUPLICATE");
  assert.equal(logged({ rows: [{ ...facts().rows[0], idConflict: true }, ...facts().rows.slice(1)] }), "ROW_IDENTITY");
  assert.equal(logged({ rows: [{ ...facts().rows[0], execution: { status: "ODD" } }, ...facts().rows.slice(1)] }), "ROW_STATUS_UNKNOWN");
  for (const key of ["rowClosed", "rowRemoved", "salesRemoved"]) assert.equal(logged({ history: { ...facts().history, [key]: true } }), "HISTORY_EXISTS", key);
  assert.equal(logged({ sales: { ...facts().sales, tbRefs: [{ id: TB, date: CREATED, stray: 1 }] } }), "TBREF_INVALID");
  assert.equal(logged({ sales: { ...facts().sales, tbRefs: [] } }), "TBREF_INVALID", "a scalar member without its reference");
  assert.equal(logged({ sales: { ...facts().sales, metadata: { createdAt: CREATED } } }), "SALES_METADATA_INVALID");
  assert.equal(logged(withParent({ allocation: { status: "ALLOCATING" } })), "ALLOCATION_STATE_UNCLEAR");
  assert.equal(logged(withParent({ allocation: { status: "ALLOCATED", targetType: "WARD", targetId: "X" } })), "ALLOCATION_TARGET_UNKNOWN");
  assert.equal(logged(withParent({ allocation: { status: "ALLOCATED", targetType: "TEAM" } })), "ALLOCATION_TARGET_UNKNOWN");
});

test("the finder cannot be established: nothing changes", () => {
  const finder = over => { const r = decide(over); assert.equal(r.decision, DECISIONS.LOG); return `${r.code}:${r.detail}`; };
  assert.equal(finder({ meterMaster: null }), "FINDER_UNKNOWN:NO_FIELD_RECORD");
  assert.equal(finder({ meterMaster: { refs: { asts: { id: "" } } } }), "FINDER_UNKNOWN:NO_FIELD_RECORD");
  assert.equal(finder({ ast: null }), "FINDER_UNKNOWN:AST_MISSING");
  assert.equal(finder({ ast: { ...facts().ast, trnId: "TRN_OTHER" } }), "FINDER_UNKNOWN:AST_TRN_ID_DIFFERS");
  assert.equal(finder({ trn: null }), "FINDER_UNKNOWN:TRN_MISSING");
  assert.equal(finder({ ast: { ...facts().ast, metadata: { ...facts().ast.metadata, createdByUid: "SYSTEM" } } }), "FINDER_UNKNOWN:NO_CREATOR");
  assert.equal(finder({ ast: { ...facts().ast, metadata: { ...facts().ast.metadata, createdAt: "not a date" } } }), "FIND_TIME_UNKNOWN:FIND_TIME_UNKNOWN");
  assert.equal(finder({ memberHistory: [], finderProfile: { profile: { displayName: "X" }, employment: { role: "FWR" } } }), "FINDER_UNKNOWN:NO_TEAM_OR_SERVICE_PROVIDER", "a worker in no team and no service provider");
  assert.equal(finder({ finderProfile: null }), "FINDER_UNKNOWN:FINDER_PROFILE_INCOMPLETE", "the history must name the finder's role");
  // Unallocated batches too: the history names the find's TRN and the finder.
  assert.equal(finder({ ...withParent({ allocation: unallocated() }), meterMaster: null }), "FINDER_UNKNOWN:NO_FIELD_RECORD");
});

test("the finder's team is the one on the find date (TM-R001); the service provider comes from the profile", () => {
  const f = facts({ memberHistory: [
    { teamId: "TEAM1", teamName: "Team One", userUid: "FWR1", joinedAt: "2026-09-01T00:00:00.000Z", leftAt: "2026-09-10T00:00:00.000Z" },
    { teamId: "TEAM2", teamName: "Team Two", userUid: "FWR1", joinedAt: "2026-09-10T00:00:00.000Z", leftAt: null },
  ] });
  const who = establishFinder(f);
  assert.deepEqual([who.ok, who.finder.teamId, who.finder.spId, who.findAtMs, who.trnId], [true, "TEAM2", "SP1", FIND_MS, TRN]);
  assert.equal(isOwnFind({ type: "TEAM", id: "TEAM2" }, who.finder), true);
  assert.equal(isOwnFind({ type: "TEAM", id: "TEAM1" }, who.finder), false);
  assert.equal(isOwnFind({ type: "SP", id: "SP1" }, who.finder), true);
  assert.equal(isOwnFind({ type: "TEAM", id: "TEAM1" }, { teamId: null, spId: "TEAM1" }), false);
  const r = decideRowFollowsSales(f);
  assert.deepEqual([r.decision, r.reason], [DECISIONS.REMOVE, "FOUND_BY_ANOTHER_TEAM"], "the worker had moved to another team by the find date");
});

test("found by the batch's own team: the row closes as Completed", () => {
  const r = decide();
  assert.deepEqual([r.decision, r.code, r.tbId, r.rowId, r.trnId, r.astId, r.premiseId, r.meterMatch, r.premiseKept, r.runId], [DECISIONS.CLOSE, "FOUND_BY_BATCH_TEAM", TB, rowOf(1).id, TRN, TRN, "PREM1", true, false, `TB-R056:${TRN}`]);
  assert.deepEqual([r.after.action, r.after.status, r.after.execution.status, r.after.execution.startedAt, r.after.counts.completedRows, r.after.counts.executionStartedRows], ["UPDATE", "IN_PROGRESS", "IN_PROGRESS", FIND_MS, 1, 1]);
  // Whenever found (before the batch reached the team) and on any ERF.
  const early = decide({ ast: { ...facts().ast, metadata: { ...facts().ast.metadata, createdAt: "2026-09-05T09:00:00.000Z" } } });
  assert.equal(early.decision, DECISIONS.CLOSE);
  const otherErf = decide({ trn: { ...facts().trn, accessData: { ...facts().trn.accessData, erfId: "ERF9" } } });
  assert.deepEqual([otherErf.decision, otherErf.foundOnOtherErf], [DECISIONS.CLOSE, true]);
  // The batch's own service provider.
  const sp = decideRowFollowsSales(withParent({ allocation: { status: "ALLOCATED", targetType: "SP", targetId: "SP1", completedAt: ALLOCATED_AT } }, { memberHistory: [] }));
  assert.deepEqual([sp.decision, sp.finder.spId, sp.finder.teamId], [DECISIONS.CLOSE, "SP1", null]);
});

test("a close keeps a premise the row already had and started work", () => {
  const rows = facts().rows;
  rows[0] = { ...rows[0], execution: { status: "IN_PROGRESS", startedAt: ts(Date.parse("2026-09-17T08:00:00Z")), completedAt: null, outcome: null }, refs: { ...rows[0].refs, premiseId: "PREM_ROW" } };
  const sales = { ...facts().sales, tbRefs: [{ id: TB, date: CREATED, rowId: rows[0].id, fieldWork: { status: "IN_PROGRESS", premiseId: "PREM_ROW", updatedAt: CREATED, noAccess: [{ date: "2026-09-16", time: "08:00:00", user: "Field Worker" }] } }] };
  const parent = { ...facts().parent, status: "IN_PROGRESS", execution: { status: "IN_PROGRESS", startedAt: ts(Date.parse("2026-09-17T08:00:00Z")), completedAt: null }, counts: { ...facts().parent.counts, executionStartedRows: 1 } };
  const f = facts({ rows, sales, parent });
  const r = decideRowFollowsSales(f);
  assert.deepEqual([r.decision, r.premiseId, r.premiseKept, r.findPremiseId], [DECISIONS.CLOSE, "PREM_ROW", true, "PREM1"]);
  const writes = buildRowFollowsSalesWrites(r, f, options);
  const row = writes.find(w => w.path === `tb_rows/${rows[0].id}`).data;
  assert.equal(row["refs.premiseId"], "PREM_ROW");
  assert.equal(row["execution.startedAt"], rows[0].execution.startedAt, "startedAt kept");
  const ref = writes.find(w => w.path === `sales-all-meters/${SALES}`).data.tbRefs[0];
  assert.deepEqual(ref.fieldWork.noAccess, sales.tbRefs[0].fieldWork.noAccess, "No Access visits kept");
  assert.equal(ref.fieldWork.premiseId, "PREM_ROW");
  assert.equal(ref.fieldWork.submittedAt.toMillis(), FIND_MS);
  const parentPatch = writes.find(w => w.path === `tb_uploads/${TB}`).data;
  assert.equal(parentPatch["execution.startedAt"], parent.execution.startedAt, "the batch start is kept (same Timestamp object)");
});

test("the close writes exactly what a batch completion writes, plus its history", () => {
  const f = facts();
  const r = decideRowFollowsSales(f);
  const writes = buildRowFollowsSalesWrites(r, f, options);
  assert.deepEqual(writes.map(w => `${w.op} ${w.path}`), [`update tb_rows/${rowOf(1).id}`, `update sales-all-meters/${SALES}`, `update trns/${TRN}`, `update tb_uploads/${TB}`, `create tb_uploads/${TB}/history/ROW_CLOSED__${rowOf(1).id}`]);
  const [row, sales, trn, parent, history] = writes.map(w => w.data);
  assert.deepEqual({ ...row, "execution.startedAt": row["execution.startedAt"].toMillis(), "execution.completedAt": row["execution.completedAt"].toMillis() }, {
    "execution.status": "COMPLETED", "execution.startedAt": FIND_MS, "execution.completedAt": FIND_MS, "execution.outcome": OUTCOME,
    "refs.premiseId": "PREM1", "refs.meterId": TRN, "refs.trnId": TRN, "metadata.updatedAt": SERVER, "metadata.updatedByUid": "FWR1", "metadata.updatedByUser": "Field Worker" });
  assert.equal(Object.hasOwn(sales, "targetedBatchId"), false, "closing keeps the scalar");
  assert.deepEqual([sales["metadata.updatedAt"], sales["metadata.updatedByUid"], sales["metadata.updatedByUser"]], [SERVER, "FWR1", "Field Worker"]);
  assert.equal(inspectSalesTbRefsIntegrity(sales.tbRefs).valid, true);
  const fw = sales.tbRefs[0].fieldWork;
  assert.deepEqual([sales.tbRefs[0].rowId, fw.status, fw.outcomeCode, fw.outcomeLabel, fw.targetedMeterNo, fw.discoveredMeterNo, fw.meterMatch, fw.premiseId, fw.meterId, fw.trnId, fw.updatedAt],
    [rowOf(1).id, "COMPLETED", "METER_DISCOVERED", "Meter Discovered", SALES, SALES, true, "PREM1", TRN, TRN, NOW]);
  assert.deepEqual(trn, { "derived.targetedBatch": { tbId: TB, rowId: rowOf(1).id, salesDocId: SALES, premiseId: "PREM1", meterId: TRN, trnId: TRN, meterMatch: true, batchCompleted: false } });
  assert.deepEqual([parent.status, parent["execution.status"], parent["execution.startedAt"].toMillis(), parent["execution.completedAt"], parent["counts.completedRows"], parent["counts.executionStartedRows"], parent["counts.totalRows"], parent["metadata.updatedByUid"]],
    ["IN_PROGRESS", "IN_PROGRESS", FIND_MS, null, 1, 1, 3, "FWR1"]);
  assert.equal(Object.keys(parent).some(k => k.startsWith("allocation") || k.startsWith("acceptance") || k.startsWith("creation")), false, "allocation, acceptance and creation never change");
  assert.deepEqual([history.event, history.rule, history.runId, history.trnId, history.finder.teamId, history.finder.uid, history.statusBefore.status, history.statusAfter.status, history.countsAfter.completedRows, history.rowAfter.execution.outcome],
    ["TARGETED_BATCH_ROW_CLOSED", "TB-R056", `TB-R056:${TRN}`, TRN, "TEAM1", "FWR1", "ALLOCATED", "IN_PROGRESS", 1, OUTCOME]);
  assert.equal(writes.some(w => w.path.includes("batchHistory")), false, "closing a row writes no Sales event");
});

test("the last open row closing completes the batch and marks the TRN batchCompleted", () => {
  const f = facts();
  const done = ms => ({ status: "COMPLETED", startedAt: ts(ms), completedAt: ts(ms), outcome: "METER_DISCOVERED" });
  f.rows = [f.rows[0], { ...f.rows[1], execution: done(Date.parse("2026-09-15T08:00:00Z")) }, { ...f.rows[2], execution: done(Date.parse("2026-09-16T08:00:00Z")) }];
  f.parent = { ...f.parent, status: "IN_PROGRESS", execution: { status: "IN_PROGRESS", startedAt: ts(Date.parse("2026-09-15T08:00:00Z")), completedAt: null }, counts: { ...f.parent.counts, executionStartedRows: 2, completedRows: 2 } };
  const r = decideRowFollowsSales(f);
  assert.deepEqual([r.decision, r.after.status, r.after.execution.completedAt], [DECISIONS.CLOSE, "COMPLETED", FIND_MS]);
  const trn = buildRowFollowsSalesWrites(r, f, options).find(w => w.path === `trns/${TRN}`).data;
  assert.equal(trn["derived.targetedBatch"].batchCompleted, true);
});

// Rules 1.3.56 (owner, 2026-09-19): a Meter Installation by the batch's own team closes the row too, with its own row outcome;
// the Sales tbRef is completed exactly as for a discovery, so it stays valid.
test("an installation by the batch's own team closes the row as Completed, with its own outcome", () => {
  const base = facts();
  const f = facts({ trn: { ...base.trn, accessData: { ...base.trn.accessData, trnType: "METER_INSTALLATION" } } });
  const r = decideRowFollowsSales(f);
  assert.equal(r.decision, DECISIONS.CLOSE, JSON.stringify(r));
  assert.equal(r.findType, "METER_INSTALLATION");
  const writes = buildRowFollowsSalesWrites(r, f, options);
  const row = writes.find(w => w.path.startsWith("tb_rows/")).data;
  assert.equal(row["execution.status"], "COMPLETED");
  assert.equal(row["execution.outcome"], "METER_INSTALLED_OUTSIDE_BATCH");
  const sales = writes.find(w => w.path.startsWith("sales-all-meters/")).data;
  const ref = sales.tbRefs.find(x => x.id === TB);
  assert.equal(ref.fieldWork.outcomeCode, "METER_DISCOVERED");
  assert.equal(inspectSalesTbRefsIntegrity(sales.tbRefs).valid, true);
  const history = writes.find(w => w.path.includes("/history/ROW_CLOSED__")).data;
  assert.equal(history.findType, "METER_INSTALLATION");
  assert.equal(history.rowAfter.execution.outcome, "METER_INSTALLED_OUTSIDE_BATCH");
  assert.match(history.note, /Meter Installation/);
  // A discovery keeps its own outcome.
  const d = decideRowFollowsSales(facts());
  assert.equal(buildRowFollowsSalesWrites(d, facts(), options).find(w => w.path.startsWith("tb_rows/")).data["execution.outcome"], "METER_DISCOVERED_OUTSIDE_BATCH");
});

test("a close is logged instead whenever anything does not fit", () => {
  const held = f => { const r = decideRowFollowsSales(f); assert.equal(r.decision, DECISIONS.LOG, JSON.stringify(r)); return r.code; };
  const base = facts();
  assert.equal(held(facts({ trn: { ...base.trn, accessData: { ...base.trn.accessData, trnType: "METER_READING" } } })), "FIND_NOT_DISCOVERY");
  assert.equal(held(facts({ trn: { ...base.trn, accessData: { ...base.trn.accessData, access: { hasAccess: "no" } } } })), "FIND_NOT_DISCOVERY");
  assert.equal(held(facts({ trn: { ...base.trn, accessData: { ...base.trn.accessData, trnType: "METER_INSTALLATION", access: { hasAccess: "no" } } } })), "FIND_NOT_DISCOVERY");
  assert.equal(held(facts({ trn: { ...base.trn, targetedBatchContext: { tbId: "TGB_20260913_120001_AB13" } } })), "TRN_ALREADY_BATCH");
  assert.equal(held(facts({ trn: { ...base.trn, derived: { targetedBatch: { tbId: TB } } } })), "TRN_ALREADY_BATCH");
  const ref = extra => ({ ...base.sales, tbRefs: [{ id: TB, date: CREATED, rowId: rowOf(1).id, fieldWork: { status: "IN_PROGRESS", updatedAt: CREATED, ...extra } }] });
  assert.equal(held(facts({ sales: { ...base.sales, tbRefs: [{ id: TB, date: CREATED, rowId: rowOf(1).id, fieldWork: { status: "COMPLETED", outcomeCode: "METER_DISCOVERED", outcomeLabel: "Meter Discovered", meterMatch: true, premiseId: "P", meterId: "M", trnId: "T", submittedAt: CREATED, updatedAt: CREATED } }] } })), "TBREF_ALREADY_COMPLETED");
  assert.equal(held(facts({ sales: { ...base.sales, tbRefs: [{ id: TB, date: CREATED, rowId: "TBR_OTHER", fieldWork: { status: "IN_PROGRESS", updatedAt: CREATED } }] } })), "TBREF_ROW_DIFFERS");
  const rowsWithPremise = [{ ...base.rows[0], refs: { ...base.rows[0].refs, premiseId: "PREM_A" } }, ...base.rows.slice(1)];
  assert.equal(held(facts({ rows: rowsWithPremise, sales: ref({ premiseId: "PREM_B" }) })), "ROW_AND_TBREF_PREMISES_DIFFER");
  assert.equal(held(facts({ trn: { ...base.trn, accessData: { ...base.trn.accessData, premise: {} } } })), "FIND_PREMISE_MISSING");
  assert.equal(held(facts({ sales: ref({ meterId: "AST_OTHER" }) })), "FIND_LINKS_DIFFER");
  assert.equal(held(facts({ rows: [{ ...base.rows[0], refs: { ...base.rows[0].refs, trnId: "TRN_OTHER" } }, ...base.rows.slice(1)] })), "FIND_LINKS_DIFFER");
  assert.equal(held(withParent({ status: "COMPLETED" })), "PARENT_ALREADY_COMPLETED");
  assert.equal(held(withParent({ creation: { state: "CREATING" } })), "PARENT_NOT_READY");
  assert.equal(held(withParent({ execution: { status: "ODD" } })), "PARENT_NOT_READY");
  assert.equal(held(withParent({ acceptance: { status: "WAITING" } })), "PARENT_NOT_ACCEPTED");
  assert.equal(held(withParent({ acceptance: { status: "REJECTED" } })), "PARENT_NOT_ACCEPTED");
  const rowPatch = patch => facts({ rows: [{ ...base.rows[0], ...patch }, ...base.rows.slice(1)] });
  assert.equal(held(rowPatch({ execution: {} })), "ROW_NOT_READY", "a 0.3.0 row without an execution status");
  assert.equal(held(rowPatch({ decision: { status: "REJECT" } })), "ROW_NOT_READY");
  assert.equal(held(rowPatch({ allocation: { allocatable: true, status: "UNALLOCATED" } })), "ROW_NOT_READY");
  assert.equal(held(facts({ trn: { ...base.trn, ast: { astData: {} } } })), "FIND_METER_NO_MISSING");
  assert.equal(held(rowPatch({ execution: { status: "IN_PROGRESS", startedAt: "garbage" } })), "ROW_START_UNKNOWN");
});

test("another team or service provider found it, or the batch is not allocated: the row goes out", () => {
  const other = decide({ memberHistory: [{ teamId: "TEAM2", teamName: "Team Two", userUid: "FWR1", joinedAt: "2026-09-01T00:00:00.000Z", leftAt: null }] });
  assert.deepEqual([other.decision, other.reason, other.finder.teamId, other.membershipSource, other.salesMeterStatus], [DECISIONS.REMOVE, "FOUND_BY_ANOTHER_TEAM", "TEAM2", "SCALAR", "COMPLETED"]);
  const noTeam = decide({ memberHistory: [] });
  assert.deepEqual([noTeam.decision, noTeam.reason], [DECISIONS.REMOVE, "FOUND_BY_ANOTHER_TEAM"], "a worker in no team, for a TEAM batch");
  const otherSp = decideRowFollowsSales(withParent({ allocation: { status: "ALLOCATED", targetType: "SP", targetId: "SP9", completedAt: ALLOCATED_AT } }));
  assert.deepEqual([otherSp.decision, otherSp.reason], [DECISIONS.REMOVE, "FOUND_BY_ANOTHER_TEAM"]);
  for (const allocation of [unallocated(), {}, { status: "" }]) {
    const f = withParent({ allocation, status: "READY_FOR_ALLOCATION", acceptance: { status: "NOT_READY" } });
    f.rows = f.rows.map(r => ({ ...r, allocation: { allocatable: true, status: "UNALLOCATED" } }));
    const r = decideRowFollowsSales(f);
    assert.deepEqual([r.decision, r.reason], [DECISIONS.REMOVE, "FOUND_WHILE_UNALLOCATED"], JSON.stringify(allocation));
    assert.deepEqual([r.after.action, r.after.branch, r.after.status, r.after.counts.totalRows, r.after.counts.unallocatedRows], ["UPDATE", "UNCHANGED", "READY_FOR_ALLOCATION", 2, 2]);
  }
  // Legacy membership through the only tbRef.
  const legacy = { ...facts().sales }; delete legacy.targetedBatchId;
  const l = decide({ sales: legacy, memberHistory: [] });
  assert.deepEqual([l.decision, l.membershipSource], [DECISIONS.REMOVE, "LEGACY_TBREFS"]);
});

test("a removal writes the Sales event, clears the scalar, deletes the row and recounts the batch", () => {
  const f = facts({ memberHistory: [{ teamId: "TEAM2", teamName: "Team Two", userUid: "FWR1", joinedAt: "2026-09-01T00:00:00.000Z", leftAt: null }], pointing: { trnIds: ["TRN_NA"], premiseIds: [] } });
  const r = decideRowFollowsSales(f);
  const writes = buildRowFollowsSalesWrites(r, f, options);
  assert.deepEqual(writes.map(w => `${w.op} ${w.path}`), [`create sales-all-meters/${SALES}/batchHistory/${TB}__REMOVED_FROM_BATCH`, `update sales-all-meters/${SALES}`, `delete tb_rows/${rowOf(1).id}`, `update tb_uploads/${TB}`, `create tb_uploads/${TB}/history/ROW_REMOVED__${rowOf(1).id}`]);
  const [event, sales, , parent, history] = writes.map(w => w.data);
  assert.deepEqual(Object.keys(event).sort(), ["actor", "erfId", "erfResolutionRevision", "eventType", "geofenceId", "id", "idempotencyKey", "membershipAfter", "membershipBefore", "membershipSource", "occurredAt", "reason", "removalAudit", "rowId", "salesId", "salesMeterStatus", "schemaVersion", "tbId"].sort(), "Sales schema TB6 root keys");
  assert.deepEqual([event.schemaVersion, event.id, event.idempotencyKey, event.eventType, event.membershipBefore, event.membershipAfter, event.membershipSource, event.reason, event.salesMeterStatus, event.geofenceId, event.erfId, event.occurredAt],
    [1, `${TB}__REMOVED_FROM_BATCH`, `${TB}__REMOVED_FROM_BATCH`, "REMOVED_FROM_BATCH", TB, null, "SCALAR", "FOUND_BY_ANOTHER_TEAM", "COMPLETED", "GF1", "ERF1", SERVER]);
  assert.deepEqual(event.actor, { uid: "FWR1", user: "Field Worker", role: "FWR" }, "the actor is the worker who made the find");
  assert.deepEqual(Object.keys(event.removalAudit).sort(), ["cleanupRunId", "ownerRule", "ownerTbId", "parentAcceptance", "parentAllocation", "parentStatus", "removedTbRef", "rowAllocation", "rowExecutionStatus", "salesMeterStatus"]);
  assert.deepEqual([event.removalAudit.cleanupRunId, event.removalAudit.ownerTbId, event.removalAudit.ownerRule, event.removalAudit.removedTbRef], [`TB-R056:${TRN}`, null, "FOUND_BY_ANOTHER_TEAM", { id: TB, date: CREATED }]);
  assert.deepEqual([sales.targetedBatchId, sales.tbRefs, sales["metadata.updatedByUid"]], [null, [], "FWR1"]);
  assert.deepEqual([parent["counts.totalRows"], parent["counts.allocatedRows"], parent.status], [2, 2, undefined], "counts recounted, status unchanged");
  assert.deepEqual([history.event, history.rule, history.reason, history.released, history.removedRow.id, history.pointingAtRow.trnIds, history.countsAfter.totalRows], ["TARGETED_BATCH_ROW_REMOVED", "TB-R056", "FOUND_BY_ANOTHER_TEAM", false, rowOf(1).id, ["TRN_NA"], 2]);
  assert.equal(countRowsTakenOut([{ ...history, id: `ROW_REMOVED__${rowOf(1).id}` }]), 1, "Allocate, Unallocate and Delete count it");
});

test("a started row goes too, with its field work kept in the history; the batch may then complete", () => {
  const f = facts({ memberHistory: [] });
  const done = { status: "COMPLETED", startedAt: ts(Date.parse("2026-09-15T08:00:00Z")), completedAt: ts(Date.parse("2026-09-15T09:00:00Z")), outcome: "METER_DISCOVERED" };
  f.rows = [{ ...f.rows[0], execution: { status: "IN_PROGRESS", startedAt: ts(Date.parse("2026-09-14T08:00:00Z")), completedAt: null } }, { ...f.rows[1], execution: done }, { ...f.rows[2], execution: done }];
  f.sales = { ...f.sales, tbRefs: [{ id: TB, date: CREATED, rowId: f.rows[0].id, fieldWork: { status: "IN_PROGRESS", premiseId: "PREM_ROW", updatedAt: CREATED } }] };
  f.parent = { ...f.parent, status: "IN_PROGRESS", execution: { status: "IN_PROGRESS", startedAt: ts(Date.parse("2026-09-14T08:00:00Z")), completedAt: null }, counts: { ...f.parent.counts, executionStartedRows: 3, completedRows: 2 } };
  const r = decideRowFollowsSales(f);
  assert.deepEqual([r.decision, r.after.status, r.after.execution.completedAt, r.salesMeterStatus], [DECISIONS.REMOVE, "COMPLETED", Date.parse("2026-09-15T09:00:00Z"), "COMPLETED"]);
  const [event] = buildRowFollowsSalesWrites(r, f, options);
  assert.deepEqual([event.data.removalAudit.rowExecutionStatus, event.data.removalAudit.removedTbRef.fieldWork.premiseId], ["IN_PROGRESS", "PREM_ROW"]);
});

test("a batch left with no rows is deleted, after checking no other Sales record names it", () => {
  const one = over => { const f = withParent({ allocation: unallocated(), status: "READY_FOR_ALLOCATION", acceptance: { status: "NOT_READY" }, counts: { ...facts().parent.counts, totalRows: 1 } }, over); f.rows = [{ ...f.rows[0], allocation: { allocatable: true, status: "UNALLOCATED" } }]; return f; };
  assert.equal(decideRowFollowsSales(one()).code, "DELETE_UNVERIFIABLE", "the other Sales records were not read");
  const noDate = one({ namedByOthers: [] }); noDate.parent = { ...noDate.parent, metadata: {} };
  assert.equal(decideRowFollowsSales(noDate).code, "DELETE_UNVERIFIABLE");
  assert.deepEqual([decideRowFollowsSales(one({ namedByOthers: ["07000000009"] })).code, decideRowFollowsSales(one({ namedByOthers: ["07000000009"] })).namedBy], ["NAMED_BY_OTHER_SALES", ["07000000009"]]);
  assert.equal(decideRowFollowsSales(one({ namedByOthers: [], history: { ...facts().history, batchDeleted: true } })).code, "HISTORY_EXISTS");
  const f = one({ namedByOthers: [] });
  const r = decideRowFollowsSales(f);
  assert.deepEqual([r.decision, r.after.action], [DECISIONS.REMOVE, "DELETE"]);
  const writes = buildRowFollowsSalesWrites(r, f, options);
  assert.deepEqual(writes.map(w => `${w.op} ${w.path}`), [`create sales-all-meters/${SALES}/batchHistory/${TB}__REMOVED_FROM_BATCH`, `update sales-all-meters/${SALES}`, `delete tb_rows/${rowOf(1).id}`,
    `create tb_uploads/${TB}/history/BATCH_DELETED__TB-R056:${TRN}`, `delete tb_uploads/${TB}`, `create tb_uploads/${TB}/history/ROW_REMOVED__${rowOf(1).id}`]);
  assert.deepEqual([writes[3].data.event, writes[3].data.rule, writes[5].data.statusAfter.status], ["TARGETED_BATCH_DELETED", "TB-R056", "DELETED"]);
});

test("rows of an old batch without a geofence go out too, allocated or not (rule point 2 has no exception)", () => {
  const old = { schemaVersion: "0.2.0", source: { type: "PREPAID_SALES_NON_GPS" }, allocation: unallocated(), status: "READY_FOR_ALLOCATION", acceptance: { status: "NOT_READY" } };
  const f = withParent(old);
  f.rows = f.rows.map(r => ({ ...r, schemaVersion: "0.2.0", allocation: { allocatable: true, status: "UNALLOCATED" } }));
  const r = decideRowFollowsSales(f);
  assert.deepEqual([r.decision, r.reason, r.after.counts.totalRows], [DECISIONS.REMOVE, "FOUND_WHILE_UNALLOCATED", 2], JSON.stringify(r));
  const allocatedOld = decideRowFollowsSales(withParent({ schemaVersion: "0.2.0", source: { type: "PREPAID_SALES_NON_GPS" } }, { memberHistory: [] }));
  assert.deepEqual([allocatedOld.decision, allocatedOld.reason], [DECISIONS.REMOVE, "FOUND_BY_ANOTHER_TEAM"]);
});

test("a find made through this same batch never takes one of its rows out", () => {
  // The worker is in TEAM1 (the batch's team) and TEAM2, joined later: TM-R001 gives TEAM2, but the find is this batch's own TRN.
  const history = [{ teamId: "TEAM2", teamName: "Team Two", userUid: "FWR1", joinedAt: "2026-09-01T00:00:00.000Z", leftAt: null }];
  for (const mark of [{ targetedBatchContext: { tbId: TB, rowId: "TBR_OTHER_ROW" } }, { derived: { targetedBatch: { tbId: TB } } }, { accessData: { ...facts().trn.accessData, tbId: TB } }]) {
    const r = decide({ memberHistory: history, trn: { ...facts().trn, ...mark } });
    assert.deepEqual([r.decision, r.code, r.wouldBe, r.trnContext], [DECISIONS.LOG, "TRN_ALREADY_BATCH", "FOUND_BY_ANOTHER_TEAM", TB], JSON.stringify(mark));
  }
  // A sales-path TRN of another batch, by another team, still takes the row out.
  const other = decide({ memberHistory: history, trn: { ...facts().trn, targetedBatchContext: { tbId: "TGB_20260913_120001_AB13" } } });
  assert.deepEqual([other.decision, other.reason], [DECISIONS.REMOVE, "FOUND_BY_ANOTHER_TEAM"]);
});

test("a row started after the find still closes, completing at its start; the history keeps the find time", () => {
  const start = FIND_MS + 60000;
  const f = facts();
  f.rows = [{ ...f.rows[0], execution: { status: "IN_PROGRESS", startedAt: ts(start), completedAt: null, outcome: null } }, ...f.rows.slice(1)];
  f.parent = { ...f.parent, status: "IN_PROGRESS", execution: { status: "IN_PROGRESS", startedAt: ts(start), completedAt: null }, counts: { ...f.parent.counts, executionStartedRows: 1 } };
  const r = decideRowFollowsSales(f);
  assert.deepEqual([r.decision, r.completedAtMs, r.findAtMs, r.foundBeforeRowStart], [DECISIONS.CLOSE, start, FIND_MS, true], JSON.stringify(r));
  const writes = buildRowFollowsSalesWrites(r, f, options);
  const row = writes.find(w => w.path === `tb_rows/${f.rows[0].id}`).data;
  assert.equal(row["execution.startedAt"], f.rows[0].execution.startedAt, "startedAt kept");
  assert.equal(row["execution.completedAt"].toMillis(), start, "never before startedAt");
  const history = writes.find(w => w.path.includes("ROW_CLOSED__")).data;
  assert.deepEqual([history.findAt.toMillis(), history.foundBeforeRowStart], [FIND_MS, true]);
  assert.equal(writes.find(w => w.path === `sales-all-meters/${SALES}`).data.tbRefs[0].fieldWork.submittedAt.toMillis(), FIND_MS, "the tbRef keeps the find time");
  // An ordinary close completes at the find time.
  assert.deepEqual([decide().completedAtMs, decide().foundBeforeRowStart], [FIND_MS, false]);
});

test("the batch status follows section 14 and is never reopened or started without acceptance", () => {
  const before = parentState({ status: "COMPLETED", acceptance: { status: "ACCEPTED" }, execution: { status: "COMPLETED", startedAt: ts(1000), completedAt: ts(2000) }, counts: {} });
  const started = [rowState({ id: "a", execution: { status: "IN_PROGRESS", startedAt: ts(1000) }, decision: { status: "ACCEPT" }, allocation: { allocatable: true, status: "ALLOCATED" } }),
    rowState({ id: "b", execution: { status: "NOT_STARTED" }, decision: { status: "ACCEPT" }, allocation: { allocatable: true, status: "ALLOCATED" } })];
  assert.deepEqual([parentAfter(before, started, executionFallback(started)).action, parentAfter(before, started, executionFallback(started)).reason], ["HOLD", "WOULD_REOPEN_COMPLETED"]);
  const waiting = { ...before, status: "ALLOCATED", acceptance: "WAITING", execution: { status: "NOT_STARTED", startedAt: null, completedAt: null } };
  assert.equal(parentAfter(waiting, started, executionFallback(started)).reason, "NOT_ACCEPTED");
  const noTimes = [rowState({ id: "a", execution: { status: "IN_PROGRESS" }, decision: { status: "ACCEPT" }, allocation: { allocatable: true, status: "ALLOCATED" } })];
  assert.equal(parentAfter({ ...waiting, acceptance: "ACCEPTED" }, noTimes, executionFallback(noTimes)).reason, "STARTED_TIME_UNKNOWN");
  // Through the decision: another team's find leaves a Not Started batch that says IN_PROGRESS only from its started rows.
  const f = facts({ memberHistory: [] });
  f.rows = [f.rows[0], { ...f.rows[1], execution: { status: "IN_PROGRESS" } }, f.rows[2]];
  assert.equal(decideRowFollowsSales(f).code, "PARENT_STARTED_TIME_UNKNOWN");
});

test("a policy error is logged, never thrown", () => {
  const f = facts();
  Object.defineProperty(f, "rows", { get() { throw new Error("boom"); } });
  const r = decideRowFollowsSales(f);
  assert.deepEqual([r.decision, r.code, r.detail], [DECISIONS.LOG, "POLICY_ERROR", "boom"]);
  assert.deepEqual(buildRowFollowsSalesWrites({ decision: DECISIONS.NONE }, facts(), options), []);
});
