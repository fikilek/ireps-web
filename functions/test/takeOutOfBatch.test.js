// Targeted Batch rules TB-R060 (1.3.62): taking a meter out of a batch. Every branch of the pure policy.
import test from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { decideTakeOutOfBatch, buildTakeOutOfBatchWrites, inspectReasonText, refusalMessage, runIdOf,
  ACTOR_ROLES, DECISIONS, REASON, REASON_TEXT_MAX, REFUSAL_CODES, RULE, RULES_VERSION } from "../targetedBatches/takeOutOfBatch.js";
import { countRowsTakenOut, ROW_REMOVAL_RULES } from "../targetedBatches/rowFollowsSales.js";
import { inspectSalesTbRefsIntegrity } from "../salesAllMeters/sales-batch-policy.js";

const TB = "TGB_20260913_120000_AB12";
const OTHER_TB = "TGB_20260913_130000_CD34";
const SALES = "07000000001";
const CREATED = Timestamp.fromMillis(Date.parse("2026-09-13T12:00:00Z"));
const STARTED = Timestamp.fromMillis(Date.parse("2026-09-15T07:00:00Z"));
const DONE = Timestamp.fromMillis(Date.parse("2026-09-16T11:00:00Z"));
const ALLOCATED_AT = Timestamp.fromMillis(Date.parse("2026-09-14T08:00:00Z"));
const NOW = Timestamp.fromMillis(Date.parse("2026-09-20T10:00:00Z"));
const SERVER = { serverTimestamp: true };
const options = { ts: ms => Timestamp.fromMillis(ms), now: NOW, serverTime: SERVER };
const ACTOR = { uid: "SPV1", user: "Thandi Supervisor", role: "SPV" };
const WORDS = "Batched by mistake: this meter belongs to next month's work.";

const rowOf = (n, salesId, extra = {}) => ({ id: `TBR_20260913_120000_AB12_00000${n}`, tbId: TB, rowNo: n, schemaVersion: "0.3.0", salesAllMeterId: salesId,
  meter: { numberNormalized: salesId, numberRaw: salesId }, decision: { status: "ACCEPT" },
  allocation: { allocatable: true, status: "ALLOCATED", targetType: "TEAM", targetId: "TEAM1" },
  execution: { status: "NOT_STARTED", startedAt: null, completedAt: null, outcome: null }, refs: { erfId: "ERF1", premiseId: null, meterId: null, trnId: null }, ...extra });

// A three-meter 0.3.0 batch, allocated to TEAM1 and accepted; meter SALES is row 1 and nothing has started.
function facts(over = {}) {
  const rows = [rowOf(1, SALES), rowOf(2, "07000000002"), rowOf(3, "07000000003")];
  return {
    tbId: TB,
    salesId: SALES,
    sales: { master: { id: SALES, visibility: "NOT_VISIBLE" }, targetedBatchId: TB, tbRefs: [{ id: TB, date: CREATED }], erfId: "ERF1", erfResolution: { revision: 4 },
      metadata: { createdAt: CREATED, createdByUid: "ORIGINAL", createdByUser: "Original", updatedAt: CREATED, updatedByUid: "ORIGINAL", updatedByUser: "Original" } },
    parent: { id: TB, schemaVersion: "0.3.0", status: "ALLOCATED", geofenceId: "GF1", source: { type: "PREPAID_SALES" }, creation: { state: "READY", createdRows: 3, expectedRows: 3 },
      scope: { lmPcode: "ZA5241" },
      allocation: { status: "ALLOCATED", targetType: "TEAM", targetId: "TEAM1", targetName: "Team One", completedAt: ALLOCATED_AT },
      acceptance: { status: "ACCEPTED" }, execution: { status: "NOT_STARTED", startedAt: null, completedAt: null },
      counts: { totalRows: 3, acceptedRows: 3, rejectedRows: 0, allocatableRows: 3, allocatedRows: 3, unallocatedRows: 0, executionStartedRows: 0, completedRows: 0 },
      metadata: { createdAt: CREATED } },
    rows,
    row: rows[0],
    history: { rowRemoved: false, salesRemoved: false },
    pointing: { trnIds: [], premiseIds: [] },
    actor: ACTOR,
    reasonText: WORDS,
    ...over,
  };
}
const decide = over => decideTakeOutOfBatch(facts(over));
const refusal = over => { const result = decide(over); assert.equal(result.decision, DECISIONS.REFUSE, `expected a refusal, got ${result.decision} ${result.code}`); return result; };

