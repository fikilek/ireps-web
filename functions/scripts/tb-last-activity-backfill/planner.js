// Targeted Batch rules TB-R069 (1.3.87): a batch made before 1.3.87 gets its lastActivity written once,
// from what the batch and its rows already record. Pure: no Firestore here, so it can be tested.
import { LAST_ACTIVITY_KINDS } from "../../targetedBatches/lastActivity.js";

const toMs = value => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value) || 0;
  if (typeof value._seconds === "number") return value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1e6);
  if (typeof value.seconds === "number") return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  return 0;
};

// A No Access entry records the phone's capture time as UTC date and time (recordTargetedBatchNoAccessCallable).
const noAccessMs = entry => Date.parse(`${entry?.date}T${entry?.time}Z`) || 0;

// batch: the tb_uploads document; rows: its tb_rows; salesById: the rows' Sales documents.
// Returns { atMs, kind, byUid, byUser } for the latest of the five events, or null when there is none.
export function planLastActivity(batch = {}, rows = [], salesById = {}) {
  const candidates = [
    { atMs: toMs(batch?.allocation?.completedAt), kind: LAST_ACTIVITY_KINDS.ALLOCATED,
      byUid: batch?.allocation?.allocatedByUid, byUser: batch?.allocation?.allocatedByUser },
    { atMs: toMs(batch?.acceptance?.acceptedAt), kind: LAST_ACTIVITY_KINDS.ACCEPTED,
      byUid: batch?.acceptance?.acceptedByUid, byUser: batch?.acceptance?.acceptedByUser },
  ];

  for (const row of rows) {
    // The row starts when a premise is joined to it (a No Access needs a premise first, so it comes after).
    if (row?.refs?.premiseId) {
      candidates.push({ atMs: toMs(row?.execution?.startedAt), kind: LAST_ACTIVITY_KINDS.PREMISE, byUid: null, byUser: null });
    }
    if (String(row?.execution?.status || "").toUpperCase() === "COMPLETED" && row?.refs?.meterId) {
      // The row's updatedBy may be a later office edit, so the finder is not guessed: NAv.
      candidates.push({ atMs: toMs(row?.execution?.completedAt), kind: LAST_ACTIVITY_KINDS.METER, byUid: null, byUser: null });
    }
    const sales = salesById[row?.salesAllMeterId];
    // Older Sales links name the batch in tbId, newer ones in id.
    const ref = (sales?.tbRefs || []).find(entry => (entry?.id || entry?.tbId) === batch?.id && (!entry?.rowId || entry.rowId === row?.id));
    for (const entry of ref?.fieldWork?.noAccess || []) {
      candidates.push({ atMs: noAccessMs(entry), kind: LAST_ACTIVITY_KINDS.NO_ACCESS, byUid: null, byUser: entry?.user });
    }
  }

  const latest = candidates.filter(c => c.atMs > 0).reduce((best, c) => (!best || c.atMs > best.atMs ? c : best), null);
  if (!latest) return null;
  return { atMs: latest.atMs, kind: latest.kind, byUid: latest.byUid || null, byUser: latest.byUser || null };
}
