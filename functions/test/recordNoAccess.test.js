// No Access rules NA-R001 (1.0.0) — one gate, one test.
//
// These lock the rules the owner settled on 1 and 2 October 2026. A test here failing means
// a no access could be recorded that nobody can place, or that two consumers would read two
// different ways.

import test from "node:test";
import assert from "node:assert/strict";

import {
  assertNoAccessGeography,
  buildNoAccessParentsFromErf,
  noAccessParentsAreMissing,
  assertNoAccessLocation,
  buildNoAccessLocation,
  readGpsPoint,
  NO_ACCESS_LOCATION_SOURCE,
  assertNoAccessMedia,
  buildNoAccessAccessBlock,
  buildNoAccessData,
  normalizeNoAccessAppointment,
  normalizeNoAccessAccessData,
  normalizeNoAccessPremise,
  normalizeNoAccessReason,
} from "../noAccess/recordNoAccess.js";

const PHOTO = [{ tag: "noAccessPhoto", url: "https://example/one.jpg" }];
const GPS = { gps: { lat: -26.2, lng: 28.04 } };
const ACTOR = { uid: "UID_1", name: "Siya Siya" };

function code(fn) {
  try {
    fn();
  } catch (error) {
    return error?.irepsCode || error?.code || "NO_CODE";
  }
  return "NO_ERROR_THROWN";
}

/* ------------------------------------------------------------------ *
 * NA-R043 — the ERF, on both paths
 * ------------------------------------------------------------------ */

test("NA-R043: a no access without an ERF id is refused", () => {
  assert.equal(
    code(() => assertNoAccessGeography({ erfId: "", erfNo: "5214" })),
    "NO_ACCESS_ERF_REQUIRED",
  );
});

test("NA-R043: the ERF NUMBER is not a gate — the ID is", () => {
  // The owner, 2 October 2026: the ERF number is not the ERF ID, they are different things.
  // The ID is identity and resolves into everything else; the number is a label a person
  // reads, and enrichment under GMR-R006 never decides whether a record stands.
  const geography = assertNoAccessGeography({ erfId: "ERF_1", erfNo: "" });
  assert.equal(geography.erfId, "ERF_1");
  assert.equal(geography.erfNo, "NAv");
});

test("NA-R043: the ERF number is carried when the phone has it", () => {
  assert.deepEqual(
    assertNoAccessGeography({ erfId: " ERF_1 ", erfNo: " 5214 " }),
    { erfId: "ERF_1", erfNo: "5214" },
  );
});

/* ------------------------------------------------------------------ *
 * NA-R031.1 — hasAccess is the one marker, always set here
 * ------------------------------------------------------------------ */

test("NA-R031.1: the writer sets hasAccess no itself", () => {
  const block = buildNoAccessAccessBlock({ reasonCode: "Property Locked" }, { actor: ACTOR });
  assert.equal(block.hasAccess, "no");
});

test("NA-R031.1: a caller cannot talk it out of hasAccess no", () => {
  const block = buildNoAccessAccessBlock(
    { reasonCode: "Property Locked", hasAccess: "yes" },
    { actor: ACTOR },
  );
  assert.equal(block.hasAccess, "no");
});

/* ------------------------------------------------------------------ *
 * NA-R030/NA-R031 — one reason encoding
 * ------------------------------------------------------------------ */

test("NA-R031: a listed reason fills all three fields, with NAv where nothing is due", () => {
  assert.deepEqual(normalizeNoAccessReason({ reasonCode: "Property Locked" }), {
    reasonCode: "Property Locked",
    reasonOther: "NAv",
    reason: "Property Locked",
  });
});

test("NA-R031: Other carries the worker's own words", () => {
  assert.deepEqual(
    normalizeNoAccessReason({ reasonCode: "OTHER", reasonOther: "Vicious dogs" }),
    { reasonCode: "OTHER", reasonOther: "Vicious dogs", reason: "Vicious dogs" },
  );
});

test("NA-R031: Other with nothing said is refused", () => {
  assert.equal(
    code(() => normalizeNoAccessReason({ reasonCode: "OTHER" })),
    "NO_ACCESS_REASON_OTHER_REQUIRED",
  );
});

