// No Access rules NA-R001 (1.0.0), schema no_access_record 1.0.0.
//
// ONE no access record, for every transaction type that can end in one, whether or not the
// worker was sent by a targeted batch. A no access is a visit where the field worker went to
// the property and could not touch the meter with their own hand.
//
// This module is the universal half: it validates a submission and builds the record. The
// batch bookkeeping that follows a no access on a batch row is the other half, and lives
// beside its completion twin in targetedBatches/premiseLink.js.
//
// Nothing here is new logic. It is moved from recordTargetedBatchNoAccessCallable, which is
// deleted once no phone still holds work queued against it.

// This module stays PURE — no Firestore, no SDK, no clock it does not own. Every callable
// that records a no access depends on it, so it has to be the cheapest thing in the tree to
// test: the gate tests below run without an emulator. That is why these two primitives are
// written here rather than imported from targetedBatches/helpers.js, which pulls in
// firebase-admin for a Timestamp this module never uses.
const normalizeText = (value) => String(value ?? "").trim();
const normalizeUpper = (value) => normalizeText(value).toUpperCase();

export const NO_ACCESS_OTHER_CODE = "OTHER";

// NA-R004: one list. The phone reads its own copy for the dropdown; this is what the server
// will accept, and the two are kept the same by NA-R004, not by a build step.
export const NO_ACCESS_REASON_CODES = Object.freeze([
  "Property Locked",
  "Access Refused by Occupant",
  "Unsafe / Dangerous Environment",
  "Meter Box Inaccessible",
  "Meter Obstructed",
  "Property Demolished",
  "Property Vacant",
  NO_ACCESS_OTHER_CODE,
]);

const NO_ACCESS_REASON_CODE_SET = new Set(
  NO_ACCESS_REASON_CODES.map((code) => normalizeUpper(code)),
);

export function noAccessError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.irepsCode = code;
  error.details = details;
  return error;
}

function requireText(value, field, code) {
  const text = normalizeText(value);
  if (!text) throw noAccessError(code, `${field} is required.`);
  return text;
}

/**
 * NA-R043 — every no access carries its ERF, on both paths.
 *
 * "There can be no access data without knowing what it is that you were not able to access"
 * (owner, 1 October 2026). Until now the Sales Path screen demanded this and the Meter
 * Discovery validator never asked, because its no-access branch returned before the
 * geography checks. That is the defect this closes.
 */
export function assertNoAccessGeography({ erfId, erfNo } = {}) {
  return {
    // The ERF ID is the requirement. It is identity: it resolves into everything else, so a
    // record carrying it can always be placed. "All you need is the ID of the ERF ... if
    // there is any query, we go and check what that ID belongs to" (owner, 2026-10-01).
    erfId: requireText(erfId, "accessData.erfId", "NO_ACCESS_ERF_REQUIRED"),

    // The ERF NUMBER is not the ERF ID and is not a gate (owner, 2026-10-02). It is a label
    // a person reads, derivable from the ID, and enrichment under GMR-R006 — which may add
    // descriptive values but never decides whether a record stands. It is carried when the
    // phone has it, because it is free and saves a lookup, and reads NAv when it does not.
    erfNo: normalizeText(erfNo) || "NAv",
  };
}

/**
 * NA-R084.1 — the premise is carried only when it existed at the moment of the visit: the
 * worker had already made it, the work arrived carrying one, or the worker named it on the
 * form (NA-R010.1). It is never looked up here and never written on afterwards.
 *
 * NA-R034 — a reference the server follows is null when absent, never the text NAv. An NAv
 * in an id satisfies an "is it there?" check and then points at nothing, which is the fault
 * RG-R001 records.
 */
/**
 * NA-R043 / NA-R034 — the ERF number is a label a person reads, not a gate. It is carried
 * when the phone has it and reads NAv when it does not. The rule lives here, with the other
 * no-access rules, rather than in each callable that happens to record one.
 */
export function readNoAccessErfNo(erfNo) {
  return normalizeText(erfNo) || "NAv";
}

export function normalizeNoAccessPremise(premise) {
  const id = normalizeText(premise?.id ?? premise);
  if (!id || normalizeUpper(id) === "NAV") return null;
  return { id };
}