test("the person's own words are required, trimmed and at most 500 characters", () => {
  assert.deepEqual(inspectReasonText("  keep it  "), { ok: true, reasonText: "keep it" });
  assert.equal(inspectReasonText("   ").code, "REASON_REQUIRED");
  assert.equal(inspectReasonText(undefined).code, "REASON_REQUIRED");
  assert.equal(inspectReasonText("x".repeat(REASON_TEXT_MAX)).ok, true);
  assert.equal(inspectReasonText("x".repeat(REASON_TEXT_MAX + 1)).code, "REASON_TOO_LONG");
  assert.equal(refusal({ reasonText: "" }).code, "REASON_REQUIRED");
  assert.equal(refusal({ reasonText: "y".repeat(501) }).code, "REASON_TOO_LONG");
  // The reason reaches the plan trimmed.
  assert.equal(decide({ reasonText: `  ${WORDS}  ` }).reasonText, WORDS);
});

test("only a supervisor or a manager, with a name and a role", () => {
  assert.deepEqual(ACTOR_ROLES, ["SPV", "MNG"]);
  assert.equal(refusal({ actor: { uid: "U1", user: "No Role" } }).code, "ACTOR_INCOMPLETE");
  assert.equal(refusal({ actor: { uid: "U1", role: "SPV" } }).code, "ACTOR_INCOMPLETE");
  assert.equal(refusal({ actor: { uid: "FWR1", user: "Field Worker", role: "FWR" } }).code, "ACTOR_ROLE");
  assert.equal(decide({ actor: { uid: "MNG1", user: "Manager", role: "MNG" } }).decision, DECISIONS.REMOVE);
});

test("the meter must be in the batch the action names", () => {
  assert.equal(refusal({ sales: null }).code, "SALES_MISSING");
  const sales = over => ({ ...facts().sales, ...over });
  assert.equal(refusal({ sales: sales({ targetedBatchId: "not a batch id" }) }).code, "MEMBERSHIP_UNRESOLVED");
  assert.equal(refusal({ sales: sales({ targetedBatchId: null }) }).code, "NOT_IN_BATCH");
  // In another batch: nothing of this batch is touched.
  const other = refusal({ sales: sales({ targetedBatchId: OTHER_TB, tbRefs: [{ id: OTHER_TB, date: CREATED }] }) });
  assert.equal(other.code, "NOT_IN_BATCH");
  assert.match(other.message, /is not in batch TGB_20260913_120000_AB12\./);
  // Legacy record with no scalar: one clear tbRef is the membership, several are unresolved.
  const legacy = facts().sales;
  delete legacy.targetedBatchId;
  assert.equal(decideTakeOutOfBatch({ ...facts(), sales: legacy }).membershipSource, "LEGACY_TBREFS");
  assert.equal(refusal({ sales: { ...legacy, tbRefs: [{ id: TB, date: CREATED }, { id: OTHER_TB, date: CREATED }] } }).code, "MEMBERSHIP_UNRESOLVED");
});

test("the batch and its row must read as one", () => {
  assert.equal(refusal({ parent: null }).code, "PARENT_MISSING");
  assert.equal(refusal({ parent: { ...facts().parent, id: OTHER_TB } }).code, "PARENT_IDENTITY");
  assert.equal(refusal({ rows: [rowOf(2, "07000000002"), rowOf(3, "07000000003")], row: undefined }).code, "ROW_MISSING");
  const twice = refusal({ rows: [rowOf(1, SALES), rowOf(2, SALES), rowOf(3, "07000000003")] });
  assert.equal(twice.code, "ROW_DUPLICATE");
  assert.equal(twice.rowIds.length, 2);
  // A row passed in that is not the batch's row for this meter.
  assert.equal(refusal({ row: rowOf(9, SALES) }).code, "ROW_MISSING");
  const strayRows = [rowOf(1, SALES), { ...rowOf(2, "07000000002"), tbId: OTHER_TB }, rowOf(3, "07000000003")];
  assert.equal(refusal({ rows: strayRows, row: strayRows[0] }).code, "ROW_IDENTITY");
  const conflict = [{ ...rowOf(1, SALES), idConflict: true }, rowOf(2, "07000000002"), rowOf(3, "07000000003")];
  assert.equal(refusal({ rows: conflict, row: conflict[0] }).code, "ROW_IDENTITY");
});

