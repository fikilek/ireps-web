import test from "node:test";
import assert from "node:assert/strict";
import {
  parseGenericNonEligibleReason,
  parseRegistrationDisagreeReason,
  resolveNonEligibleDescriptor,
} from "../src/pages/operations/trnBgoUploadPendingTrn.js";

test("PREMISE_DOES_NOT_LIST_METER on REMOVED meter never says 'Meter Removed' and reports 'Meter Has No Linked Premise'", () => {
  const byMessageOnly = parseRegistrationDisagreeReason({
    astStatus: "REMOVED",
    nonEligibleReason: "The premise does not list this meter, so the two records disagree",
  });
  assert.ok(byMessageOnly);
  assert.equal(byMessageOnly.pillLabel, "Meter Has No Linked Premise");
  assert.equal(byMessageOnly.isDataIntegrityFault, true);
  assert.notEqual(byMessageOnly.pillLabel, "Meter Removed");

  const byCode = resolveNonEligibleDescriptor({
    astStatus: "REMOVED",
    nonEligibleCode: "PREMISE_DOES_NOT_LIST_METER",
    nonEligibleReason: "The premise does not list this meter, so the two records disagree",
  });
  assert.equal(byCode.pillLabel, "Meter Has No Linked Premise");
  assert.equal(byCode.isDataIntegrityFault, true);
});

test("every registration, master, premise, and state integrity code maps to a clear non-generic pill", () => {
  const expected = [
    ["PREMISE_DOES_NOT_LIST_METER", "The premise does not list this meter, so the two records disagree", "Meter Has No Linked Premise", true],
    ["PREMISE_NOT_NAMED", "Meter has no authoritative premise.", "Meter Has No Linked Premise", true],
    ["PREMISE_NOT_FOUND", "The premise this meter belongs to cannot be found", "Linked Premise Missing", true],
    ["LM_WARD_CONTRADICTION", "Authoritative municipality/Ward binding is missing or contradictory.", "LM / Ward Conflict", true],
    ["WARD_OUTSIDE_LM", "The authoritative Ward does not belong to the selected municipality.", "Ward Outside Selected LM", true],
    ["INVALID_AST_ID", "No meter was named", "Missing Meter ID", true],
    ["REGISTRATION_NOT_FOUND", "The registration that created this meter cannot be found", "Missing Registration TRN", true],
    ["NOT_A_REGISTRATION", "The transaction that created this meter is not a Meter Discovery or a Meter Installation", "Invalid Registration TRN", true],
    ["REGISTRATION_METER_MISMATCH", "This meter does not name the registration that created it", "Registration Mismatch", true],
    ["REGISTRATION_WITHOUT_ACCESS", "The registration records that nobody reached this meter, so the meter should not exist", "Registered Without Access", true],
    ["METER_NUMBER_UNUSABLE", "This meter's number cannot be read, so its identity cannot be confirmed", "Invalid Meter Number", true],
    ["METER_MASTER_MISSING", "This meter's number is not registered in meter master", "Missing in Meter Master", true],
    ["METER_MASTER_NOT_LINKED", "Meter master holds this number but does not name the meter it belongs to", "Master Record Unlinked", true],
    ["METER_MASTER_MISMATCH", "Meter master holds this number against a different meter", "Master Meter Conflict", true],
    ["UNKNOWN_METER_STATUS", "Meter status could not be resolved.", "Missing Meter State", true],
    ["UNKNOWN_AST_STATE", "Meter state BOGUS is not recognized.", "Unknown Meter State", true],
    ["METER_NOT_FOUND", "Meter was not found in ASTS.", "Not Found in ASTS", false],
    ["DECOMMISSIONED_INSP_ONLY", "Meter is DECOMMISSIONED and can only do METER_INSPECTION.", "Decommissioned (INSP Only)", false],
    ["PREPAID_NOT_SUPPORTED_FOR_MREAD_V1", "Prepaid/token meters are not supported for MREAD v1 TC upload.", "Prepaid (No MREAD)", false],
    ["METER_KIND_NOT_CONVENTIONAL_FOR_MREAD", "Meter kind must be explicitly conventional for METER_READING.", "Meter Kind Not Conventional", false],
    ["STATUS_NOT_ELIGIBLE_FOR_DCN", "Meter is DISCONNECTED and cannot be selected for METER_DISCONNECTION.", "State Not Eligible", false],
  ];

  for (const [code, message, expectedLabel, expectedIntegrity] of expected) {
    const withCode = resolveNonEligibleDescriptor({
      nonEligibleCode: code,
      nonEligibleReason: message,
    });
    assert.equal(withCode.pillLabel, expectedLabel, `pillLabel mismatch for ${code}`);
    assert.equal(withCode.isDataIntegrityFault, expectedIntegrity, `integrity mismatch for ${code}`);

    const legacyFallback = parseGenericNonEligibleReason({
      nonEligibleReason: message,
    });
    assert.equal(legacyFallback.pillLabel, expectedLabel, `legacy regex mismatch for ${code}`);
    assert.equal(legacyFallback.isDataIntegrityFault, expectedIntegrity, `legacy integrity mismatch for ${code}`);
  }
});