/**
 * NA-R030/NA-R031 — one reason encoding. Five field names held this between them
 * (reason, reasonSelect, noAccessReason, reasonText, and a top-level reason on the payload),
 * with three encodings of "Other". All of them collapse to these three fields.
 */
export function normalizeNoAccessReason(input = {}) {
  const rawCode = normalizeText(input.reasonCode ?? input.reason);
  if (!rawCode) {
    throw noAccessError("NO_ACCESS_REASON_REQUIRED", "A No Access reason is required.");
  }

  const upper = normalizeUpper(rawCode);
  if (!NO_ACCESS_REASON_CODE_SET.has(upper)) {
    throw noAccessError(
      "NO_ACCESS_REASON_INVALID",
      "The No Access reason is not one of the agreed reasons.",
      { reasonCode: rawCode },
    );
  }

  if (upper !== NO_ACCESS_OTHER_CODE) {
    // NA-R032: nothing to write means NAv in a field a reader reads.
    return { reasonCode: rawCode, reasonOther: "NAv", reason: rawCode };
  }

  const other = normalizeText(input.reasonOther);
  if (!other) {
    throw noAccessError(
      "NO_ACCESS_REASON_OTHER_REQUIRED",
      "An Other No Access reason must say what it was.",
    );
  }

  return {
    reasonCode: NO_ACCESS_OTHER_CODE,
    reasonOther: other,
    reason: other,
  };
}

/**
 * TEMPORARY, AND DATED: read a reason out of whatever a phone still sends.
 *
 * Retired at stage 5 of the implementation plan, once no phone in the field still holds work
 * queued under an older build. Until then it exists for exactly one reason: a worker who
 * walked to a property, could not get in, and captured the visit with no signal must not have
 * that visit REFUSED because their app predates this change. That is work already done.
 *
 * This is not an accommodation of dirty data — the data is cleaned and the writers are fixed.
 * It is a door held open for submissions already in flight, and it closes on a date.
 *
 * The shapes it understands, all of which exist in the field today:
 *   { reasonCode, reasonOther }             the one shape, after this sprint
 *   { reason: "Property Locked" }           Meter Discovery, Meter Installation
 *   { reason: "Other: Vicious dogs" }       the sentence encoding
 *   { reason: { code, label, otherText } }  the structured encoding
 *   { reasonSelect, reason }                Inspection, Reading, DCN, RCN, Removal
 *   { noAccessReason } / { reasonText }     the lifecycle completion path
 */
export function readIncomingNoAccessReason(access = {}) {
  if (normalizeText(access.reasonCode)) {
    return { reasonCode: access.reasonCode, reasonOther: access.reasonOther };
  }

  const raw = access.reason;

  // The structured encoding: { code, label, otherText }.
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return {
      reasonCode: normalizeText(raw.code) || normalizeText(raw.label),
      reasonOther: raw.otherText,
    };
  }

  const candidate =
    normalizeText(access.reasonSelect) ||
    normalizeText(raw) ||
    normalizeText(access.noAccessReason) ||
    normalizeText(access.reasonText);

  // The sentence encoding: "Other: <the worker's words>", and a bare "Other".
  const sentence = /^other\s*:?\s*(.*)$/i.exec(candidate);
  if (sentence) {
    return {
      reasonCode: NO_ACCESS_OTHER_CODE,
      reasonOther:
        normalizeText(sentence[1]) ||
        normalizeText(access.reasonOther) ||
        normalizeText(access.noAccessReason) ||
        normalizeText(access.reasonText),
    };
  }

  return { reasonCode: candidate, reasonOther: access.reasonOther };
}

/**
 * NA-R020 … NA-R027 — the NA Appointment.
 *
 * Optional on every reason. The phone checks that it is in the future at capture (NA-R023);
 * the server does NOT check that again (NA-R026), because a phone out of signal overnight
 * would otherwise have honest work refused for arriving late. The value is stored exactly as
 * captured and is never shifted or recalculated (NA-R025). There is no upper limit on how
 * far ahead it may be (owner, 2 October 2026).
 */
