import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFallbackReason,
  parsePendingTrnFromReason,
  parseRegistrationDisagreeReason,
} from "./trnBgoUploadPendingTrn.js";

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

test("parseFallbackReason formats DCN -> INSP Fallback pill and explanation", () => {
  const fb = parseFallbackReason(
    { isProposedInspection: true, astStatus: "DISCONNECTED", proposedReason: "Current state is DISCONNECTED — Proposed for Inspection (MINSP)." },
    "METER_DISCONNECTION",
  );
  assert.equal(fb.pillLabel, "DCN → INSP Fallback");
  assert.equal(fb.uploadTrnLabel, "Disconnection (DCN)");
  assert.equal(fb.fallbackTrnLabel, "Inspection (INSP)");
  assert.equal(fb.meterState, "DISCONNECTED");
  assert.match(fb.explanation, /Cannot DCN a meter that is DISCONNECTED/);
  assert.equal(parseFallbackReason({ isProposedInspection: false }, "METER_DISCONNECTION"), null);
});

test("parseRegistrationDisagreeReason shows Meter Removed pill with original reason on hover", () => {
  const res = parseRegistrationDisagreeReason({
    nonEligibleReason: "The premise does not list this meter, so the two records disagree",
    astStatus: "REMOVED",
  });
  assert.equal(res.pillLabel, "Meter Removed");
  assert.equal(res.explanation, "The premise does not list this meter, so the two records disagree");
  assert.equal(parseRegistrationDisagreeReason({ nonEligibleReason: "Other" }), null);
});
