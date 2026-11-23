import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFallbackReason,
  parseGenericNonEligibleReason,
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

test("parsePendingTrnFromReason ignores DELETED lifecycle markers and eligible rows", () => {
  assert.equal(
    parsePendingTrnFromReason({
      isEligible: true,
      nonEligibleReason: "",
      astActiveLifecycle: {
        trnId: "TRN_MDCN_1795452015881_ELC_ZA5241002_1865",
        trnType: "METER_DISCONNECTION",
        workflowState: "DELETED",
      },
    }),
    null,
  );
  assert.equal(
    parsePendingTrnFromReason({
      nonEligibleReason: "",
      astActiveLifecycle: {
        trnId: "TRN_MDCN_1795452015881_ELC_ZA5241002_1865",
        trnType: "METER_DISCONNECTION",
        workflowState: "DELETED",
      },
    }),
    null,
  );
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

  const dupFb = parseFallbackReason(
    { isProposedInspection: true, astStatus: "CONNECTED", proposedReason: "Active METER_DISCONNECTION job TRN_123 already exists — Proposed for Inspection (MINSP)." },
    "METER_DISCONNECTION",
  );
  assert.equal(dupFb.explanation, "Active METER_DISCONNECTION job TRN_123 already exists — Proposed for Inspection (MINSP).");
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

test("parseGenericNonEligibleReason maps ASTS not found and other reasons to pills", () => {
  const notFound = parseGenericNonEligibleReason({
    nonEligibleReason: "Meter was not found in ASTS.",
    astStatus: "NOT_IN_ASTS",
  });
  assert.equal(notFound.pillLabel, "Not Found in ASTS");
  assert.equal(notFound.explanation, "Meter was not found in ASTS.");

  const generic = parseGenericNonEligibleReason({
    nonEligibleReason: "Some custom eligibility block.",
  });
  assert.equal(generic.pillLabel, "Ineligible");
  assert.equal(parseGenericNonEligibleReason({ nonEligibleReason: "" }), null);
});
