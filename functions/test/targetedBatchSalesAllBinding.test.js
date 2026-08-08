import assert from "node:assert/strict";
import test from "node:test";

import {
  TARGETED_BATCH_COLLECTIONS,
  validateAuthoritativeSalesDocument,
} from "../targetedBatches/helpers.js";

const SALES_ID = "01023670951";
const LM_PCODE = "ZA5241";

function snapshot(overrides = {}) {
  return {
    exists: true,
    id: SALES_ID,
    data: () => ({
      meterNo: SALES_ID,
      meterNoNormalized: SALES_ID,
      lmPcode: LM_PCODE,
      erfCandidates: [{ erfId: "ERF_1", erfNo: "386/9" }],
      ...overrides,
    }),
  };
}

const draftRow = {
  meterNo: SALES_ID,
  meterNoNormalized: SALES_ID,
  erfId: "ERF_1",
  erfNo: "386/9",
};

test("Targeted Batch canonical Sales source is sales-all-meters", () => {
  assert.equal(TARGETED_BATCH_COLLECTIONS.sales, "sales-all-meters");
});

test("canonical Sales All missing lmPcode is rejected", () => {
  const result = validateAuthoritativeSalesDocument({
    snapshot: snapshot({ lmPcode: null }),
    expectedSalesId: SALES_ID,
    expectedLmPcode: LM_PCODE,
    draftRow,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "SALES_LM_SCOPE_MISSING");
});

test("canonical Sales All wrong lmPcode is rejected", () => {
  const result = validateAuthoritativeSalesDocument({
    snapshot: snapshot({ lmPcode: "ZA9999" }),
    expectedSalesId: SALES_ID,
    expectedLmPcode: LM_PCODE,
    draftRow,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "SALES_LM_SCOPE_MISMATCH");
});

test("canonical Sales All matching lmPcode passes authoritative validation", () => {
  const result = validateAuthoritativeSalesDocument({
    snapshot: snapshot(),
    expectedSalesId: SALES_ID,
    expectedLmPcode: LM_PCODE,
    draftRow,
  });

  assert.equal(result.ok, true);
  assert.equal(result.sourceLmPcode, LM_PCODE);
  assert.equal(result.erfReference.erfId, "ERF_1");
});
