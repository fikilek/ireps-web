import test from "node:test";
import assert from "node:assert/strict";
import { buildLifecycleTrnPayload, buildLifecycleInstructionTrnPayload } from "../meterLifecycle/helpers.js";
import { buildCommissioningTrnPayload } from "../commissioning/helpers.js";

const now = "2026-10-05T14:00:00.000Z";
const captured = "2026-10-01T06:00:00.000Z";
const edited = "2026-10-02T07:00:00.000Z";
const actor = { actorUid: "WORKER", actorName: "Field Worker" };
const types = ["METER_INSPECTION", "METER_READING", "METER_DISCONNECTION", "METER_RECONNECTION", "METER_REMOVAL", "METER_COMMISSIONING"];
const asset = { meterType: "electricity", status: { state: "FIELD" }, ast: { astData: { astId: "A1", astNo: "12345", meter: { type: "prepaid" } } } };
for (const type of types) {
  const writers = type === "METER_COMMISSIONING" ? [buildLifecycleTrnPayload, buildCommissioningTrnPayload] : [buildLifecycleTrnPayload];
  for (const writer of writers) {
    test(`${type} ${writer.name}: delayed delivery retains capture/edit times and server identity`, () => {
      const metadata = { createdOnDevice: captured, updatedOnDevice: edited, createdByUid: "SPOOFED", createdOnDeviceByUid: "SPOOFED", createdAt: "2026-01-01T00:00:00Z" };
      const value = writer({ data: { id: "T1", metadata, accessData: { trnType: type, access: { hasAccess: "yes" } }, ast: { astData: { astId: "A1" } } }, astDoc: asset, now, ...actor });
      assert.equal(Object.keys(value.metadata).length, 12);
      assert.equal(value.metadata.createdAt, now);
      assert.equal(value.metadata.updatedAt, now);
      assert.equal(value.metadata.createdOnDevice, captured);
      assert.equal(value.metadata.updatedOnDevice, edited);
      for (const prefix of ["created", "updated", "createdOnDevice", "updatedOnDevice"]) {
        assert.equal(value.metadata[`${prefix}ByUid`], actor.actorUid);
        assert.equal(value.metadata[`${prefix}ByUser`], actor.actorName);
      }
      assert.equal(metadata.createdOnDeviceByUid, "SPOOFED", "Builder must not mutate the queued payload");
    });
    test(`${type} ${writer.name}: absent capture remains unknown, never server arrival`, () => {
      const value = writer({ data: { id: "T1", accessData: { trnType: type } }, astDoc: asset, now, ...actor });
      assert.equal(Object.keys(value.metadata).length, 12);
      for (const key of ["createdOnDevice", "createdOnDeviceByUid", "createdOnDeviceByUser", "updatedOnDevice", "updatedOnDeviceByUid", "updatedOnDeviceByUser"]) assert.equal(value.metadata[key], null);
    });
  }
  test(`${type}: office instruction starts with empty device metadata`, () => {
    const value = buildLifecycleInstructionTrnPayload({ data: { id: "OFFICE1", trnType: type, astId: "A1", metadata: { createdAt: now, createdOnDevice: captured } }, astDoc: asset, premiseData: {}, now, ...actor });
    assert.equal(Object.keys(value.metadata).length, 12);
    assert.equal(value.metadata.createdAt, now);
    assert.equal(value.metadata.createdOnDevice, null);
    assert.equal(value.metadata.updatedOnDevice, null);
  });
}
