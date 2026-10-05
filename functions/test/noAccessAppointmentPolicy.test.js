import test from "node:test";
import assert from "node:assert/strict";
import { buildNoAccessAccessBlock, assertNoAccessMedia, NO_ACCESS_REASON_CODES, NO_ACCESS_RETURN_VISIT_REASON as reasonCode } from "../noAccess/recordNoAccess.js";

const appointment = { at: "2026-10-06T08:00:00Z", madeAt: "2026-10-05T07:00:00Z" };
const metadata = { createdOnDevice: "2026-10-05T07:05:00Z" };
const actor = { uid: "U1", name: "Worker" };
const access = { reasonCode, appointment, appointmentRuleVersion: 2 };

test("only the return reason may omit photo evidence; optional evidence still uploads", () => {
  assert.doesNotThrow(() => assertNoAccessMedia([], access, { uploaded: true }));
  for (const code of NO_ACCESS_REASON_CODES.filter(code => code !== reasonCode)) {
    assert.throws(() => assertNoAccessMedia([], { reasonCode: code }, { uploaded: true }), error => error.code === "NO_ACCESS_PHOTO_REQUIRED");
    assert.doesNotThrow(() => assertNoAccessMedia([{ tag: "noAccessPhoto", url: "https://example.test/p.jpg" }], { reasonCode: code }, { uploaded: true }));
  }
  assert.throws(() => assertNoAccessMedia(undefined, access), error => error.code === "MEDIA_INVALID");
  assert.throws(() => assertNoAccessMedia([{ tag: "noAccessPhoto", uri: "file:///p.jpg" }], access, { uploaded: true }), error => error.code === "NO_ACCESS_PHOTO_REQUIRED");
});
const normalize = (value, capture = metadata) => buildNoAccessAccessBlock(value, { metadata: capture, actor });
const refused = (value, code, capture) => assert.throws(() => normalize(value, capture), (error) => error.irepsCode === code);

test("return appointments carry version 2 and authenticated authorship", () => {
  const result = normalize(access);
  assert.equal(result.appointmentRuleVersion, 2);
  assert.equal(result.reason, reasonCode);
  assert.equal(result.appointment.at, "2026-10-06T08:00:00.000Z");
  assert.equal(result.appointment.madeByUid, actor.uid);
});
test("return reason cannot bypass the mandatory appointment by omitting its version", () => {
  for (const version of [2, undefined]) refused({ reasonCode, appointmentRuleVersion: version }, "NO_ACCESS_APPOINTMENT_REQUIRED");
  assert.equal(normalize({ reasonCode, appointment }).appointmentRuleVersion, 2);
});
test("current other reasons reject appointments and accept null", () => {
  refused({ ...access, reasonCode: "Property Locked" }, "NO_ACCESS_APPOINTMENT_NOT_ALLOWED");
  assert.equal(normalize({ ...access, reasonCode: "Property Locked", appointment: null }).appointment, null);
});
test("unknown explicit versions are not silently downgraded to legacy", () => {
  for (const version of [0, 1, 3, "2", ""]) refused({ ...access, appointmentRuleVersion: version }, "NO_ACCESS_APPOINTMENT_RULE_UNSUPPORTED");
});
test("future means after both original capture and agreement, never after server arrival", () => {
  refused(access, "NO_ACCESS_APPOINTMENT_NOT_FUTURE_AT_CAPTURE", { createdOnDevice: appointment.at });
  refused({ ...access, appointment: { ...appointment, madeAt: appointment.at } }, "NO_ACCESS_APPOINTMENT_NOT_FUTURE_AT_CAPTURE");
  const delayed = normalize({ ...access, appointment: { at: "2020-01-02T08:00:00Z", madeAt: "2020-01-01T07:00:00Z" } }, { createdOnDevice: "2020-01-01T07:05:00Z" });
  assert.equal(delayed.appointment.at, "2020-01-02T08:00:00.000Z");
});
test("current appointments require readable original capture and agreement times", () => {
  for (const invalid of [null, undefined, "NAv", "garbage"]) {
    refused(access, "NO_ACCESS_APPOINTMENT_INVALID", { createdOnDevice: invalid });
    refused({ ...access, appointment: { ...appointment, madeAt: invalid } }, "NO_ACCESS_APPOINTMENT_INVALID");
  }
});
test("legacy captures must conform and cannot bypass the rule with a missing marker", () => {
  const legacy = { reasonCode: "Property Locked", appointment: { at: "2020-01-01T08:00:00Z" } };
  refused(legacy, "NO_ACCESS_APPOINTMENT_NOT_ALLOWED", {});
  assert.equal(normalize({ reasonCode: "Property Locked" }, {}).appointment, null);
  assert.equal(normalize({ reasonCode: "Property Locked" }, {}).appointmentRuleVersion, 2);
});
