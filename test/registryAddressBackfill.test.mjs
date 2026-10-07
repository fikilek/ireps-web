import test from "node:test";
import assert from "node:assert/strict";
import { planRegistryAddressBackfill } from "../functions/maintenance/registryAddressBackfillPlan.js";
const premise = { erfId: "erf1", parents: { lmPcode: "lm1" }, address: { strNo: "14", strName: "Mckenzie", strType: "Street" }, propertyType: { name: "Shop", unitNo: "04A" } };
const record = { accessData: { erfId: "erf1", parents: { lmPcode: "lm1" }, premise: { id: "p1", address: "14 Mckenzie Street" } }, metadata: { createdAt: "2026-08-22" } };
test("backfill only patches five address fields and is idempotent", () => {
  const plan = planRegistryAddressBackfill(record, premise);
  assert.equal(plan.status, "UPDATE");
  assert.equal(plan.values.unitNo, "04A");
  assert.equal(Object.keys(plan.patch).length, 5);
  assert.ok(Object.keys(plan.patch).every(key => key.startsWith("accessData.premise.")));
  const after = structuredClone(record);
  Object.assign(after.accessData.premise, plan.values);
  assert.equal(planRegistryAddressBackfill(after, premise).status, "UNCHANGED");
  assert.deepEqual(after.metadata, record.metadata);
});
test("address conflicts, bad identity and existing different units are held for review", () => {
  for (const candidate of [null, { ...premise, erfId: "other" }, { ...premise, parents: { lmPcode: "other" } }, { ...premise, address: { ...premise.address, strNo: "15" } }]) {
    assert.equal(planRegistryAddressBackfill(record, candidate).status, "HOLD");
  }
  const existing = structuredClone(record);
  existing.accessData.premise.unitNo = "3";
  assert.equal(planRegistryAddressBackfill(existing, premise).status, "HOLD");
});
test("no unit facts are invented and numeric zero is preserved", () => {
  assert.deepEqual(planRegistryAddressBackfill(record, { ...premise, propertyType: {} }).values, { strNo: "14", strName: "Mckenzie", strType: "Street", unitName: "NAv", unitNo: "NAv" });
  assert.equal(planRegistryAddressBackfill(record, { ...premise, propertyType: { unitNo: 0 } }).values.unitNo, "0");
});