test("completed work is never released: a Completed row or a meter found on site", () => {
  const done = [rowOf(1, SALES, { execution: { status: "COMPLETED", startedAt: STARTED, completedAt: DONE, outcome: "METER_DISCOVERED" } }), rowOf(2, "07000000002"), rowOf(3, "07000000003")];
  const completed = refusal({ rows: done, row: done[0] });
  assert.equal(completed.code, "ROW_COMPLETED");
  assert.match(completed.message, /Completed work is never released\./);
  const visible = refusal({ sales: { ...facts().sales, master: { id: SALES, visibility: "VISIBLE" } } });
  assert.equal(visible.code, "METER_VISIBLE");
  assert.match(visible.message, /found on site, so it is completed/);
});

test("the batch's last row is refused, and Delete Batch is named", () => {
  const rows = [rowOf(1, SALES)];
  const only = refusal({ rows, row: rows[0] });
  assert.equal(only.code, "LAST_ROW");
  assert.match(only.message, /Use Delete Batch to empty a batch\./);
});

test("a repeat finds its own history and changes nothing", () => {
  assert.equal(refusal({ history: { salesRemoved: true, rowRemoved: false } }).code, "ALREADY_TAKEN_OUT");
  assert.equal(refusal({ history: { salesRemoved: false, rowRemoved: true } }).code, "ALREADY_TAKEN_OUT");
});

test("the meter's own batch reference and metadata must be sound", () => {
  assert.equal(refusal({ sales: { ...facts().sales, tbRefs: [] } }).code, "TBREF_INVALID");
  assert.equal(refusal({ sales: { ...facts().sales, tbRefs: [{ id: TB, date: CREATED }, { id: TB, date: CREATED }] } }).code, "TBREF_INVALID");
  const badMetadata = { ...facts().sales, metadata: { createdAt: "2026-09-13", createdByUid: "ORIGINAL", createdByUser: "Original", updatedAt: CREATED, updatedByUid: "ORIGINAL", updatedByUser: "Original" } };
  assert.equal(refusal({ sales: badMetadata }).code, "SALES_METADATA_INVALID");
});

test("the batch is never left in a state iREPS cannot write", () => {
  const started = extra => [rowOf(1, SALES), rowOf(2, "07000000002", extra), rowOf(3, "07000000003")];
  // Work has started but the batch was never accepted.
  const waiting = started({ execution: { status: "IN_PROGRESS", startedAt: STARTED, completedAt: null } });
  assert.equal(refusal({ rows: waiting, row: waiting[0], parent: { ...facts().parent, acceptance: { status: "WAITING" } } }).code, "PARENT_NOT_ACCEPTED");
  // A completed batch is never reopened.
  const mixed = [rowOf(1, SALES), rowOf(2, "07000000002", { execution: { status: "IN_PROGRESS", startedAt: STARTED, completedAt: null } }),
    rowOf(3, "07000000003", { execution: { status: "COMPLETED", startedAt: STARTED, completedAt: DONE } })];
  assert.equal(refusal({ rows: mixed, row: mixed[0], parent: { ...facts().parent, status: "COMPLETED" } }).code, "PARENT_WOULD_REOPEN_COMPLETED");
  // A started row with no start time anywhere.
  const noStart = started({ execution: { status: "IN_PROGRESS", startedAt: null, completedAt: null } });
  assert.equal(refusal({ rows: noStart, row: noStart[0] }).code, "PARENT_STARTED_TIME_UNKNOWN");
  // The batch would complete, but nothing says when.
  const noEnd = [rowOf(1, SALES),
    rowOf(2, "07000000002", { execution: { status: "COMPLETED", startedAt: STARTED, completedAt: null } }),
    rowOf(3, "07000000003", { execution: { status: "COMPLETED", startedAt: STARTED, completedAt: null } })];
  assert.equal(refusal({ rows: noEnd, row: noEnd[0], parent: { ...facts().parent, execution: { status: "IN_PROGRESS", startedAt: STARTED, completedAt: null } } }).code, "PARENT_COMPLETED_TIME_UNKNOWN");
});