test("NA-R031: a reason off the list is refused", () => {
  assert.equal(
    code(() => normalizeNoAccessReason({ reasonCode: "Could not be bothered" })),
    "NO_ACCESS_REASON_INVALID",
  );
});

test("NA-R031: no reason at all is refused", () => {
  assert.equal(code(() => normalizeNoAccessReason({})), "NO_ACCESS_REASON_REQUIRED");
});

test("owner 2 Oct: Property Vacant and Property Demolished stay on the list", () => {
  assert.equal(normalizeNoAccessReason({ reasonCode: "Property Vacant" }).reasonCode, "Property Vacant");
  assert.equal(normalizeNoAccessReason({ reasonCode: "Property Demolished" }).reasonCode, "Property Demolished");
});

/* ------------------------------------------------------------------ *
 * NA-R034 — NAv where a reader reads, never in a reference
 * ------------------------------------------------------------------ */

test("NA-R034: a missing premise is null, not the text NAv", () => {
  assert.equal(normalizeNoAccessPremise(undefined), null);
  assert.equal(normalizeNoAccessPremise({ id: "" }), null);
});

test("NA-R034: an NAv written into a premise id is treated as absent", () => {
  assert.equal(normalizeNoAccessPremise({ id: "NAv" }), null);
});

test("NA-R084.1: a premise that was there at the visit is carried", () => {
  // NA-R030: and it is carried the way every other transaction carries it - { id, address,
  // propertyType }. An id with nothing beside it showed NAv in the TRN Registry's Address
  // column for every no access, which pointed at a gap that was not there.
  assert.deepEqual(normalizeNoAccessPremise({ id: "PRM_1" }), {
    id: "PRM_1",
    address: "NAv",
    propertyType: "NAv",
  });
});

/* ------------------------------------------------------------------ *
 * NA-R020 … NA-R027 — the appointment
 * ------------------------------------------------------------------ */

test("NA-R020: no appointment is a complete record", () => {
  const block = buildNoAccessAccessBlock({ reasonCode: "Property Locked" }, { actor: ACTOR });
  assert.equal(block.appointment, null);
});

test("NA-R026: the server does not refuse an appointment that has since passed", () => {
  // A phone out of signal overnight must not have honest work refused for arriving late.
  const past = "2020-01-01T08:00:00.000Z";
  const appointment = normalizeNoAccessAppointment({ at: past }, { actor: ACTOR });
  assert.equal(appointment.at, past);
});

test("owner 2 Oct: an appointment has no upper limit", () => {
  const faraway = "2031-07-04T12:00:00.000Z";
  assert.equal(normalizeNoAccessAppointment({ at: faraway }, { actor: ACTOR }).at, faraway);
});

test("NA-R025: the appointment keeps who made it and when", () => {
  const appointment = normalizeNoAccessAppointment(
    { at: "2026-10-08T12:00:00.000Z", madeAt: "2026-10-02T06:00:00.000Z" },
    { actor: ACTOR },
  );
  assert.equal(appointment.madeByUid, "UID_1");
  assert.equal(appointment.madeByUser, "Siya Siya");
  assert.equal(appointment.madeAt, "2026-10-02T06:00:00.000Z");
});

test("an appointment that cannot be read is refused rather than guessed", () => {
  assert.equal(
    code(() => normalizeNoAccessAppointment({ at: "next Tuesday-ish" }, { actor: ACTOR })),
    "NO_ACCESS_APPOINTMENT_INVALID",
  );
});

/* ------------------------------------------------------------------ *
 * The photograph and the position
 * ------------------------------------------------------------------ */

test("NA-R010: a no access without its photograph is refused", () => {
  assert.equal(code(() => assertNoAccessMedia([])), "NO_ACCESS_PHOTO_REQUIRED");
  assert.equal(code(() => assertNoAccessMedia(undefined)), "MEDIA_INVALID");
});

test("a photograph queued on the phone counts before it is uploaded", () => {
  assert.doesNotThrow(() => assertNoAccessMedia([{ tag: "noAccessPhoto", uri: "file:///a.jpg" }]));
});

test("a position outside the world is refused", () => {
  assert.equal(code(() => assertNoAccessLocation({ gps: { lat: 91, lng: 0 } })), "LOCATION_INVALID");
});

/* ------------------------------------------------------------------ *
 * The whole record
 * ------------------------------------------------------------------ */

