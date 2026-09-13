import assert from "node:assert/strict";
import test from "node:test";
import { inspectSalesTbRefsIntegrity } from "./salesTbRefsIntegrityModel.js";
import { resolveSalesTargetedBatchMembership as resolve,
  getSalesTargetedBatchMembershipLabel as label,
  getSalesTargetedBatchMembershipFilterKey as key } from "./salesTargetedBatchMembershipModel.js";

const ref = (id) => ({ id, date: { seconds: 1700000000, nanoseconds: 0 } });
const row = (refs = [], extra = {}) => ({ tbRefs: refs, tbRefsIntegrity: inspectSalesTbRefsIntegrity(refs), ...extra });
const TB_A = "TGB_20260912_100000_AAAA";
const TB_B = "TGB_20260912_100000_BBBB";

for (const [name, input, state, id, source] of [
  ["empty", row(), "NONE", null, "LEGACY_TBREFS"],
  ["singleton", row([ref("TGB_20260913_120000_BBBB")]), "MEMBER", "TGB_20260913_120000_BBBB", "LEGACY_TBREFS"],
  ["multiple", row([ref("TGB_20260913_120000_BBBB"), ref("TGB_20260913_120000_AAAA")]), "UNRESOLVED", null, "LEGACY_TBREFS"],
  ["duplicate", row([ref("TGB_20260913_120000_BBBB"), ref("TGB_20260913_120000_BBBB")]), "UNRESOLVED", null, "LEGACY_TBREFS"],
  ["invalid entry", row([{ id: "TB" }]), "UNRESOLVED", null, "LEGACY_TBREFS"],
  ["invalid sibling", row([ref("TGB_20260913_120000_BBBB"), { id: "BROKEN" }]), "UNRESOLVED", null, "LEGACY_TBREFS"],
  ["missing cached integrity is recomputed", { tbRefs: [] }, "NONE", null, "LEGACY_TBREFS"],
  ["filtered invalid input", { tbRefs: [], tbRefsIntegrity: { valid: false } }, "UNRESOLVED", null, "LEGACY_TBREFS"],
  ["normalized duplicate guard", row([ref("TB"), ref("tb")], { tbRefsIntegrity: { valid: true } }), "UNRESOLVED", null, "LEGACY_TBREFS"],
  ["path invalid", row([ref("bad/id")]), "UNRESOLVED", null, "LEGACY_TBREFS"],
  ["dot path invalid", row([ref("..")]), "UNRESOLVED", null, "LEGACY_TBREFS"],
  ["scalar", row([], { targetedBatchId: TB_A }), "MEMBER", TB_A, "SCALAR"],
  ["scalar and matching ref", row([ref(TB_A)], { targetedBatchId: TB_A }), "MEMBER", TB_A, "SCALAR"],
  ["scalar decides over an old ref", row([ref(TB_B)], { targetedBatchId: TB_A }), "MEMBER", TB_A, "SCALAR"],
  ["scalar decides over multiple refs", row([ref(TB_A), ref(TB_B)], { targetedBatchId: TB_A }), "MEMBER", TB_A, "SCALAR"],
  ["null and empty", row([], { targetedBatchId: null }), "NONE", null, "SCALAR"],
  ["null means no batch despite old refs", row([ref(TB_A)], { targetedBatchId: null }), "NONE", null, "SCALAR"],
  ["undefined is not absence", row([], { targetedBatchId: undefined }), "UNRESOLVED", null, "SCALAR"],
  ["malformed scalar", row([], { targetedBatchId: {} }), "UNRESOLVED", null, "SCALAR"],
  ["blank scalar", row([], { targetedBatchId: " " }), "UNRESOLVED", null, "SCALAR"],
  ["non-TGB scalar", row([], { targetedBatchId: "TB_A" }), "UNRESOLVED", null, "SCALAR"],
  ["padded scalar is not repaired", row([], { targetedBatchId: ` ${TB_A}` }), "UNRESOLVED", null, "SCALAR"],
  ["flagged scalar", row([], { targetedBatchIdInvalid: true }), "UNRESOLVED", null, "SCALAR"],
  ["old field is ignored", row([], { activeTargetedBatchId: TB_A }), "NONE", null, "LEGACY_TBREFS"],
]) {
  test("membership: " + name, () => {
    const result = resolve(input);
    assert.deepEqual([result.state, result.tbId, result.source], [state, id, source]);
    assert.equal(label(result), state === "NONE" ? "Not Batched" : state === "MEMBER" ? id : "Unresolved");
    assert.equal(key(result), state === "MEMBER" ? "MEMBER:" + id : state);
    assert.equal(result.reason === null, state === "NONE");
    if (state !== "NONE") assert.notEqual(label(result), "Not Batched");
  });
}

test("completion retains a valid singleton and never mutates legacy evidence", () => {
  const r = { ...ref("TGB_20260913_120000_DONE"), rowId: "ROW", fieldWork: { status: "COMPLETED",
    outcomeCode: "METER_DISCOVERED", outcomeLabel: "Meter discovered", premiseId: "P",
    meterId: "M", trnId: "T", meterMatch: true,
    submittedAt: ref("x").date, updatedAt: ref("x").date } };
  const input = row([r]);
  const before = JSON.stringify(input);
  assert.equal(resolve(input).tbId, "TGB_20260913_120000_DONE");
  assert.equal(JSON.stringify(input), before);
});