test("a policy error is refused, never thrown", () => {
  const broken = facts();
  Object.defineProperty(broken, "rows", { get() { throw new Error("boom"); } });
  const result = decideTakeOutOfBatch(broken);
  assert.deepEqual([result.decision, result.code, result.detail], [DECISIONS.REFUSE, "POLICY_ERROR", "boom"]);
  assert.deepEqual(decideTakeOutOfBatch(), { decision: DECISIONS.REFUSE, code: "REASON_REQUIRED", message: refusalMessage("REASON_REQUIRED"), meterNo: "this meter" });
});

test("every refusal says something plain, naming the meter and the batch where it helps", () => {
  for (const code of REFUSAL_CODES) {
    const message = refusalMessage(code, { meter: SALES, batch: TB });
    assert.ok(message.length > 20 && message.endsWith("."), `${code}: ${message}`);
    assert.ok(!message.includes(code) && !message.includes("undefined"), `${code} must not leak its own code: ${message}`);
  }
  assert.match(refusalMessage("SOMETHING_NEW", { meter: SALES, batch: TB }), /could not be taken out of batch/);
});

test("the plan says what to write: the row goes, the meter is free, the batch is recounted", () => {
  const plan = decide();
  assert.equal(plan.decision, DECISIONS.REMOVE);
  assert.equal(plan.code, REASON);
  assert.equal(plan.reason, "TAKEN_OUT_OF_BATCH");
  assert.equal(plan.reasonText, WORDS);
  assert.equal(plan.salesMeterStatus, "NOT_STARTED");
  assert.equal(plan.membershipSource, "SCALAR");
  assert.equal(plan.exactIndex, 0);
  assert.equal(plan.runId, `${RULE}:TBR_20260913_120000_AB12_000001`);
  assert.equal(plan.rowNo, 1);
  assert.deepEqual(plan.actor, ACTOR);
  // Two rows are left, and nothing has started, so the batch's status does not move.
  assert.equal(plan.after.action, "UPDATE");
  assert.equal(plan.after.branch, "UNCHANGED");
  assert.equal(plan.after.counts.totalRows, 2);
  assert.equal(plan.after.counts.allocatedRows, 2);
});

test("a started row may be taken out; its premise and its No Access stay where they are", () => {
  const rows = [rowOf(1, SALES, { execution: { status: "IN_PROGRESS", startedAt: STARTED, completedAt: null }, refs: { erfId: "ERF1", premiseId: "PRM1", meterId: null, trnId: null } }),
    rowOf(2, "07000000002"), rowOf(3, "07000000003")];
  const salesStarted = { ...facts().sales, tbRefs: [{ id: TB, date: CREATED, rowId: rows[0].id, fieldWork: { status: "IN_PROGRESS", updatedAt: STARTED, noAccess: [{ date: "2026-09-15", time: "07:30:00", user: "Field Worker" }] } }] };
  const plan = decideTakeOutOfBatch({ ...facts({ rows, row: rows[0], sales: salesStarted }) });
  assert.equal(plan.decision, DECISIONS.REMOVE);
  assert.equal(plan.salesMeterStatus, "IN_PROGRESS");
  assert.deepEqual(plan.removedTbRef.fieldWork.noAccess, [{ date: "2026-09-15", time: "07:30:00", user: "Field Worker" }]);
  const writes = buildTakeOutOfBatchWrites(plan, facts({ rows, row: rows[0], sales: salesStarted }), options);
  const event = writes[0].data;
  assert.equal(event.salesMeterStatus, "IN_PROGRESS");
  // The whole removed row and its field work are kept in the history, so the office can see what was there.
  const removed = writes[4].data;
  assert.equal(removed.removedRow.refs.premiseId, "PRM1");
  assert.equal(removed.removedTbRef.fieldWork.status, "IN_PROGRESS");
  assert.equal(removed.countsAfter.executionStartedRows, 0);
});

