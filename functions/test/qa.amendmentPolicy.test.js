import test from "node:test";
import assert from "node:assert/strict";
import { buildAmendedRecord, checkAmendedForm } from "../qa/amendmentPolicy.js";
import { deliveryFailure } from "../qa/email.js";
import { discoveryFixture } from "./qa.amendmentFixture.js";

test("saved discovery values are validated without creating another visit", () => {
  const before = discoveryFixture(), ast = structuredClone(before.ast);
  ast.astData.astManufacturer = "Landis";
  const { after, changed } = buildAmendedRecord(before, { ast });
  assert.deepEqual(changed, ["ast.astData.astManufacturer"]);
  assert.deepEqual(after.metadata, before.metadata);
  assert.equal(after.id, before.id);
  assert.ok(checkAmendedForm(after).astPatch.ast);
});
test("ordinary amendments cannot rewrite identity, credit, event type or outcome", () => {
  const before = discoveryFixture();
  for (const fields of [{ id: "new" }, { metadata: {} }, { status: { state: "DISCONNECTED" } },
    { ast: { ...before.ast, astData: { ...before.ast.astData, astNo: "different" } } },
    { accessData: { ...before.accessData, access: { hasAccess: "no" } } }]) {
    assert.throws(() => buildAmendedRecord(before, fields));
  }
});
test("installation amendment uses the same full validator as a new installation", () => {
  const record = discoveryFixture(); record.id = "TRN_MINST_1_ELC_ZA5241002_100"; record.accessData.trnType = "METER_INSTALLATION";
  assert.ok(checkAmendedForm(record).astPatch);
  record.ast.location.gps.lat = 500;
  assert.throws(() => checkAmendedForm(record), /GPS|gps/);
});
test("No Access uses its governed reason and evidence rules, including appointments", () => {
  const record = discoveryFixture(); record.accessData.access = { hasAccess: "no", reasonCode: "Property Locked", reason: "Property Locked" }; record.media = [];
  assert.throws(() => checkAmendedForm(record), /photograph/);
  record.media = [{ ...discoveryFixture().media[0], tag: "noAccessPhoto" }];
  assert.deepEqual(checkAmendedForm(record).astPatch, {});
  record.accessData.access = { hasAccess: "no", reasonCode: "Return visit requested", reason: "Return visit requested" };
  assert.throws(() => checkAmendedForm(record), /date and time/);
  assert.throws(() => buildAmendedRecord(record, { fieldComment: { text: "New comment" } }), /cannot change/);
});
test("reading corrections preserve the original capture time and source entry", () => {
  const record = discoveryFixture(); record.mreadings = [{ reading: "10", readingAt: record.metadata.createdOnDevice, trnId: record.id }];
  assert.ok(buildAmendedRecord(record, { mreadings: [{ ...record.mreadings[0], reading: "12" }] }));
  assert.throws(() => buildAmendedRecord(record, { mreadings: [{ ...record.mreadings[0], readingAt: "2026-10-14" }] }), /capture time/);
});
test("email retries distinguish definite refusal from possible accepted delivery", () => {
  assert.equal(deliveryFailure({ code: "ETIMEDOUT", command: "DATA" }, 1), "UNCERTAIN");
  assert.equal(deliveryFailure({ code: "ECONNECTION", command: "CONN" }, 1), "RETRY");
  assert.equal(deliveryFailure({ responseCode: 450, command: "DATA" }, 1), "RETRY");
  assert.equal(deliveryFailure({ responseCode: 550, command: "DATA" }, 1), "FAILED");
  assert.equal(deliveryFailure({ code: "EDNS" }, 5), "FAILED");
});