test("a complete no access builds the one shape", () => {
  const accessData = buildNoAccessData({
    trnType: "METER_DISCOVERY",
    erfId: "ERF_1",
    erfNo: "5214",
    premise: null,
    reason: { reasonCode: "Property Locked" },
    media: PHOTO,
    location: GPS,
    actor: ACTOR,
  });

  assert.equal(accessData.trnType, "METER_DISCOVERY");
  assert.equal(accessData.erfId, "ERF_1");
  assert.equal(accessData.erfNo, "5214");
  assert.equal(accessData.premise, null);
  assert.deepEqual(accessData.access, {
    hasAccess: "no",
    reasonCode: "Property Locked",
    reasonOther: "NAv",
    reason: "Property Locked",
    appointment: null,
  });
});

test("NA-R031: the retired field names are not written", () => {
  const accessData = buildNoAccessData({
    trnType: "METER_READING",
    erfId: "ERF_1",
    erfNo: "5214",
    reason: { reasonCode: "OTHER", reasonOther: "Vicious dogs" },
    media: PHOTO,
    location: GPS,
    actor: ACTOR,
  });

  for (const retired of ["reasonSelect", "noAccessReason", "reasonText"]) {
    assert.equal(
      Object.hasOwn(accessData.access, retired),
      false,
      `${retired} is retired and must not be written`,
    );
  }
});

test("NA-R003: the same shape comes out whichever transaction it belongs to", () => {
  const types = [
    "METER_DISCOVERY",
    "METER_INSTALLATION",
    "METER_INSPECTION",
    "METER_DISCONNECTION",
    "METER_RECONNECTION",
    "METER_READING",
    "METER_REMOVAL",
  ];

  const shapes = types.map((trnType) =>
    Object.keys(
      buildNoAccessData({
        trnType,
        erfId: "ERF_1",
        erfNo: "5214",
        reason: { reasonCode: "Property Locked" },
        media: PHOTO,
        location: GPS,
        actor: ACTOR,
      }).access,
    ).sort().join(","),
  );

  assert.equal(new Set(shapes).size, 1, "every transaction type must produce one shape");
});

/* ------------------------------------------------------------------ *
 * NA-R031.2 — access.reason is a guarantee readers depend on
 *
 * The General Monthly Report reads access.reason FIRST in getNoAccessReason, and the Meter
 * Reading registry's eleven-deep chain reaches it too. Both survive the retirement of the
 * old field names only because this writer always fills it. If the record ever carried
 * reasonCode and reasonOther alone, leaving the words to be composed at read time, the
 * monthly report would show nothing for every no access and nothing would error.
 *
 * Raised by the DCN & RCN stream, 2 October 2026. It is the hasAccess coupling pointed the
 * other way, and this test is what stops it being rediscovered on a LIVE report.
 * ------------------------------------------------------------------ */

test("NA-R031.2: access.reason is never empty, for any reason on any transaction type", () => {
  const reasons = [
    { reasonCode: "Property Locked" },
    { reasonCode: "Property Vacant" },
    { reasonCode: "Property Demolished" },
    { reasonCode: "OTHER", reasonOther: "Vicious dogs" },
  ];

  const types = [
    "METER_DISCOVERY", "METER_INSTALLATION", "METER_INSPECTION",
    "METER_DISCONNECTION", "METER_RECONNECTION", "METER_READING", "METER_REMOVAL",
  ];

  for (const trnType of types) {
    for (const reason of reasons) {
      const { access } = buildNoAccessData({
        trnType, erfId: "ERF_1", erfNo: "5214",
        reason, media: PHOTO, location: GPS, actor: ACTOR,
      });
      assert.equal(
        typeof access.reason === "string" && access.reason.trim().length > 0,
        true,
        `${trnType} / ${reason.reasonCode}: access.reason must carry the display words`,
      );
    }
  }
});

test("NA-R031.2: the words are the worker's own when the reason is Other", () => {
  const { access } = buildNoAccessData({
    trnType: "METER_DISCOVERY", erfId: "ERF_1", erfNo: "5214",
    reason: { reasonCode: "OTHER", reasonOther: "Vicious dogs" },
    media: PHOTO, location: GPS, actor: ACTOR,
  });
  // Not the code "OTHER", which is what a report would print if the words were composed
  // at read time from the code alone.
  assert.equal(access.reason, "Vicious dogs");
});

