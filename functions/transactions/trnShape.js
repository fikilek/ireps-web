// TR-R001 (0.6.0) — every transaction carries the same root.
//
// The owner, 3 October: "all trns must have the same root, except the specific property
// belonging to that trn." Where a key does not apply it is PRESENT AND EMPTY, never absent, so
// a reader may take it without first testing that it is there.
//
// WHY THIS MODULE EXISTS. On 3 October the backfill put all 493 transactions into the agreed
// shape, and the very next capture came in without it: no `trnType` at the root and none of
// `assignment`, `origin`, `serviceProvider`, `status` or `workflow`. The data had been
// repaired and the writer had not, so the records were drifting back out as fast as they were
// made — and the repaired ones sitting beside them made it look fixed.
//
// NA-R080 is the rule that was broken: writers first, then data. This is the writer's half.
//
// PURE — no Firestore, no SDK, no clock. It shapes a plain object and nothing else.

// TR-R001 section 2: the root objects that are present on every transaction, every type.
export const TRN_ROOT_OBJECT_KEYS = Object.freeze([
  "status",
  "assignment",
  "origin",
  "workflow",
  "serviceProvider",
]);

/**
 * Put a payload into the agreed root shape, in place.
 *
 * `trnType` at the root, agreeing with the one in `accessData` — TR-R001 requires both, and
 * the two always say the same thing.
 *
 * It only ever ADDS what is missing. A key the form filled is never touched, and a key that is
 * absent becomes `{}` — never `null`, which a reader would have to test for just the same.
 */
export function applyTrnRootShape(payload = {}) {
  if (!payload || typeof payload !== "object") return payload;

  const trnType = String(payload?.accessData?.trnType || payload?.trnType || "").trim();
  if (trnType) payload.trnType = trnType;

  for (const key of TRN_ROOT_OBJECT_KEYS) {
    const value = payload[key];
    if (value === undefined || value === null) payload[key] = {};
  }

  return payload;
}
