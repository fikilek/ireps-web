import assert from "node:assert/strict";
import test from "node:test";

import {
  TARGETED_BATCH_COLLECTIONS,
  validateAuthoritativeErfDocument,
  validateAuthoritativeSalesDocument,
} from "../targetedBatches/helpers.js";

const SALES_ID = "01023670951";
const LM_PCODE = "ZA5241";

const ERF_ID = "ERF_1";
const WARD_PCODE = "ZA5241002";
const WARD_NUMBER = "2";

function authoritativeErfSnapshot(overrides = {}) {
  return {
    exists: true,
    id: ERF_ID,
    data: () => ({
      erfId: ERF_ID,
      sg: { parcelNo: "386", portion: 9 },
      admin: {
        localMunicipality: { pcode: LM_PCODE, name: "Endumeni" },
        ward: { pcode: WARD_PCODE, name: "Ward 2" },
      },
      ...overrides,
    }),
  };
}

function validateErf(snapshotValue, overrides = {}) {
  return validateAuthoritativeErfDocument({
    snapshot: snapshotValue,
    expectedErfId: ERF_ID,
    expectedLmPcode: LM_PCODE,
    expectedWardPcode: WARD_PCODE,
    expectedWardNumber: WARD_NUMBER,
    ...overrides,
  });
}

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

test("canonical Sales All missing erfNo still passes when erfId is valid", () => {
  const result = validateAuthoritativeSalesDocument({
    snapshot: snapshot({ erfCandidates: [{ erfId: ERF_ID }] }),
    expectedSalesId: SALES_ID,
    expectedLmPcode: LM_PCODE,
    draftRow: {
      meterNo: SALES_ID,
      meterNoNormalized: SALES_ID,
      erfId: ERF_ID,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.erfReference.erfId, ERF_ID);
  assert.equal(result.erfReference.erfNo, "");
});

test("canonical Sales All ignores draft erfNo disagreement when erfId matches", () => {
  const result = validateAuthoritativeSalesDocument({
    snapshot: snapshot(),
    expectedSalesId: SALES_ID,
    expectedLmPcode: LM_PCODE,
    draftRow: { ...draftRow, erfNo: "999/1" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.erfReference.erfId, ERF_ID);
  assert.equal(result.erfReference.erfNo, "386/9");
});

test("canonical Sales All still rejects a missing ERF identity", () => {
  const result = validateAuthoritativeSalesDocument({
    snapshot: snapshot({ erfCandidates: [] }),
    expectedSalesId: SALES_ID,
    expectedLmPcode: LM_PCODE,
    draftRow: {
      meterNo: SALES_ID,
      meterNoNormalized: SALES_ID,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "SALES_ERF_REFERENCE_MISSING");
});

test("canonical Sales All still rejects ambiguous ERF identity", () => {
  const result = validateAuthoritativeSalesDocument({
    snapshot: snapshot({
      erfCandidates: [
        { erfId: ERF_ID, erfNo: "386/9" },
        { erfId: "ERF_2", erfNo: "387" },
      ],
    }),
    expectedSalesId: SALES_ID,
    expectedLmPcode: LM_PCODE,
    draftRow,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "SALES_ERF_REFERENCE_AMBIGUOUS");
});

test("canonical Sales All still rejects draft erfId mismatch", () => {
  const result = validateAuthoritativeSalesDocument({
    snapshot: snapshot(),
    expectedSalesId: SALES_ID,
    expectedLmPcode: LM_PCODE,
    draftRow: { ...draftRow, erfId: "ERF_2" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "DRAFT_ERF_REFERENCE_MISMATCH");
});

test("authoritative ERF missing canonical erfNo still passes identity and scope validation", () => {
  const result = validateErf(authoritativeErfSnapshot({ sg: {} }));

  assert.equal(result.ok, true);
  assert.equal(result.erfNo, "");
  assert.equal(result.scope.lmPcode, LM_PCODE);
  assert.equal(result.scope.wardPcode, WARD_PCODE);
  assert.equal(result.scope.wardNumber, WARD_NUMBER);
});

test("authoritative ERF ignores legacy expectedErfNo disagreement", () => {
  const result = validateErf(authoritativeErfSnapshot(), {
    expectedErfNo: "999/1",
  });

  assert.equal(result.ok, true);
  assert.equal(result.erfNo, "386/9");
});

test("authoritative ERF still rejects a missing document", () => {
  const result = validateErf({ exists: false, id: ERF_ID });

  assert.equal(result.ok, false);
  assert.equal(result.code, "AUTHORITATIVE_ERF_NOT_FOUND");
});

test("authoritative ERF still rejects erfId mismatch", () => {
  const result = validateErf(
    authoritativeErfSnapshot({ erfId: "ERF_2" }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "AUTHORITATIVE_ERF_ID_MISMATCH");
});

test("authoritative ERF still rejects LM mismatch", () => {
  const result = validateErf(
    authoritativeErfSnapshot({
      admin: {
        localMunicipality: { pcode: "ZA9999", name: "Other LM" },
        ward: { pcode: WARD_PCODE, name: "Ward 2" },
      },
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "AUTHORITATIVE_ERF_LM_SCOPE_MISMATCH");
});

test("authoritative ERF still rejects Ward PCode mismatch", () => {
  const result = validateErf(
    authoritativeErfSnapshot({
      admin: {
        localMunicipality: { pcode: LM_PCODE, name: "Endumeni" },
        ward: { pcode: "ZA5241003", name: "Ward 3" },
      },
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "AUTHORITATIVE_ERF_WARD_SCOPE_MISMATCH");
});

test("authoritative ERF still rejects Ward Number mismatch", () => {
  const result = validateErf(authoritativeErfSnapshot(), {
    expectedWardNumber: "3",
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "AUTHORITATIVE_ERF_WARD_NUMBER_MISMATCH");
});