test("NA-R043: the ERF rule applies to every transaction type, not just the Sales Path", () => {
  for (const trnType of ["METER_DISCOVERY", "METER_READING", "METER_REMOVAL"]) {
    assert.equal(
      code(() =>
        buildNoAccessData({
          trnType,
          erfId: "",
          erfNo: "5214",
          reason: { reasonCode: "Property Locked" },
          media: PHOTO,
          location: GPS,
          actor: ACTOR,
        }),
      ),
      "NO_ACCESS_ERF_REQUIRED",
      `${trnType} must demand an ERF ID even when it has the number`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * The one door — NA-R043 enforced wherever a callable records a no access
 *
 * Meter Discovery is validated before it reaches the recorder. Meter Installation is NOT
 * validated by anything, so without this gate it would have kept accepting a no access that
 * nobody can place. That is the fault this sprint exists to fix, reappearing on another path.
 * ------------------------------------------------------------------ */

test("the one door refuses a no access with no ERF id, whatever sent it", () => {
  assert.equal(
    code(() =>
      normalizeNoAccessAccessData(
        { premise: { id: "PRM_1" }, access: { reasonCode: "Property Locked" } },
        { actor: ACTOR },
      ),
    ),
    "NO_ACCESS_ERF_REQUIRED",
  );
});

test("the one door keeps what the form sent and settles only what the rules own", () => {
  const out = normalizeNoAccessAccessData(
    {
      trnType: "METER_INSTALLATION",
      erfId: "ERF_1",
      premise: { id: "PRM_1" },
      parents: { lmPcode: "LM1", wardPcode: "W6" },
      access: { reasonCode: "OTHER", reasonOther: "Vicious dogs" },
    },
    { actor: ACTOR },
  );

  assert.deepEqual(out.parents, { lmPcode: "LM1", wardPcode: "W6" }, "untouched fields survive");
  assert.equal(out.trnType, "METER_INSTALLATION");
  assert.equal(out.erfNo, "NAv", "the ERF number is a label, defaulted not demanded");
  assert.deepEqual(out.premise, { id: "PRM_1", address: "NAv", propertyType: "NAv" });
  assert.equal(out.access.hasAccess, "no");
  assert.equal(out.access.reasonCode, "OTHER");
  assert.equal(out.access.reason, "Vicious dogs");
});

/* ------------------------------------------------------------------ *
 * NA-R043 — the municipality and ward come from the ERF, not from the phone
 * ------------------------------------------------------------------ */

test("the ERF is the authority for where the work was", () => {
  const parents = buildNoAccessParentsFromErf({
    admin: {
      country: { pcode: "ZA" },
      province: { pcode: "ZA-KZN" },
      districtMunicipality: { pcode: "DC21" },
      localMunicipality: { pcode: "kzn241" },
      ward: { pcode: "w6" },
    },
  });

  assert.equal(parents.lmPcode, "KZN241");
  assert.equal(parents.wardPcode, "W6");
  assert.equal(parents.dmPcode, "DC21");
});

test("an ERF missing its admin reads NAv rather than blank, and never crashes", () => {
  const parents = buildNoAccessParentsFromErf({});
  assert.equal(parents.lmPcode, "NAv");
  assert.equal(parents.countryPcode, "ZA");
});

test("GMR-R027: a payload with no municipality is spotted as unplaceable", () => {
  assert.equal(noAccessParentsAreMissing({}), true);
  assert.equal(noAccessParentsAreMissing({ lmPcode: "NAv" }), true);
  assert.equal(noAccessParentsAreMissing({ lmPcode: "KZN241" }), false);
});

/* ------------------------------------------------------------------ *
 * NA-R044 (1.3.0) — a no access is to a premise, on every path
 * ------------------------------------------------------------------ */

const onPath = (trnType, premise) =>
  normalizeNoAccessAccessData(
    { trnType, erfId: "ERF_1", premise, access: { reasonCode: "Property Locked" } },
    { actor: ACTOR },
  );

test("NA-R044: a no access with no premise is refused, on all seven", () => {
  for (const trnType of [
    "METER_DISCOVERY", "METER_INSTALLATION", "METER_INSPECTION",
    "METER_DISCONNECTION", "METER_RECONNECTION", "METER_READING", "METER_REMOVAL",
  ]) {
    assert.equal(
      code(() => onPath(trnType, null)),
      "NO_ACCESS_PREMISE_REQUIRED",
      `${trnType} must name a premise`,
    );
  }
});

test("NA-R044: an ERF alone is not enough, because an ERF can be a block of flats", () => {
  assert.equal(code(() => onPath("METER_DISCOVERY", null)), "NO_ACCESS_PREMISE_REQUIRED");
});

test("NA-R044: a premise satisfies it on every path", () => {
  for (const trnType of ["METER_DISCOVERY", "METER_READING"]) {
    assert.deepEqual(onPath(trnType, { id: "PRM_1" }).premise, {
      id: "PRM_1",
      address: "NAv",
      propertyType: "NAv",
    });
  }
});

test("NA-R034 with NA-R044: an NAv premise id is no premise, so it is refused", () => {
  assert.equal(code(() => onPath("METER_DISCOVERY", { id: "NAv" })), "NO_ACCESS_PREMISE_REQUIRED");
});


// ---------------------------------------------------------------------------
// TR-R003 (0.6.0) - the position: the asset first, the premise as the fallback,
// and it always says which it is.
//
// Owner, 3 October: "the AST location GPS must always be the asset location. The fallback is
// the premise location, where the asset location doesn't exist."
// ---------------------------------------------------------------------------

const ASSET_AT = { gps: { lat: -26.3465, lng: 28.7565 } };
const PREMISE_AT = { centroid: { lat: -26.5697, lng: 28.3195 } };

test("TR-R003: the asset's own position wins, and is labelled ASSET", () => {
  const location = buildNoAccessLocation({
    assetLocation: ASSET_AT,
    premiseGeometry: PREMISE_AT,
  });

  assert.deepEqual(location.gps, { lat: -26.3465, lng: 28.7565 });
  assert.equal(location.source, NO_ACCESS_LOCATION_SOURCE.ASSET);
});

test("TR-R003: no asset falls back to the premise, and is labelled PREMISE", () => {
  // A first-visit Discovery that could not get in: there is no meter to have a position.
  const location = buildNoAccessLocation({
    assetLocation: null,
    premiseGeometry: PREMISE_AT,
  });

  assert.deepEqual(location.gps, { lat: -26.5697, lng: 28.3195 });
  assert.equal(location.source, NO_ACCESS_LOCATION_SOURCE.PREMISE);
});

test("TR-R003: an asset with no usable position still falls back", () => {
  // The label then reads PREMISE on work where the meter is known, which is the signal that
  // the meter has no position of its own - a job to fix, not a blank.
  const location = buildNoAccessLocation({
    assetLocation: { gps: { lat: null, lng: null } },
    premiseGeometry: PREMISE_AT,
  });

  assert.equal(location.source, NO_ACCESS_LOCATION_SOURCE.PREMISE);
});

test("TR-R003: the label is never left off", () => {
  for (const location of [
    buildNoAccessLocation({ assetLocation: ASSET_AT }),
    buildNoAccessLocation({ premiseGeometry: PREMISE_AT }),
  ]) {
    assert.ok(
      location.source === "ASSET" || location.source === "PREMISE",
      "a position without a source is a premise point that can pass for a meter point",
    );
  }
});

test("TR-R003: neither the asset nor the premise has one - refused, never blank", () => {
  // NA-R044 makes a premise a prerequisite and every premise has a position, so reaching here
  // means one of those is broken. A no access with no position is a visit nobody can place.
  assert.throws(
    () => buildNoAccessLocation({ assetLocation: null, premiseGeometry: null }),
    (error) => error?.irepsCode === "NO_ACCESS_LOCATION_UNRESOLVED",
  );
});

test("readGpsPoint takes both spellings and rejects what is not a position", () => {
  assert.deepEqual(readGpsPoint({ lat: -26.2, lng: 28.04 }), { lat: -26.2, lng: 28.04 });
  assert.deepEqual(readGpsPoint({ latitude: -26.2, longitude: 28.04 }), { lat: -26.2, lng: 28.04 });
  assert.deepEqual(readGpsPoint({ gps: { lat: -26.2, lng: 28.04 } }), { lat: -26.2, lng: 28.04 });

  assert.equal(readGpsPoint(null), null);
  assert.equal(readGpsPoint({}), null);
  assert.equal(readGpsPoint({ lat: "NAv", lng: "NAv" }), null);
  // Out of range is not a position: 0,0 off Africa is the classic bad fix, but a latitude of
  // 91 is simply impossible and must never be stored as somewhere.
  assert.equal(readGpsPoint({ lat: 91, lng: 28.04 }), null);
  assert.equal(readGpsPoint({ lat: -26.2, lng: 181 }), null);
});

// ---------------------------------------------------------------------------
// One door, checked in the source.
//
// On 3 October a No Access fix was written into the Meter Discovery callable and did not reach
// the Meter Installation one, which has its own no access branch. That is the same fault as
// five field names for one reason and five private copies of one access card, and it is the
// reason this guard exists rather than a comment asking people to remember.
// ---------------------------------------------------------------------------

test("TR-R003: both no access branches resolve the position through the one helper", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../index.js", import.meta.url), "utf8");

  // Read the CODE, not the prose. A guard that matches comments can be tripped by a comment
  // explaining the very thing it forbids - and worse, silenced by deleting one.
  const code = source
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    })
    .join("\n");

  const branches = code.match(/hasAccess === "no"/g) || [];
  assert.ok(branches.length >= 2, "the no access branches have moved; this guard is reading nothing");

  const calls = code.match(/await completeNoAccessFromAuthorities\(/g) || [];
  assert.equal(
    calls.length,
    2,
    "a no access branch is not completing itself from the authorities: Meter Discovery and Meter Installation each have one, and a fix to either must reach both",
  );

  assert.equal(
    /ast:\s*null/.test(code),
    false,
    "a no access is writing ast: null again, which leaves the record with no position at all",
  );
});


// ---------------------------------------------------------------------------
// NA-R030 — the premise is written the way every other transaction writes it.
//
// The owner, 3 October, looking at the TRN Registry: "remember, we've just agreed that there
// is no access without an address". normalizeNoAccessPremise returned { id } alone, so every
// no access showed NAv in the Address column while 478 of the other 493 transactions showed
// their street. NAv is supposed to mean something is missing - so it pointed at a fault that
// did not exist and hid the one that did.
// ---------------------------------------------------------------------------

test("NA-R030: the premise keeps its address and property type, as words", () => {
  const premise = normalizeNoAccessPremise({
    id: "PRM_1790997780895_674_W006_5293",
    address: { strNo: "5293", strName: "Craigside", strType: "Street", suburbName: "Dundee" },
    propertyType: { type: "Residential", name: "", unitNo: "" },
  });

  assert.equal(premise.id, "PRM_1790997780895_674_W006_5293");
  assert.equal(premise.address, "5293 Craigside Street");
  assert.equal(premise.propertyType, "Residential");
});

test("NA-R030: words in, the same words out", () => {
  // A record that has already been through here, or a phone that sent words, is not mangled.
  const premise = normalizeNoAccessPremise({
    id: "PRM_1",
    address: "5192 CRAIGSIDE Street",
    propertyType: "Residential",
  });

  assert.equal(premise.address, "5192 CRAIGSIDE Street");
  assert.equal(premise.propertyType, "Residential");
});

test("NA-R030: never the structured object, which crashes a screen", () => {
  const premise = normalizeNoAccessPremise({
    id: "PRM_1",
    address: { strNo: "5293", strName: "Craigside", strType: "Street" },
    propertyType: { type: "Residential" },
  });

  assert.equal(typeof premise.address, "string");
  assert.equal(typeof premise.propertyType, "string");
});

test("NA-R030: a genuine gap is NAv, so it stays visible", () => {
  const premise = normalizeNoAccessPremise({ id: "PRM_1" });

  assert.equal(premise.address, "NAv");
  assert.equal(premise.propertyType, "NAv");
});

test("the street type is not repeated when the name already carries it", () => {
  // The owner, 24 September, on the map label: joining all three blindly gives
  // "26 OLDACRE ST Street".
  const premise = normalizeNoAccessPremise({
    id: "PRM_1",
    address: { strNo: "26", strName: "OLDACRE ST", strType: "Street" },
  });

  assert.equal(premise.address, "26 OLDACRE ST");
});

// ---------------------------------------------------------------------------
// TR-R001 — the writer produces the agreed root, not just the backfill.
//
// On 3 October the backfill put all 493 transactions into the agreed shape and the very next
// capture arrived without it: no trnType at the root and none of the five root objects. The
// data had been repaired and the writer had not, so records were drifting back out as fast as
// they were made — and the repaired ones sitting beside them made it look fixed.
// ---------------------------------------------------------------------------

test("TR-R001: the root is filled in, and trnType agrees with accessData", async () => {
  const { applyTrnRootShape, TRN_ROOT_OBJECT_KEYS } = await import("../transactions/trnShape.js");

  const payload = applyTrnRootShape({
    id: "TRN_1",
    meterType: "NA",
    accessData: { trnType: "METER_DISCOVERY" },
  });

  assert.equal(payload.trnType, "METER_DISCOVERY");
  for (const key of TRN_ROOT_OBJECT_KEYS) {
    assert.deepEqual(payload[key], {}, `${key} is absent, so every reader must test for it`);
  }
});

test("TR-R001: what the form filled is never overwritten", async () => {
  const { applyTrnRootShape } = await import("../transactions/trnShape.js");

  const payload = applyTrnRootShape({
    accessData: { trnType: "METER_DISCONNECTION" },
    status: { state: "CONNECTED" },
    workflow: { state: "COMPLETED" },
  });

  assert.deepEqual(payload.status, { state: "CONNECTED" });
  assert.deepEqual(payload.workflow, { state: "COMPLETED" });
  assert.deepEqual(payload.origin, {}, "an absent key is still filled in");
});

test("TR-R001: every path that writes a transaction shapes its root", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../index.js", import.meta.url), "utf8");

  const code = source
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    })
    .join("\n");

  const calls = code.match(/applyTrnRootShape\(/g) || [];
  assert.equal(
    calls.length,
    3,
    "a path that writes a transaction is not shaping its root: Meter Discovery, and Meter Installation's access and no access branches, each build their own document",
  );
});

