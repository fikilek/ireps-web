import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { confirmationIdentity, salesDraftSignature } from "./sales-batch-draft-model.js";

// Targeted Batch rules 1.3.15 (TB-R041): TB Draft records successful and failed lookups on the
// Sales meter. Those records and the metadata they touch are not Sales material, so they must
// not make TB Draft locate the meters again or make a confirmation stale.
const stamp = { seconds: 1789257600, nanoseconds: 0 };
const row = { meterNo: "00123", lmPcode: "ZA5241", town: "Dundee", adr: { strNo: "14", strName: "Bulwer" }, metadata: { updatedAt: stamp, updatedByUid: "ORIGINAL" } };
const live = sales => ({ ready: true, sales, erfs: { ERF1: { id: "ERF1" } }, wards: { ZA5241001: { id: "ZA5241001" } }, fence: null, parent: null });
const draft = { id: "TGB_20260914_120000_AB12", retainedIds: ["00123"], selection: {}, resolutions: {}, savedFence: null };

test("recording a lookup does not change the signature; a real Sales, ERF or Ward change does", () => {
  const base = salesDraftSignature(live({ "00123": row }));
  const recorded = { ...row, erfLocated: { version: 1, erfId: "ERF1", wardPcode: "ZA5241001" }, erfLookup: { version: 1, outcome: "NO_ERF" }, metadata: { updatedAt: { seconds: 1789344000, nanoseconds: 0 }, updatedByUid: "U2" } };
  assert.equal(salesDraftSignature(live({ "00123": recorded })), base);
  assert.notEqual(salesDraftSignature(live({ "00123": { ...row, adr: { ...row.adr, strNo: "15" } } })), base);
  assert.notEqual(salesDraftSignature({ ...live({ "00123": row }), erfs: { ERF2: { id: "ERF2" } } }), base);
  assert.notEqual(salesDraftSignature({ ...live({ "00123": row }), wards: {} }), base);
  assert.equal(salesDraftSignature({ ...live({ "00123": row }), ready: false }), "");
  assert.equal(salesDraftSignature(undefined), "");
  assert.deepEqual(row.metadata, { updatedAt: stamp, updatedByUid: "ORIGINAL" }, "the live Sales rows are not mutated");
});

test("recording a lookup does not make a confirmation stale", () => {
  const before = confirmationIdentity(draft, live({ "00123": row }));
  assert.equal(confirmationIdentity(draft, live({ "00123": { ...row, erfLocated: { version: 1, erfId: "ERF1" }, metadata: { updatedAt: stamp, updatedByUid: "U2" } } })), before);
  assert.notEqual(confirmationIdentity(draft, live({ "00123": { ...row, town: "Glencoe" } })), before);
  assert.notEqual(confirmationIdentity(draft, { ...live({ "00123": row }), parent: { id: "X" } }), before);
});

test("TB Draft uses the signature that leaves the lookup records out", async () => {
  const page = await readFile(new URL("../../TargetedBatchDraftPage.jsx", import.meta.url), "utf8");
  assert.match(page, /const signature = salesDraftSignature\(live\);/);
  assert.doesNotMatch(page, /JSON\.stringify\(\[live\.sales, live\.erfs, live\.wards\]\)/);
});
