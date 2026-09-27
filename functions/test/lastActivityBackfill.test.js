import test from "node:test";
import assert from "node:assert/strict";
import { planLastActivity } from "../scripts/tb-last-activity-backfill/planner.js";

// Targeted Batch rules TB-R069 (1.3.87): batches made before 1.3.87 are filled in once from what they record.
const T = iso => Date.parse(iso);
const batch = { id: "TB1", allocation: { completedAt: T("2026-09-20T08:00:00Z"), allocatedByUid: "M1", allocatedByUser: "Manager" },
  acceptance: { acceptedAt: T("2026-09-20T09:00:00Z"), acceptedByUid: "F1", acceptedByUser: "Worker" } };

test("the latest of the five events wins", () => {
  const rows = [
    { id: "R1", salesAllMeterId: "S1", refs: { premiseId: "P1" }, execution: { status: "IN_PROGRESS", startedAt: T("2026-09-21T10:00:00Z") } },
    { id: "R2", salesAllMeterId: "S2", refs: { premiseId: "P2", meterId: "A2" }, metadata: { updatedByUid: "F2", updatedByUser: "Finder" },
      execution: { status: "COMPLETED", startedAt: T("2026-09-21T11:00:00Z"), completedAt: T("2026-09-22T12:00:00Z") } },
  ];
  const sales = { S1: { tbRefs: [{ id: "TB1", rowId: "R1", fieldWork: { noAccess: [{ date: "2026-09-23", time: "07:30:00", user: "Worker" }] } }] } };
  assert.deepEqual(planLastActivity(batch, rows, sales), { atMs: T("2026-09-23T07:30:00Z"), kind: "NO_ACCESS", byUid: null, byUser: "Worker" });
  assert.deepEqual(planLastActivity(batch, rows, {}), { atMs: T("2026-09-22T12:00:00Z"), kind: "METER", byUid: null, byUser: null });
  const older = { S1: { tbRefs: [{ tbId: "TB1", fieldWork: { noAccess: [{ date: "2026-09-23", time: "07:30:00", user: "Worker" }] } }] } };
  assert.equal(planLastActivity(batch, rows, older).kind, "NO_ACCESS", "older links name the batch in tbId");
  assert.equal(planLastActivity(batch, [], {}).kind, "ACCEPTED");
});

test("a batch never allocated has no activity", () => {
  assert.equal(planLastActivity({ id: "TB2", metadata: { updatedAt: T("2026-09-25T00:00:00Z") } }, [], {}), null);
});