// ---------------------------------------------------------------------------
// TR-R001 — a no access carries the agreed root and NOTHING else.
//
// The owner, 3 October: "We agreed on the root structure of the transaction. And now you're
// going outside that." No access records were reaching trns with capturedAt, sourceModule,
// executionOutcome, assignmentHistory, geofenceRefs, bucket, corrections and fieldComment
// hanging off the root — none of them declared, none of them ever put to him.
// ---------------------------------------------------------------------------

test("TR-R001: a no access is cut down to the agreed root", async () => {
  const { stripToDeclaredRoot, TRN_DECLARED_ROOT_KEYS } = await import(
    "../transactions/trnShape.js"
  );

  const written = stripToDeclaredRoot({
    id: "TRN_1",
    trnType: "METER_DISCOVERY",
    accessData: { trnType: "METER_DISCOVERY" },
    fieldComment: { text: "under the dog" },
    metadata: {},
    meterType: "NA",
    ast: { location: { gps: { lat: -28, lng: 30 }, source: "PREMISE" } },
    media: [],
    serviceProvider: {},
    status: {},
    assignment: {},
    origin: {},
    workflow: {},
    // None of these are in TR-R001.
    capturedAt: "2026-10-03T10:33:25.102Z",
    sourceModule: "METER_DISCOVERY",
    executionOutcome: {},
    assignmentHistory: [],
    geofenceRefs: [],
    bucket: "x",
    corrections: [],
    meterDiscoveryContractVersion: 2,
  });

  // TR-R001 0.7.0: fieldComment IS declared - the owner kept it, because it is the worker's own
  // words and a no access has no work property to put them in.
  assert.deepEqual(written.fieldComment, { text: "under the dog" });

  for (const gone of [
    "capturedAt",
    "sourceModule",
    "executionOutcome",
    "assignmentHistory",
    "geofenceRefs",
    "bucket",
    "corrections",
    "meterDiscoveryContractVersion",
  ]) {
    assert.equal(gone in written, false, `${gone} is on the root again, and no rule declares it`);
  }

  for (const key of Object.keys(written)) {
    assert.ok(
      TRN_DECLARED_ROOT_KEYS.includes(key),
      `${key} reached the record and TR-R001 does not declare it`,
    );
  }
});

