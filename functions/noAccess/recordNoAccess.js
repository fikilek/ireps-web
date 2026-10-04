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
//
// streetAddress.js is pure for the same reason, so importing it costs this module nothing.
import { formatPropertyType, formatStreetAddress } from "../premises/streetAddress.js";

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
  if (!text || normalizeUpper(text) === "NAV") throw noAccessError(code, `${field} is required.`);
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

  // NA-R030: a no access writes the premise the way every other transaction writes it -
  // { id, address, propertyType }, the address and the type as WORDS.
  //
  // This used to return { id } alone, and the TRN Registry showed NAv in the Address column
  // for every no access on DEV while 478 of the other 493 transactions showed their street.
  // The owner, 3 October: "remember, we've just agreed that there is no access without an
  // address". Stripping it made a complete record look like an incomplete one, and NAv is
  // supposed to mean something is missing - so it was pointing at a fault that did not exist
  // while hiding the one that did.
  //
  // NAv where there is genuinely nothing: the server fills both from the premise document
  // itself wherever it can, so NAv here is a real gap and worth investigating.
  return {
    id,
    address: formatStreetAddress(premise?.address) || "NAv",
    propertyType: formatPropertyType(premise?.propertyType) || "NAv",
  };
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
    const canonical = NO_ACCESS_REASON_CODES.find((code) => normalizeUpper(code) === upper);
    return { reasonCode: canonical, reasonOther: "NAv", reason: canonical };
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
    madeAt: normalizeText(appointment.madeAt) || null,
    // WHO IS ALWAYS THE SIGNED-IN CALLER, NEVER THE PHONE (owner's record, 3 Oct 2026).
    //
    // This took the phone's value FIRST and fell back to the caller. On his own capture the
    // phone sent "Fieldworker" - its own fallback, because its profile had no name - and that
    // beat the server's "Peter Peter". One record then carried two names for one person: the
    // appointment was made by "Fieldworker" and the record created by "Peter Peter".
    //
    // The server holds the auth token. It is the authority for who is calling, exactly as the
    // ERF is the authority for the municipality, and metadata already says so: "who, always
    // from the signed-in caller and never from the phone".
    madeByUid: normalizeText(actor.uid) || normalizeText(appointment.madeByUid) || "NAv",
    madeByUser: normalizeText(actor.name) || normalizeText(appointment.madeByUser) || "NAv",
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

/**
 * TR-R003 (0.6.0) — where a no access gets its position, and what it is allowed to call it.
 *
 * The owner, 3 October: "the AST location GPS must always be the asset location. The fallback
 * is the premise location, where the asset location doesn't exist."
 *
 * Two cases, and both are real. Measured on DEV the same day: of 46 no access records, 22
 * already had the meter - a Reading, an Inspection, a Disconnection, a Reconnection, a Removal
 * - and 24 did not, because the meter has never been found.
 *
 * The fallback always reaches. All 264 premises on DEV carry geometry.centroid and none is
 * without one, and NA-R044 makes a premise a prerequisite for every no access. So a no access
 * can never be left without a position, and the 90 transactions that have none today are all
 * repairable from their own premise.
 *
 * WHY THE LABEL IS NOT DECORATION. A premise point looks exactly like a meter point. Without
 * `source` a map of meters plots the premise and nobody can tell: a flat of twelve meters
 * shows twelve dots stacked on one spot and reads as twelve correct positions. That is the
 * fault the NAv rule exists to stop - the reader is misled and the defect stays invisible at
 * the same time. With the label every reader still gets a point, and one that needs the
 * meter's own position can tell whether it has one.
 *
 * It is a signal, not a tag. PREMISE on a first Discovery is normal and expected. PREMISE on a
 * Reading means a meter we have already found has no position of its own, which is a job.
 */
export const NO_ACCESS_LOCATION_SOURCE = Object.freeze({
  ASSET: "ASSET",
  PREMISE: "PREMISE",
});

