import test from "node:test";
import assert from "node:assert/strict";
import { registryNoAccessDetails } from "../src/utils/registryNoAccess.js";

test("return appointments use the agreed SAST time, including date rollover", () => {
  const access = { hasAccess: "no", reasonCode: "Return visit requested", appointment: { at: "2026-10-05T13:00:00.000Z" } };
  assert.deepEqual(registryNoAccessDetails(access), { accessReason: "Return visit requested", returnAppointmentLabel: "05 Oct 2026, 15:00" });
  assert.equal(registryNoAccessDetails({ ...access, appointment: { at: "2026-10-05T23:15:00Z" } }).returnAppointmentLabel, "06 Oct 2026, 01:15");
  assert.equal(registryNoAccessDetails({ ...access, reasonCode: "Occupant requested a return visit" }).accessReason, "Return visit requested");
});
test("ordinary visits have no appointment line; missing required times are visible", () => {
  assert.deepEqual(registryNoAccessDetails({ hasAccess: "no", reason: "Meter Obstructed" }), { accessReason: "Meter Obstructed", returnAppointmentLabel: null });
  for (const at of [null, undefined, "", "invalid"]) {
    assert.equal(registryNoAccessDetails({ hasAccess: "no", reason: "Return visit requested", appointment: { at } }).returnAppointmentLabel, "NAv");
  }
  assert.equal(registryNoAccessDetails({ hasAccess: "yes", reason: "Return visit requested" }).returnAppointmentLabel, null);
});