test("TR-R001: the batch is kept, in the home the rule gives it", async () => {
  const { stripToDeclaredRoot } = await import("../transactions/trnShape.js");

  // `origin` is "where the work came from — field or office, and what it followed". Dropping
  // the batch would lose the link the monthly report counts by; leaving it at the root would
  // leave a key no rule declares. It goes where the rule already put it.
  const written = stripToDeclaredRoot({
    id: "TRN_1",
    origin: { channel: "FIELD" },
    targetedBatchContext: { tbId: "TGB_1", rowId: "TBR_1" },
  });

  assert.equal("targetedBatchContext" in written, false);
  assert.deepEqual(written.origin.targetedBatch, { tbId: "TGB_1", rowId: "TBR_1" });
  assert.equal(written.origin.channel, "FIELD", "what origin already held is not thrown away");
});

// ---------------------------------------------------------------------------
// NA-R005 — the server accepts the id the rule tells the phone to build.
//
// The rule was written, the schema was written, the phone was changed — and the validators
// still tested startsWith("TRN_MDIS_"). The first no access built under NA-R005 would have
// been REFUSED on arrival with INVALID_TRN_ID. Found by checking before saying it was done.
// ---------------------------------------------------------------------------

test("NA-R005: a no access id is accepted, and so is the work's own", async () => {
  const { isTrnIdForWork, isNoAccessTrnId } = await import("../transactions/trnId.js");

  // NA-R005 (1.12.0): `_NA` is a SUFFIX, so a no access keeps the work's own prefix.
  assert.equal(isTrnIdForWork("TRN_MDIS_1791024322663_ELC_ZA5241006_1695", "TRN_MDIS_"), true);
  assert.equal(
    isTrnIdForWork("TRN_MDIS_261003_124522663_K7X_NAv_ZA5241006_1695_NA", "TRN_MDIS_"),
    true,
  );
  assert.equal(
    isTrnIdForWork("TRN_MINST_261003_124522663_K7X_ELC_ZA5241006_1695_NA", "TRN_MINST_"),
    true,
  );

  // A no access on a DISCONNECTION is not a discovery (NA-R003), and the id says so.
  assert.equal(
    isTrnIdForWork("TRN_MDCN_261003_124522663_K7X_ELC_ZA5241006_1695_NA", "TRN_MDIS_"),
    false,
  );
  assert.equal(isTrnIdForWork("", "TRN_MDIS_"), false);

  assert.equal(isNoAccessTrnId("TRN_MDIS_261003_124522663_K7X_NAv_ZA5241006_1695_NA"), true);
  assert.equal(isNoAccessTrnId("TRN_MDIS_1791024322663_ELC_ZA5241006_1695"), false);
  // The old shape carried NA in the middle, never at the end. It is not a no access by this
  // test, which is why NA-R005 says no reader may assume one shape or the other.
  assert.equal(isNoAccessTrnId("TRN_MDIS_1790997797249_NA_ZA5241006_5293"), false);
});

