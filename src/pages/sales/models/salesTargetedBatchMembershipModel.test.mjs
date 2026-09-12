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
  ["empty", row(), "NONE", null, null],
  ["singleton", row([ref("TGB_2")]), "MEMBER", "TGB_2", "LEGACY_TBREF"],
  ["multiple", row([ref("TGB_2"), ref("TGB_1")]), "UNRESOLVED", null, "LEGACY_TBREF"],
  ["duplicate", row([ref("TGB_2"), ref("TGB_2")]), "UNRESOLVED", null, null],
  ["invalid entry", row([{ id: "TB" }]), "UNRESOLVED", null, null],
  ["invalid sibling", row([ref("TGB_2"), { id: "BROKEN" }]), "UNRESOLVED", null, null],
  ["missing integrity", { tbRefs: [] }, "UNRESOLVED", null, null],
  ["filtered invalid input", { tbRefs: [], tbRefsIntegrity: { valid: false } }, "UNRESOLVED", null, null],
  ["normalized duplicate guard", row([ref("TB"), ref("tb")], { tbRefsIntegrity: { valid: true } }), "UNRESOLVED", null, null],
  ["path invalid", row([ref("bad/id")]), "UNRESOLVED", null, null],
  ["dot path invalid", row([ref("..")]), "UNRESOLVED", null, null],
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
  ["old field is ignored", row([], { activeTargetedBatchId: TB_A }), "NONE", null, null],
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
  const r = { ...ref("TGB_DONE"), rowId: "ROW", fieldWork: { status: "COMPLETED",
    outcomeCode: "METER_DISCOVERED", outcomeLabel: "Meter discovered", premiseId: "P",
    meterId: "M", trnId: "T", meterMatch: true,
    submittedAt: ref("x").date, updatedAt: ref("x").date } };
  const input = row([r]);
  const before = JSON.stringify(input);
  assert.equal(resolve(input).tbId, "TGB_DONE");
  assert.equal(JSON.stringify(input), before);
});