test("the writes are the removal's writes, with this rule's actor, reason and words", () => {
  const data = facts();
  const plan = decideTakeOutOfBatch(data);
  const writes = buildTakeOutOfBatchWrites(plan, data, options);
  assert.deepEqual(writes.map(write => `${write.op} ${write.path}`), [
    `create sales-all-meters/${SALES}/batchHistory/${TB}__REMOVED_FROM_BATCH`,
    `sales-all-meters/${SALES}`.replace(/^/, "update "),
    "delete tb_rows/TBR_20260913_120000_AB12_000001",
    `update tb_uploads/${TB}`,
    `create tb_uploads/${TB}/history/ROW_REMOVED__TBR_20260913_120000_AB12_000001`,
  ]);

  // 1. Sales Batch History (Sales schema TB6, 1.10.2).
  const event = writes[0].data;
  assert.deepEqual(Object.keys(event).sort(), ["actor", "erfId", "erfResolutionRevision", "eventType", "geofenceId", "id", "idempotencyKey",
    "membershipAfter", "membershipBefore", "membershipSource", "occurredAt", "reason", "reasonText", "removalAudit", "rowId", "salesId", "salesMeterStatus", "schemaVersion", "tbId"].sort());
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.eventType, "REMOVED_FROM_BATCH");
  assert.equal(event.id, `${TB}__REMOVED_FROM_BATCH`);
  assert.equal(event.idempotencyKey, event.id);
  assert.equal(event.membershipBefore, TB);
  assert.equal(event.membershipAfter, null);
  assert.equal(event.membershipSource, "SCALAR");
  assert.equal(event.reason, "TAKEN_OUT_OF_BATCH");
  assert.equal(event.reasonText, WORDS);
  assert.equal(event.salesMeterStatus, "NOT_STARTED");
  assert.equal(event.geofenceId, "GF1");
  assert.equal(event.erfId, "ERF1");
  assert.equal(event.erfResolutionRevision, 4);
  assert.deepEqual(event.actor, { uid: "SPV1", user: "Thandi Supervisor", role: "SPV" });
  assert.equal(event.occurredAt, SERVER);
  // removalAudit is the exact bounded map, with no clean-up keys.
  assert.deepEqual(Object.keys(event.removalAudit).sort(), ["parentAcceptance", "parentAllocation", "parentStatus", "removedTbRef", "rowAllocation", "rowExecutionStatus", "salesMeterStatus"]);
  assert.deepEqual(event.removalAudit.removedTbRef, { id: TB, date: CREATED });
  assert.equal(event.removalAudit.rowExecutionStatus, "NOT_STARTED");

  // 2. The meter is free again.
  const salesPatch = writes[1].data;
  assert.deepEqual(salesPatch.tbRefs, []);
  assert.equal(salesPatch.targetedBatchId, null);
  assert.equal(salesPatch["metadata.updatedByUid"], "SPV1");
  assert.equal(salesPatch["metadata.updatedAt"], SERVER);
  assert.ok(inspectSalesTbRefsIntegrity(salesPatch.tbRefs).valid);

  // 4. The batch: counts recounted from its rows, its status by section 14, allocation and acceptance untouched.
  const parentPatch = writes[3].data;
  assert.equal(parentPatch["counts.totalRows"], 2);
  assert.equal(parentPatch["counts.allocatableRows"], 2);
  assert.equal(parentPatch["counts.completedRows"], 0);
  assert.equal(parentPatch["metadata.updatedByUser"], "Thandi Supervisor");
  assert.ok(!Object.keys(parentPatch).some(key => /^(allocation|acceptance|creation|selection)/.test(key)), "allocation, acceptance, creation and selection are never written");
  assert.ok(!Object.hasOwn(parentPatch, "status"), "an unchanged status is not rewritten");

  // 5. The batch history entry names the rule, the person and their words.
  const removed = writes[4].data;
  assert.equal(removed.event, "TARGETED_BATCH_ROW_REMOVED");
  assert.equal(removed.rule, RULE);
  assert.equal(removed.rulesVersion, RULES_VERSION);
  assert.equal(removed.runId, runIdOf("TBR_20260913_120000_AB12_000001"));
  assert.equal(removed.released, true);
  assert.equal(removed.ownerTbId, null);
  assert.equal(removed.reason, "TAKEN_OUT_OF_BATCH");
  assert.equal(removed.reasonText, WORDS);
  assert.deepEqual(removed.countsBefore.totalRows, 3);
  assert.deepEqual(removed.countsAfter.totalRows, 2);
  assert.deepEqual(removed.statusBefore, { status: "ALLOCATED", execution: "NOT_STARTED", startedAt: null, completedAt: null });
  assert.deepEqual(removed.statusAfter, { status: "ALLOCATED", execution: "NOT_STARTED", startedAt: null, completedAt: null });
  assert.equal(removed.removedRow.id, "TBR_20260913_120000_AB12_000001");
  assert.deepEqual(removed.pointingAtRow, { trnIds: [], premiseIds: [] });
  assert.match(removed.note, /Thandi Supervisor \(SPV\) took meter 07000000001 out of batch TGB_20260913_120000_AB12/);
  assert.match(removed.note, /rules 1\.3\.62, TB-R060/);
  assert.match(removed.note, /free again/);

  // Nothing else is written: no TRN, AST, meter master, premise or geofence.
  assert.equal(writes.filter(write => /^(trns|asts|meter_master|premises|geo_fences)\//.test(write.path)).length, 0);
  // A refusal writes nothing.
  assert.deepEqual(buildTakeOutOfBatchWrites({ decision: DECISIONS.REFUSE, code: "LAST_ROW" }, data, options), []);
});

test("records pointing at the removed row are listed, never changed", () => {
  const data = facts({ pointing: { trnIds: ["TRN_A", "TRN_B"], premiseIds: ["PRM1"] } });
  const writes = buildTakeOutOfBatchWrites(decideTakeOutOfBatch(data), data, options);
  assert.deepEqual(writes[4].data.pointingAtRow, { trnIds: ["TRN_A", "TRN_B"], premiseIds: ["PRM1"] });
  assert.equal(writes.length, 5, "listing them adds no write");
});

test("taking out the row that was holding the batch open completes the batch (section 14)", () => {
  const rows = [rowOf(1, SALES),
    rowOf(2, "07000000002", { execution: { status: "COMPLETED", startedAt: STARTED, completedAt: DONE, outcome: "METER_DISCOVERED" } }),
    rowOf(3, "07000000003", { execution: { status: "COMPLETED", startedAt: STARTED, completedAt: DONE, outcome: "METER_DISCOVERED" } })];
  const data = facts({ rows, row: rows[0], parent: { ...facts().parent, status: "IN_PROGRESS", execution: { status: "IN_PROGRESS", startedAt: STARTED, completedAt: null } } });
  const plan = decideTakeOutOfBatch(data);
  assert.equal(plan.decision, DECISIONS.REMOVE);
  assert.equal(plan.after.branch, "COMPLETED");
  const parentPatch = buildTakeOutOfBatchWrites(plan, data, options)[3].data;
  assert.equal(parentPatch.status, "COMPLETED");
  assert.equal(parentPatch["execution.status"], "COMPLETED");
  assert.equal(parentPatch["execution.startedAt"], STARTED, "a stored time is kept, not rewritten");
  assert.equal(parentPatch["execution.completedAt"].toMillis(), DONE.toMillis());
});

test("the batch can still be allocated, unallocated and deleted after a meter is taken out", () => {
  // The rows-taken-out count feeds Allocate, Unallocate and Delete: this rule's removals must be counted too.
  assert.deepEqual(ROW_REMOVAL_RULES, ["TB-R056", "TB-R060"]);
  const data = facts();
  const entry = buildTakeOutOfBatchWrites(decideTakeOutOfBatch(data), data, options)[4].data;
  assert.equal(countRowsTakenOut([{ ...entry, id: `ROW_REMOVED__${entry.rowId}` }]), 1);
  assert.equal(countRowsTakenOut([{ ...entry, rule: "SOMETHING_ELSE", runId: "X" }]), 0);
});
