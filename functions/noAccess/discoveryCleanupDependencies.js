import assert from "node:assert/strict";
import { readTbRefBatchId } from "../salesAllMeters/sales-batch-policy.js";

const contextOf = (value) => value.origin?.targetedBatch || value.targetedBatchContext;
export function recordedTimeToIso(value) {
  if (value == null) return null;
  const seconds = value?.seconds ?? value?._seconds;
  const nanos = value?.nanoseconds ?? value?._nanoseconds;
  const millis = typeof value === "string" ? Date.parse(value)
    : Number.isInteger(seconds) && Number.isInteger(nanos) && nanos >= 0 && nanos < 1e9 ? seconds * 1000 + nanos / 1e6 : NaN;
  assert.ok(Number.isFinite(millis), "Unreadable recorded timestamp");
  return new Date(millis).toISOString();
}
const summaryOf = (value) => {
  const captured = recordedTimeToIso(value.metadata?.createdOnDevice || value.metadata?.createdAt);
  assert.ok(typeof captured === "string" && Number.isFinite(Date.parse(captured)), "Cannot identify the batch visit without a recorded timestamp");
  return { date: captured.slice(0, 10), time: captured.slice(11, 19), user: value.metadata?.createdByUser || "NAv" };
};
const sameSummary = (a, b) => ["date", "time", "user"].every(key => a[key] === b[key]);

// Scope is an explicitly reviewed set of Discovery visit IDs, never a collection reset.
// Unknown references and ambiguous batch summaries stop the run before it writes anything.
export function planDiscoveryCleanupDependencies(records, deletionIds) {
  const ids = new Set(deletionIds);
  const changes = new Map(), deletes = new Set();
  for (const [refPath, value] of records) {
    const [collection, id] = refPath.split("/");
    if (collection === "trns" && ids.has(id)) continue;
    let remaining = value;
    if (collection === "premises" && Array.isArray(value.noAccessTrnIds)) {
      const next = value.noAccessTrnIds.filter(item => !ids.has(item));
      if (next.length !== value.noAccessTrnIds.length) {
        changes.set(refPath, { noAccessTrnIds: next });
        remaining = { ...value, noAccessTrnIds: next };
      }
    }
    if (["report_trn_no_access", "noAccessReconciliationFailures"].includes(collection) && ids.has(id)) {
      deletes.add(refPath);
      continue;
    }
    const json = JSON.stringify(remaining);
    assert.ok(![...ids].some(deletedId => id === deletedId || json.includes(deletedId)), `Unreviewed reference in ${refPath}`);
  }

  for (const id of ids) {
    const visit = records.get(`trns/${id}`);
    assert.equal(visit?.accessData?.trnType, "METER_DISCOVERY");
    assert.equal(visit?.accessData?.access?.hasAccess, "no");
    const context = contextOf(visit);
    if (!context?.salesDocId || !context?.rowId) continue; // Field origin or reporting-only batch attribution.
    const refPath = `sales-all-meters/${context.salesDocId}`;
    const sales = records.get(refPath);
    assert.ok(sales, `Missing Sales record ${refPath}`);
    const refs = changes.get(refPath)?.tbRefs || sales.tbRefs;
    assert.ok(Array.isArray(refs), `Missing batch references ${refPath}`);
    const matches = refs.map((ref, index) => ({ ref, index })).filter(({ ref }) => readTbRefBatchId(ref) === context.tbId && ref.rowId === context.rowId);
    assert.equal(matches.length, 1, `Ambiguous batch reference ${id}`);
    const { ref, index } = matches[0];
    const summary = summaryOf(visit);
    const visits = ref.fieldWork?.noAccess;
    assert.ok(Array.isArray(visits), `Missing batch history ${id}`);
    assert.equal(visits.filter(item => sameSummary(item, summary)).length, 1, `Ambiguous batch history ${id}`);
    // A summary has no TRN id. Refuse to remove it if another surviving visit has the same key.
    for (const [otherPath, other] of records) {
      if (!otherPath.startsWith("trns/") || ids.has(otherPath.slice(5)) || other.accessData?.access?.hasAccess !== "no") continue;
      const otherContext = contextOf(other);
      if (otherContext?.salesDocId === context.salesDocId && otherContext?.rowId === context.rowId && otherContext?.tbId === context.tbId) {
        assert.ok(!sameSummary(summaryOf(other), summary), `Batch summary shared with ${otherPath}`);
      }
    }
    const nextRefs = [...refs];
    nextRefs[index] = { ...ref, fieldWork: { ...ref.fieldWork, noAccess: visits.filter(item => !sameSummary(item, summary)) } };
    changes.set(refPath, { tbRefs: nextRefs });
  }
  return { changes: [...changes].map(([path, patch]) => ({ path, patch })).sort((a, b) => a.path.localeCompare(b.path)), deletes: [...deletes].sort() };
}