// ---------------------------------------------------------------------------
// WHO is always the signed-in caller, never the phone.
//
// On the owner's own capture, 3 October: the appointment said it was made by "Fieldworker" -
// the PHONE's fallback, because its profile had no name - while the record said it was created
// by "Peter Peter". One record, two names for one person.
// ---------------------------------------------------------------------------

test("the server's actor beats whatever the phone claims about who", () => {
  const appointment = normalizeNoAccessAppointment(
    {
      at: "2026-10-13T23:00:00.000Z",
      madeAt: "2026-10-03T14:59:34.131Z",
      madeByUid: "SOMEONE_ELSE",
      madeByUser: "Fieldworker",
    },
    { actor: { uid: "RSEHoLEpg0W3bwWkEH3rgUnjMVu1", name: "Peter Peter" } },
  );

  assert.equal(appointment.madeByUser, "Peter Peter");
  assert.equal(appointment.madeByUid, "RSEHoLEpg0W3bwWkEH3rgUnjMVu1");
});

test("where the server somehow has no actor, the phone's value is still better than nothing", () => {
  const appointment = normalizeNoAccessAppointment(
    { at: "2026-10-13T23:00:00.000Z", madeByUser: "Peter Peter" },
    { actor: {} },
  );

  assert.equal(appointment.madeByUser, "Peter Peter");
});
