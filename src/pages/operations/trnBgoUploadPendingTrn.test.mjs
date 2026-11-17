import test from "node:test";
import assert from "node:assert/strict";
import { parsePendingTrnFromReason } from "./trnBgoUploadPendingTrn.js";

test("parsePendingTrnFromReason parses active METER_INSPECTION job message into Pending INSP Trn", () => {
  const info = parsePendingTrnFromReason({
    nonEligibleReason: "Active METER_INSPECTION job TRN_MINSP_1794929772999_ELC_ZA5241002_2526 already exists.",
    astActiveLifecycle: {
      trnId: "TRN_MINSP_1794929772999_ELC_ZA5241002_2526",
      trnType: "METER_INSPECTION",
      workflowState: "IN_PROGRESS",
      assignedTo: { type: "TEAM", name: "Lesedi Audit" },
    },
  });
  assert.equal(info.trnId, "TRN_MINSP_1794929772999_ELC_ZA5241002_2526");
  assert.equal(info.buttonLabel, "Pending INSP Trn");
  assert.equal(info.workflowState, "IN PROGRESS");
  assert.equal(info.allocatedTo, "TEAM: Lesedi Audit");
});

test("parsePendingTrnFromReason returns null for non-TRN eligibility reasons", () => {
  assert.equal(parsePendingTrnFromReason({ nonEligibleReason: "Meter is DECOMMISSIONED." }), null);
});
