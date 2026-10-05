import test from "node:test";
import assert from "node:assert/strict";
import { planDiscoveryAccessBackfill } from "../noAccess/discoveryAccessBackfill.js";
const record = (access, type = "METER_DISCOVERY") => ({ accessData: { trnType: type, access: { hasAccess: "no", ...access } }, metadata: { createdOnDevice: null } });
test("old Discovery reason words gain the canonical fields and current no-appointment rule", () => {
  assert.deepEqual(planDiscoveryAccessBackfill(record({ reason: "Property Locked" })), {
    "accessData.access.reasonCode": "Property Locked", "accessData.access.reasonOther": "NAv",
    "accessData.access.appointment": null, "accessData.access.appointmentRuleVersion": 2,
  });
});
test("retired free-text reasons keep their exact words under Other", () => {
  const patch = planDiscoveryAccessBackfill(record({ reason: "Vicious Dogs" }));
  assert.equal(patch["accessData.access.reasonCode"], "OTHER");
  assert.equal(patch["accessData.access.reasonOther"], "Vicious Dogs");
  assert.equal(patch["accessData.access.reason"], undefined);
});
test("appointments and other transactions are excluded from the structural backfill", () => {
  assert.equal(planDiscoveryAccessBackfill(record({ reason: "Property Locked", appointment: { at: "2026-10-06T08:00:00Z" } })), null);
  assert.equal(planDiscoveryAccessBackfill(record({ reason: "Property Locked" }, "METER_INSPECTION")), null);
});
test("missing evidence is never manufactured", () => {
  assert.equal(planDiscoveryAccessBackfill(record({ reason: "NAv" })), null);
  assert.equal(planDiscoveryAccessBackfill(record({ reason: "Occupant requested a return visit" })), null);
  const patch = planDiscoveryAccessBackfill(record({ reason: "Property Locked" }));
  assert.ok(Object.keys(patch).every(key => key.startsWith("accessData.access.")));
});
test("a second run is harmless", () => {
  const source = record({ reason: "Locked Gate / No Key" });
  const patch = planDiscoveryAccessBackfill(source);
  for (const [key, value] of Object.entries(patch)) source.accessData.access[key.split('.').at(-1)] = value;
  assert.equal(planDiscoveryAccessBackfill(source), null);
  assert.equal(source.metadata.createdOnDevice, null);
});
