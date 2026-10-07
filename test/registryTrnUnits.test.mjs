import test from "node:test";
import assert from "node:assert/strict";
import { savedRegistryUnits } from "../src/utils/registryTrnUnits.js";
import { savedPremiseUnits, didSavedPremiseAddressChange } from "../functions/registry/savedPremiseUnits.js";
import { normalizeMeterRegistryRow } from "../src/redux/meterRegistryRowModel.js";

test("saved units survive asset-to-registry-to-page, preserving letters and leading zeros", () => {
  const premise = { unitName: " Oak Court ", unitNo: "001A" };
  const trn = savedRegistryUnits(premise);
  const meter = normalizeMeterRegistryRow("ast1", savedPremiseUnits(premise));
  assert.deepEqual(trn, { unitName: "Oak Court", unitNo: "001A" });
  assert.equal(meter.premiseUnitName, trn.unitName);
  assert.equal(meter.premiseUnitNo, trn.unitNo);
  assert.equal(savedRegistryUnits({ unitNo: 0 }).unitNo, "0");
});

test("missing units stay NAv rather than being guessed from address or property type", () => {
  assert.deepEqual(savedRegistryUnits({ address: "14 Mckenzie Street", propertyType: "Commercial Shop 4" }), { unitName: "NAv", unitNo: "NAv" });
  assert.deepEqual(savedRegistryUnits({ unitName: "  ", unitNo: null }), { unitName: "NAv", unitNo: "NAv" });
});

test("address-only backfills refresh meter registry without changing capture metadata or premise ID", () => {
  const before = { accessData: { premise: { id: "p1", address: "14 Mckenzie Street" } }, metadata: { updatedAt: "2026-08-22" } };
  const after = structuredClone(before);
  after.accessData.premise.unitNo = "4";
  assert.equal(didSavedPremiseAddressChange(before, after), true);
  assert.equal(didSavedPremiseAddressChange(after, structuredClone(after)), false);
  assert.deepEqual(before.metadata, after.metadata);
});
