import { batchError } from "./sales-batch-resolution.js";

// Targeted Batch rules TB-R033 (deletion) and TB-R048 (unallocation, 1.3.33) share one test for
// "no field work has started". Both actions call these helpers so the test can never drift apart.
// `action` only names the action in the message ("deletion" or "unallocation"); the codes are fixed.

export function assertUnexecuted(parent, rows, action = "deletion") {
  if (parent.schemaVersion === "0.3.0" && (parent.execution?.status !== "NOT_STARTED" || rows.some(row => row.execution?.status !== "NOT_STARTED"))) throw batchError("EXECUTION_STATE_INVALID", "Canonical execution state must prove that no work has started");
  if (!["NOT_STARTED", undefined].includes(parent.execution?.status) || parent.execution?.startedAt || parent.execution?.completedAt || parent.counts?.executionStartedRows > 0 || parent.counts?.completedRows > 0 || ["IN_PROGRESS", "COMPLETED"].includes(parent.status)) throw batchError("EXECUTION_STARTED", `Execution permanently blocks batch ${action}`);
  for (const row of rows) {
    if (!["NOT_STARTED", undefined].includes(row.execution?.status) || row.execution?.startedAt || row.execution?.completedAt || row.execution?.outcome) throw batchError("EXECUTION_STARTED", `Execution on ${row.id} permanently blocks ${action}`);
  }
}

// A row's linked premise, meter or transaction is execution evidence. Fresh rows carry none, and a
// link whose record is missing cannot be proven safe, so it blocks too.
export async function assertNoLinkedExecution({ db, read, parent, row, action = "deletion" }) {
  for (const [key, collection] of [["premiseId", "premises"], ["meterId", "asts"], ["trnId", "trns"]]) {
    const id = row.refs?.[key];
    if (!id) continue;
    const linked = await read(db.doc(`${collection}/${id}`));
    if (linked.exists) {
      const record = linked.data();
      const linkedBatch = record.source?.tbId || record.targetedBatch?.tbId || record.targetedBatchId;
      if (key === "trnId" || key === "premiseId" || linkedBatch === parent.id || record.execution?.startedAt) throw batchError("LINKED_EXECUTION_PRESENT", `Linked ${collection} evidence blocks ordinary ${action}`);
    } else throw batchError("LINKED_EVIDENCE_MISSING", `Linked ${collection} evidence is unavailable; ${action} cannot be proven safe`);
  }
}
