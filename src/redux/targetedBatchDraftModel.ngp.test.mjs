import assert from "node:assert/strict";
import test from "node:test";

import {
  TARGETED_BATCH_PLANNING_MODES,
  buildTargetedBatchDraft,
  getTargetedBatchDraftIntegrity,
} from "./targetedBatchDraftModel.js";

function makeNgpDraft(rowCount = 2) {
  const tbId = "TGB_20260816_044220_AB12";
  const salesAllMeterIds = Array.from(
    { length: rowCount },
    (_, index) => `071000000${String(index).padStart(2, "0")}`,
  );
  const rows = salesAllMeterIds.map((id, index) => ({
    rowNo: String(index + 1),
    salesAllMeterId: id,
    sourceSalesAllMeterId: id,
    meterNo: id,
    lmPcode: "ZA5241",
    proposedTbId: tbId,
    draftBatchKey: `NGP::${tbId}`,
    planning: {
      mode: TARGETED_BATCH_PLANNING_MODES.ERF_GEOFENCE,
      townKey: "dundee",
      streetKey: `dundee::street ${index + 1}`,
      streetNameKey: `street ${index + 1}`,
      strNo: String(index + 1),
      strName: `Street ${index + 1}`,
      strType: "Street",
    },
  }));

  return {
    id: tbId,
    creationGroup: {
      id: tbId.replace(/^TGB_/, "TBCG_"),
      proposedBatchCount: 1,
    },
    source: {
      type: "PREPAID_SALES_NON_GPS",
      label: "Prepaid Sales",
    },
    scope: {
      lmPcode: "ZA5241",
      lmName: "Endumeni",
    },
    selection: {
      reason: "Selected from Non GPS Batch Planning",
      planningMode: TARGETED_BATCH_PLANNING_MODES.ERF_GEOFENCE,
    },
    authoritativeIds: {
      salesAllMeterIds,
      uploadRowIds: [],
    },
    proposedBatches: [
      {
        tbId,
        draftBatchKey: `NGP::${tbId}`,
        sequence: 1,
        scope: {
          lmPcode: "ZA5241",
          lmName: "Endumeni",
          wardPcode: "",
          wardNumber: "",
          wardName: "",
        },
        salesAllMeterIds,
        rows,
        validation: {
          status: "PASSED",
          oneWardOnly: false,
        },
      },
    ],
    displayRows: rows,
    validation: {
      passed: true,
      status: "PASSED",
      errors: [],
      warnings: [],
      planningMode: TARGETED_BATCH_PLANNING_MODES.ERF_GEOFENCE,
    },
  };
}

test("NGP draft remains one batch and does not require ward scope", () => {
  const draft = buildTargetedBatchDraft(makeNgpDraft(3));
  const integrity = getTargetedBatchDraftIntegrity(draft);

  assert.equal(draft.proposedBatches.length, 1);
  assert.equal(draft.proposedBatches[0].scope.wardPcode, undefined);
  assert.equal(draft.proposedBatches[0].scope.wardNumber, undefined);
  assert.equal(
    draft.selection.planningMode,
    TARGETED_BATCH_PLANNING_MODES.ERF_GEOFENCE,
  );
  assert.equal(integrity.canConfirm, false);
});

test("NGP draft admits 30 retained IDs and refuses 31 before any save", () => {
  assert.equal(buildTargetedBatchDraft(makeNgpDraft(30)).retainedIds.length, 30);
  assert.throws(() => buildTargetedBatchDraft(makeNgpDraft(31)), /1–30/);
});
test("NGP draft blocks more than one proposed batch", () => {
  const input = makeNgpDraft(2);
  input.proposedBatches.push({ ...input.proposedBatches[0], tbId: "TGB_20260816_044221_CD34" });
  assert.throws(() => buildTargetedBatchDraft(input), /one retained proposal/);
});
