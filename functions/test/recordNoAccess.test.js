// No Access rules NA-R001 (1.0.0) — one gate, one test.
//
// These lock the rules the owner settled on 1 and 2 October 2026. A test here failing means
// a no access could be recorded that nobody can place, or that two consumers would read two
// different ways.

import test from "node:test";
import assert from "node:assert/strict";

import {
  assertNoAccessGeography,
  assertNoAccessLocation,
  assertNoAccessMedia,
  buildNoAccessAccessBlock,
  buildNoAccessData,
  normalizeNoAccessAppointment,
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
  assert.deepEqual(normalizeNoAccessPremise({ id: "PRM_1" }), { id: "PRM_1" });
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
