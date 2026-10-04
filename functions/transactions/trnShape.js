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
 * TR-R001 0.8.0 (owner, 4 Oct 2026): THE KIND OF WORK IS IN `accessData`, AND ONLY THERE.
 * "we already have it under accessData ... so we are redundant here." This used to copy it to
 * the root as well, for one day. Two homes for one fact is the thing this module exists to
 * stop, so the copy goes and `accessData.trnType` - the home every transaction already had -
 * stands alone.
 *
 * It only ever ADDS what is missing. A key the form filled is never touched, and a key that is
 * absent becomes `{}` — never `null`, which a reader would have to test for just the same.
 */
export function applyTrnRootShape(payload = {}) {
  if (!payload || typeof payload !== "object") return payload;

  for (const key of TRN_ROOT_OBJECT_KEYS) {
    const value = payload[key];
    if (value === undefined || value === null) payload[key] = {};
  }

  return payload;
}


// TR-R001 section 2: the WHOLE declared root. Nothing else belongs on a transaction.
export const TRN_DECLARED_ROOT_KEYS = Object.freeze([
  "id",
  // TR-R001 0.8.0: no `trnType` here. It is in `accessData` and nowhere else, so the strip
  // below takes a root copy off anything that still sends one.
  "accessData",
  "metadata",
  "meterType",
  "ast",
  "media",
  // TR-R001 0.9.0 (owner, 4 Oct 2026): the worker's own words, on the transactions whose form
  // asks for them. It stays DECLARED so the strip never throws away a comment a worker wrote -
  // but it is no longer defaulted onto a transaction that cannot carry one. A no access form
  // has no comment box, so a default would put an empty field on every one of them forever,
  // and an always-empty field reads as "the worker had nothing to say" when the truth is that
  // nobody asked.
  "fieldComment",
  ...TRN_ROOT_OBJECT_KEYS,
  // The one property named for the work (TR-R001). A no access carries none of them.
  "commissioning",
  "disconnection",
  "reconnection",
  "removal",
  "inspection",
  "meterReading",
  "discovery",
  "installation",
]);

/**
 * Cut a transaction down to the agreed root, in place.
 *
 * The owner, 3 October: "We agreed on the root structure of the transaction. And now you're
 * going outside that." A no access was reaching `trns` with capturedAt, sourceModule,
 * executionOutcome, geofenceRefs, bucket and more hanging off the root - none of them in
 * TR-R001, none of them ever put to him.
 *
 * WHAT IS KEPT RATHER THAN DROPPED. The batch a job came from is real and the monthly report
 * needs it. TR-R001 already declares where it goes: `origin` is "where the work came from -
 * field or office, and what it followed". So it moves INTO origin instead of being thrown
 * away. Nothing else is moved: a key with no declared home is dropped, because a transaction
 * carries the agreed root and nothing else.
 */
export function stripToDeclaredRoot(payload = {}, { actor = null } = {}) {
  if (!payload || typeof payload !== "object") return payload;

  const batch = payload.targetedBatchContext;

  if (batch && typeof batch === "object") {
    payload.origin = {
      ...(payload.origin && typeof payload.origin === "object" ? payload.origin : {}),
      targetedBatch: batch,
    };
  }

  // WHO IS THE SIGNED-IN CALLER, ON THE PHOTOGRAPHS TOO (owner's record, 3 Oct 2026).
  //
  // The appointment was fixed this afternoon and the media was left. 35 photographs carry
  // `byUser: "Fieldworker"` - the PHONE's fallback, because its profile had no name - beside a
  // record created by "Peter Peter". One visit, two names for one person, and the photograph
  // is the evidence the visit happened.
  if (actor && Array.isArray(payload.media)) {
    payload.media = payload.media.map((item) => {
      if (!item || typeof item !== "object") return item;

      const stamp = (who) =>
        who && typeof who === "object"
          ? { ...who, byUid: actor.uid || who.byUid, byUser: actor.name || who.byUser }
          : who;

      return { ...item,
        ...(item.created !== undefined ? { created: stamp(item.created) } : {}),
        ...(item.updated !== undefined ? { updated: stamp(item.updated) } : {}),
      };
    });
  }

  const declared = new Set(TRN_DECLARED_ROOT_KEYS);

  for (const key of Object.keys(payload)) {
    if (!declared.has(key)) delete payload[key];
  }

  return payload;
}