export function normalizeNoAccessAppointment(appointment, { actor = {} } = {}) {
  if (appointment === null || appointment === undefined) return null;

  const at = normalizeText(appointment.at);
  if (!at) {
    throw noAccessError(
      "NO_ACCESS_APPOINTMENT_INVALID",
      "An appointment must say when it is.",
    );
  }

  const when = new Date(at);
  if (Number.isNaN(when.getTime())) {
    throw noAccessError(
      "NO_ACCESS_APPOINTMENT_INVALID",
      "The appointment time could not be read.",
      { at },
    );
  }

  return {
    at: when.toISOString(),
    madeAt: normalizeText(appointment.madeAt) || new Date().toISOString(),
    madeByUid: normalizeText(appointment.madeByUid) || normalizeText(actor.uid) || "NAv",
    madeByUser: normalizeText(appointment.madeByUser) || normalizeText(actor.name) || "NAv",
  };
}

/**
 * The photograph (NA-R010) and the position. Both were already demanded on every path; they
 * are gathered here so one module says what a complete no access is.
 */
export function assertNoAccessMedia(media) {
  if (!Array.isArray(media)) {
    throw noAccessError("MEDIA_INVALID", "media must be an array.");
  }
  const hasPhoto = media.some(
    (item) => item?.tag === "noAccessPhoto" && normalizeText(item?.url || item?.uri),
  );
  if (!hasPhoto) {
    throw noAccessError(
      "NO_ACCESS_PHOTO_REQUIRED",
      "A No Access photograph is required.",
    );
  }
  return media;
}

export function assertNoAccessLocation(location) {
  const gps = location?.gps || location;
  const lat = Number(gps?.lat);
  const lng = Number(gps?.lng);
  if (
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180
  ) {
    throw noAccessError(
      "LOCATION_INVALID",
      "location.gps must contain valid lat and lng values.",
    );
  }
  return { ...location, gps: { lat, lng } };
}

/**
 * NA-R031.1 — hasAccess is the one marker every consumer reads, and this writer sets it
 * itself, unconditionally.
 *
 * A meter's no-access COUNT rises on an execution outcome of NO_ACCESS or on hasAccess "no",
 * while the WINDOW behind that number queries hasAccess alone. They agree today only because
 * withResolvedNoAccessAccessBlock sets it. A writer that recorded a no access without setting
 * it would make the count disagree with the list it opens — eleven claimed, eight shown,
 * which is the September report fault.
 */
export function buildNoAccessAccessBlock(input = {}, { actor = {} } = {}) {
  const reason = normalizeNoAccessReason(readIncomingNoAccessReason(input));
  return {
    hasAccess: "no",
    ...reason,
    appointment: normalizeNoAccessAppointment(input.appointment, { actor }),
  };
}

/**
 * The whole accessData contribution of a no access: what was not accessed, and why.
 *
 * Callers pass what they already hold. This never reads a document, so it cannot resolve a
 * premise through a batch row — NA-R050 forbids that at read time too, because a row's
 * premise can be swapped (TB-R067) and a past visit would change what it appears to say.
 */
/**
 * Take the accessData a form sent and return it in the one shape, with the ERF gate applied.
 *
 * This is the single door every callable goes through, so the gate cannot be enforced on one
 * path and forgotten on another — which is the exact fault this sprint exists to fix. Meter
 * Discovery is validated by meterDiscovery/validation.js before it ever reaches here; Meter
 * Installation is NOT validated by anything, so without this it would have kept accepting a
 * no access that nobody can place.
 */
export function normalizeNoAccessAccessData(accessData = {}, { actor = {} } = {}) {
  const geography = assertNoAccessGeography(accessData);

  return {
    ...accessData,
    ...geography,
    premise: normalizeNoAccessPremise(accessData.premise),
    access: buildNoAccessAccessBlock(accessData.access, { actor }),
  };
}

export function buildNoAccessData({ trnType, erfId, erfNo, premise, reason, media, location, actor, parents } = {}) {
  const geography = assertNoAccessGeography({ erfId, erfNo });

  assertNoAccessMedia(media);
  assertNoAccessLocation(location);

  return {
    trnType: requireText(trnType, "accessData.trnType", "NO_ACCESS_TRN_TYPE_REQUIRED"),
    ...geography,
    ...(parents ? { parents } : {}),
    premise: normalizeNoAccessPremise(premise),
    access: buildNoAccessAccessBlock(reason, { actor }),
  };
}
