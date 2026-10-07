import test from "node:test";
import assert from "node:assert/strict";
import { assertRegistryBackfillProject, planRegistryAddressBackfill } from "../functions/maintenance/registryAddressBackfillPlan.js";
test("backfill explicitly selects an iREPS project with matching credentials", () => {
  assert.equal(assertRegistryBackfillProject("ireps2", "ireps2"), "ireps2");
  assert.equal(assertRegistryBackfillProject("ireps-test", "ireps-test"), "ireps-test");
  assert.throws(() => assertRegistryBackfillProject("ireps2", "ireps-test"), /does not match/);
  assert.throws(() => assertRegistryBackfillProject("ireps-test", "ireps2"), /does not match/);
  assert.equal(assertRegistryBackfillProject("ireps-5c3e9", "ireps-5c3e9"), "ireps-5c3e9");
  assert.throws(() => assertRegistryBackfillProject("ireps-5c3e9", "ireps-test"), /does not match/);
  assert.throws(() => assertRegistryBackfillProject("ireps-test", "ireps-5c3e9"), /does not match/);
  assert.throws(() => assertRegistryBackfillProject("unknown", "unknown"), /restricted/);
  assert.throws(() => assertRegistryBackfillProject(undefined, "ireps-test"), /restricted/);
});
const premise = { erfId: "erf1", parents: { lmPcode: "lm1" }, address: { strNo: "14", strName: "Mckenzie", strType: "Street" }, propertyType: { type: "Commercial", name: "Shop", unitNo: "04A" } };
const record = { accessData: { erfId: "erf1", parents: { lmPcode: "lm1" }, premise: { id: "p1", address: "14 Mckenzie Street" } }, metadata: { createdAt: "2026-08-22" } };
test("backfill patches separate property, street and unit fields and is idempotent", () => {
  const plan = planRegistryAddressBackfill(record, premise);
  assert.equal(plan.status, "UPDATE");
  assert.equal(plan.values.unitNo, "04A");
  assert.equal(Object.keys(plan.patch).length, 6);
  assert.ok(Object.keys(plan.patch).every(key => key.startsWith("accessData.premise.")));
  const after = structuredClone(record);
  Object.assign(after.accessData.premise, plan.values);
  assert.equal(planRegistryAddressBackfill(after, premise).status, "UNCHANGED");
  assert.deepEqual(after.metadata, record.metadata);
});
test("missing premise, bad identity and incomplete source street are held", () => {
  for (const candidate of [null, { ...premise, erfId: "other" }, { ...premise, parents: { lmPcode: "other" } }, { ...premise, address: { ...premise.address, strNo: "" } }]) {
    assert.equal(planRegistryAddressBackfill(record, candidate).status, "HOLD");
  }
});
test("linked premise prevails over differing saved street and unit values", () => {
  const existing = structuredClone(record);
  existing.accessData.premise.address = "49 Maninjwa Street";
  existing.accessData.premise.strNo = "49";
  existing.accessData.premise.unitNo = "3";
  const source = { ...premise, address: { strNo: "48", strName: "Maninjwa", strType: "Street" } };
  const plan = planRegistryAddressBackfill(existing, source);
  assert.equal(plan.status, "UPDATE");
  assert.equal(plan.previousAddress, "49 Maninjwa Street");
  assert.equal(plan.patch["accessData.premise.address"], "48 Maninjwa Street");
  assert.equal(plan.patch["accessData.premise.strNo"], "48");
  assert.equal(plan.patch["accessData.premise.unitNo"], "04A");
  assert.equal(existing.accessData.premise.address, "49 Maninjwa Street");
});
test("no unit facts are invented and numeric zero is preserved", () => {
  assert.deepEqual(planRegistryAddressBackfill(record, { ...premise, propertyType: {} }).values, { propertyType: "NAv", address: "14 Mckenzie Street", strNo: "14", strName: "Mckenzie", strType: "Street", unitName: "NAv", unitNo: "NAv" });
  assert.equal(planRegistryAddressBackfill(record, { ...premise, propertyType: { unitNo: 0 } }).values.unitNo, "0");
});
test("property type is the linked premise category, without repeated business name or unit", () => {
  for (const [type, name, unitNo] of [["Commercial", "Trading 1", "1"], ["Commercial", "Makhathini", "2"], ["Commercial", "Thisa Fish & Chips", "4"], ["Flats", "Boundary Flats", "2"]]) {
    const source = { ...premise, propertyType: { type, name, unitNo } };
    const existing = structuredClone(record);
    Object.assign(existing.accessData.premise, planRegistryAddressBackfill(record, source).values);
    existing.accessData.premise.propertyType = `${type} ${name} ${unitNo}`;
    const plan = planRegistryAddressBackfill(existing, source);
    assert.deepEqual(plan.patch, { "accessData.premise.propertyType": type });
    assert.equal(plan.values.unitName, name);
    assert.equal(plan.values.unitNo, unitNo);
  }
});