/** A {lat, lng} if the value is one, otherwise null. Takes both spellings seen in the data. */
export function readGpsPoint(value) {
  const gps = value?.gps || value;
  if ([gps?.lat ?? gps?.latitude, gps?.lng ?? gps?.longitude].some((v) => v === null || v === undefined || v === "")) return null;
  const lat = Number(gps?.lat ?? gps?.latitude);
  const lng = Number(gps?.lng ?? gps?.longitude);
  if (
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180
  ) {
    return null;
  }
  return { lat, lng };
}

/**
 * The asset first, the premise as the fallback. Returns what belongs at `ast.location`.
 *
 * `assetLocation` is the ast document's own `ast.location` - measured on DEV, all 192 assets
 * keep their position there and none is without one.
 * `premiseGeometry` is the premise document's `geometry` - all 264 carry `centroid`.
 */
export function buildNoAccessLocation({ assetLocation, premiseGeometry } = {}) {
  const fromAsset = readGpsPoint(assetLocation);
  if (fromAsset) {
    return { gps: fromAsset, source: NO_ACCESS_LOCATION_SOURCE.ASSET };
  }

  const fromPremise = readGpsPoint(premiseGeometry?.centroid);
  if (fromPremise) {
    return { gps: fromPremise, source: NO_ACCESS_LOCATION_SOURCE.PREMISE };
  }

  // Neither. Under NA-R044 a no access always has a premise and a premise always has a
  // position, so reaching here means one of those two is broken - which is a refusal, not a
  // blank to be filled in. A no access with no position is a visit nobody can place.
  throw noAccessError(
    "NO_ACCESS_LOCATION_UNRESOLVED",
    "No position could be found for this no access: the meter has none and neither does the premise.",
  );
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
  const reason = normalizeNoAccessReason(input);
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
  // The ERF is checked first: a record that cannot say which ERF cannot say which premise
  // either, and the worker should be told the more fundamental thing.
  const geography = assertNoAccessGeography(accessData);
  const premise = normalizeNoAccessPremise(accessData.premise);

  // NA-R044 (1.3.0): a no access is to a PREMISE, and a premise is a prerequisite.
  //
  // An ERF can hold many premises - thirteen shops at one address is a real case on LIVE - so
  // a no access against an ERF alone names nothing a person can act on, and the open/closed
  // grouping cannot work on it: one open group for a whole block tells a manager nothing.
  //
  // This is the server's half. The phone's half is that a worker is never offered the work:
  // the gate holds the premise id before any form opens, and My Work Orders disables the
  // button on a row that has no premise (NA-R044.3). Nothing should ever reach here without
  // one - and if it does, it is refused rather than recorded in a form nobody can act on.
  if (!premise) {
    throw noAccessError(
      "NO_ACCESS_PREMISE_REQUIRED",
      "A No Access must say which premise could not be accessed.",
      { trnType: accessData.trnType },
    );
  }

  // No Access decides nothing ABOUT the ERF or the premise - that is settled before the work
  // is issued. It carries what it was given, and refuses when it was given too little.
  return {
    ...accessData,
    ...geography,
    premise,
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

/**
 * NA-R043 — where the municipality and the ward on a no access come from.
 *
 * The ERF is the authority for which municipality and ward a property is in, so they are read
 * from the ERF rather than taken from whatever the phone had cached. It also means the No
 * Access screen does not have to assemble them, and the two screens that open it cannot
 * assemble them two different ways — which is how this field set drifted everywhere else.
 *
 * The General Monthly Report reads `accessData.parents.lmPcode` and is indexed on it
 * (GMR-R027), so a no access that reached `trns` without it would be invisible to the report.
 */
export function buildNoAccessParentsFromErf(erf = {}) {
  const admin = erf?.admin || {};
  return {
    countryPcode: normalizeText(admin?.country?.pcode) || "ZA",
    provincePcode: normalizeText(admin?.province?.pcode) || "NAv",
    dmPcode: normalizeText(admin?.districtMunicipality?.pcode) || "NAv",
    lmPcode: normalizeUpper(admin?.localMunicipality?.pcode) || "NAv",
    wardPcode: normalizeUpper(admin?.ward?.pcode) || "NAv",
  };
}

/** True when a payload's parents cannot place the work for the monthly report. */
export function noAccessParentsAreMissing(parents = {}) {
  const lm = normalizeUpper(parents?.lmPcode);
  return !lm || lm === "NAV";
}
