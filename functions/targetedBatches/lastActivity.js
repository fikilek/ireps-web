// Targeted Batch rules TB-R069 (1.3.87): the batch's last activity, which Sales Reporting sorts by.
// Only these five events write it, each in the same write that records the work. Nothing else does:
// not rejection, unallocation, taking a row out, recounts or clean-ups (they still move metadata.updatedAt).
export const LAST_ACTIVITY_KINDS = Object.freeze({
  ALLOCATED: "ALLOCATED",
  ACCEPTED: "ACCEPTED",
  PREMISE: "PREMISE",
  NO_ACCESS: "NO_ACCESS",
  METER: "METER",
});

// The field to merge into a tb_uploads update. at: a Timestamp or the server-timestamp sentinel.
export function lastActivityPatch(kind, at, actor = {}) {
  if (!LAST_ACTIVITY_KINDS[kind]) throw new Error(`Unknown batch activity: ${kind}`);
  return {
    lastActivity: {
      at,
      kind,
      byUid: actor.uid || null,
      byUser: actor.user || actor.name || null,
    },
  };
}

const toMillis = value => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "number") return value;
  return Date.parse(value) || 0;
};

// A meter that closes a row when the rule re-runs (after allocation or acceptance, or a find made before
// the row started) happened at the find, not now. It is written at the find's time, and only when that is
// later than the batch's last activity, so it never hides a later Accepted or reports an old find as new.
export function laterActivityPatch(parent, kind, atMs, at, actor = {}) {
  if (!Number.isFinite(atMs) || atMs <= toMillis(parent?.lastActivity?.at)) return {};
  return lastActivityPatch(kind, at, actor);
}
