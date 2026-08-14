import test from "node:test";
import assert from "node:assert/strict";

import {
  TARGETED_BATCH_DERIVED_STATES,
  TARGETED_BATCH_ROW_STATUSES,
  deriveTargetedBatchState,
  isCanonicalTargetedBatchRowStatus,
  validateCompleteTargetedBatchRowSet,
} from "../targetedBatches/lifecycle.js";

const TB_ID = "TGB_20260814_054525_TEST";

function expectedIdentity(rowNo) {
  return {
    id: `TBR_20260814_054525_TEST_${String(rowNo).padStart(6, "0")}`,
    rowNo,
    salesAllMeterId: `SALE_${String(rowNo).padStart(3, "0")}`,
  };
}

function row(rowNo, status, overrides = {}) {
  return {
    ...expectedIdentity(rowNo),
    tbId: TB_ID,
    status,
    ...overrides,
  };
}

function fixture(statuses) {
  const expectedRows = statuses.map((_, index) => expectedIdentity(index + 1));
  const rows = statuses.map((status, index) => row(index + 1, status));

  return {
    tbId: TB_ID,
    expectedRowCount: statuses.length,
    expectedRows,
    rows,
  };
}

function diagnosticCodes(result) {
  return result.diagnostics.map((item) => item.code);
}

test("canonical Targeted Batch row statuses are exact", () => {
  for (const status of Object.values(TARGETED_BATCH_ROW_STATUSES)) {
    assert.equal(isCanonicalTargetedBatchRowStatus(status), true);
  }

  for (const status of [
    undefined,
    null,
    "",
    "created",
    "IN_PROGRESS",
    "WAITING",
    "ALLOCATION_FAILED",
  ]) {
    assert.equal(isCanonicalTargetedBatchRowStatus(status), false);
  }
});

test("all CREATED rows derive CREATED", () => {
  const result = deriveTargetedBatchState(
    fixture([
      TARGETED_BATCH_ROW_STATUSES.created,
      TARGETED_BATCH_ROW_STATUSES.created,
    ]),
  );

  assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.created);
  assert.equal(result.completeRowSet, true);
});

test("all ALLOCATED rows derive ALLOCATED", () => {
  const result = deriveTargetedBatchState(
    fixture([
      TARGETED_BATCH_ROW_STATUSES.allocated,
      TARGETED_BATCH_ROW_STATUSES.allocated,
    ]),
  );

  assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.allocated);
});

test("all ACCEPTED rows derive ACCEPTED", () => {
  const result = deriveTargetedBatchState(
    fixture([
      TARGETED_BATCH_ROW_STATUSES.accepted,
      TARGETED_BATCH_ROW_STATUSES.accepted,
    ]),
  );

  assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.accepted);
});

test("ACCEPTED plus COMPLETED derives ACCEPTED", () => {
  const result = deriveTargetedBatchState(
    fixture([
      TARGETED_BATCH_ROW_STATUSES.completed,
      TARGETED_BATCH_ROW_STATUSES.accepted,
      TARGETED_BATCH_ROW_STATUSES.completed,
    ]),
  );

  assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.accepted);
});

test("all REJECTED rows derive REJECTED", () => {
  const result = deriveTargetedBatchState(
    fixture([
      TARGETED_BATCH_ROW_STATUSES.rejected,
      TARGETED_BATCH_ROW_STATUSES.rejected,
    ]),
  );

  assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.rejected);
});

test("all COMPLETED rows derive COMPLETED", () => {
  const result = deriveTargetedBatchState(
    fixture([
      TARGETED_BATCH_ROW_STATUSES.completed,
      TARGETED_BATCH_ROW_STATUSES.completed,
    ]),
  );

  assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.completed);
});

test("every unsupported two-state canonical combination fails closed", () => {
  const statuses = Object.values(TARGETED_BATCH_ROW_STATUSES);

  for (let leftIndex = 0; leftIndex < statuses.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < statuses.length;
      rightIndex += 1
    ) {
      const pair = [statuses[leftIndex], statuses[rightIndex]];
      const isAcceptedCompleted =
        pair.includes(TARGETED_BATCH_ROW_STATUSES.accepted) &&
        pair.includes(TARGETED_BATCH_ROW_STATUSES.completed);

      const result = deriveTargetedBatchState(fixture(pair));

      assert.equal(
        result.status,
        isAcceptedCompleted
          ? TARGETED_BATCH_DERIVED_STATES.accepted
          : TARGETED_BATCH_DERIVED_STATES.inconsistent,
        `Unexpected derived state for ${pair.join(" + ")}`,
      );
      assert.equal(result.completeRowSet, true);
    }
  }
});

test("zero rows fail closed as INCONSISTENT", () => {
  const result = deriveTargetedBatchState({
    tbId: TB_ID,
    expectedRowCount: 0,
    expectedRows: [],
    rows: [],
  });

  assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.inconsistent);
  assert.equal(result.completeRowSet, false);
  assert.ok(diagnosticCodes(result).includes("EXPECTED_ROW_COUNT_INVALID"));
});

test("missing canonical status fails closed", () => {
  const input = fixture([TARGETED_BATCH_ROW_STATUSES.created]);
  delete input.rows[0].status;

  const result = deriveTargetedBatchState(input);

  assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.inconsistent);
  assert.ok(diagnosticCodes(result).includes("ROW_STATUS_INVALID"));
});

test("unknown canonical status fails closed", () => {
  const input = fixture([TARGETED_BATCH_ROW_STATUSES.created]);
  input.rows[0].status = "IN_PROGRESS";

  const result = deriveTargetedBatchState(input);

  assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.inconsistent);
  assert.ok(diagnosticCodes(result).includes("ROW_STATUS_INVALID"));
});

test("missing expected identity manifest fails closed", () => {
  const input = fixture([TARGETED_BATCH_ROW_STATUSES.created]);
  delete input.expectedRows;

  const result = deriveTargetedBatchState(input);

  assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.inconsistent);
  assert.ok(
    diagnosticCodes(result).includes("EXPECTED_ROW_IDENTITIES_REQUIRED"),
  );
});

test("missing canonical row id fails even when rowId alias exists", () => {
  const input = fixture([TARGETED_BATCH_ROW_STATUSES.created]);
  input.rows[0].rowId = input.rows[0].id;
  delete input.rows[0].id;

  const result = deriveTargetedBatchState(input);
  const codes = diagnosticCodes(result);

  assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.inconsistent);
  assert.ok(codes.includes("ROW_ID_MISSING"));
  assert.ok(codes.includes("EXPECTED_ROW_MISSING"));
});

test(
  "missing canonical Sales identity fails even when sourceSalesAllMeterId alias exists",
  () => {
    const input = fixture([TARGETED_BATCH_ROW_STATUSES.created]);
    input.rows[0].sourceSalesAllMeterId = input.rows[0].salesAllMeterId;
    delete input.rows[0].salesAllMeterId;

    const result = deriveTargetedBatchState(input);
    const codes = diagnosticCodes(result);

    assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.inconsistent);
    assert.ok(codes.includes("SALES_ID_MISSING"));
    assert.ok(codes.includes("ROW_IDENTITY_SALES_ID_MISMATCH"));
  },
);

test("expected manifest aliases cannot replace canonical identity fields", () => {
  const input = fixture([TARGETED_BATCH_ROW_STATUSES.created]);
  input.expectedRows[0] = {
    rowId: input.expectedRows[0].id,
    rowNo: input.expectedRows[0].rowNo,
    sourceSalesAllMeterId: input.expectedRows[0].salesAllMeterId,
  };

  const result = deriveTargetedBatchState(input);
  const codes = diagnosticCodes(result);

  assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.inconsistent);
  assert.ok(codes.includes("EXPECTED_ROW_ID_MISSING"));
  assert.ok(codes.includes("EXPECTED_SALES_ID_MISSING"));
  assert.ok(codes.includes("UNEXPECTED_ROW_ID"));
});

test("expectedRowCount mismatch fails closed", () => {
  const input = fixture([
    TARGETED_BATCH_ROW_STATUSES.created,
    TARGETED_BATCH_ROW_STATUSES.created,
  ]);
  input.expectedRowCount = 3;

  const result = deriveTargetedBatchState(input);
  const codes = diagnosticCodes(result);

  assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.inconsistent);
  assert.ok(codes.includes("EXPECTED_IDENTITY_COUNT_MISMATCH"));
  assert.ok(codes.includes("ROW_COUNT_MISMATCH"));
});

test("row with wrong tbId fails closed", () => {
  const input = fixture([TARGETED_BATCH_ROW_STATUSES.created]);
  input.rows[0].tbId = "TGB_OTHER";

  const result = deriveTargetedBatchState(input);

  assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.inconsistent);
  assert.ok(diagnosticCodes(result).includes("ROW_TB_ID_MISMATCH"));
});

test("duplicate row ID fails closed", () => {
  const input = fixture([
    TARGETED_BATCH_ROW_STATUSES.created,
    TARGETED_BATCH_ROW_STATUSES.created,
  ]);
  input.rows[1].id = input.rows[0].id;

  const result = deriveTargetedBatchState(input);

  assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.inconsistent);
  assert.ok(diagnosticCodes(result).includes("DUPLICATE_ROW_ID"));
});

test("duplicate row number fails closed", () => {
  const input = fixture([
    TARGETED_BATCH_ROW_STATUSES.created,
    TARGETED_BATCH_ROW_STATUSES.created,
  ]);
  input.rows[1].rowNo = input.rows[0].rowNo;

  const result = deriveTargetedBatchState(input);

  assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.inconsistent);
  assert.ok(diagnosticCodes(result).includes("DUPLICATE_ROW_NO"));
});

test("duplicate Sales identity fails closed", () => {
  const input = fixture([
    TARGETED_BATCH_ROW_STATUSES.created,
    TARGETED_BATCH_ROW_STATUSES.created,
  ]);
  input.rows[1].salesAllMeterId = input.rows[0].salesAllMeterId;

  const result = deriveTargetedBatchState(input);

  assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.inconsistent);
  assert.ok(diagnosticCodes(result).includes("DUPLICATE_SALES_ID"));
});

test("correct count with substituted row identity fails closed", () => {
  const input = fixture([
    TARGETED_BATCH_ROW_STATUSES.created,
    TARGETED_BATCH_ROW_STATUSES.created,
  ]);
  input.rows[1] = {
    ...input.rows[1],
    id: "TBR_SUBSTITUTED_000002",
    salesAllMeterId: "SALE_SUBSTITUTED",
  };

  const result = deriveTargetedBatchState(input);
  const codes = diagnosticCodes(result);

  assert.equal(result.actualRowCount, 2);
  assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.inconsistent);
  assert.ok(codes.includes("EXPECTED_ROW_MISSING"));
  assert.ok(codes.includes("UNEXPECTED_ROW_ID"));
});

test("correct row ID with substituted Sales identity fails closed", () => {
  const input = fixture([TARGETED_BATCH_ROW_STATUSES.created]);
  input.rows[0].salesAllMeterId = "SALE_WRONG";

  const result = deriveTargetedBatchState(input);

  assert.equal(result.status, TARGETED_BATCH_DERIVED_STATES.inconsistent);
  assert.ok(
    diagnosticCodes(result).includes("ROW_IDENTITY_SALES_ID_MISMATCH"),
  );
});

test("complete-row validator reports a clean authoritative set", () => {
  const input = fixture([
    TARGETED_BATCH_ROW_STATUSES.accepted,
    TARGETED_BATCH_ROW_STATUSES.completed,
  ]);

  const result = validateCompleteTargetedBatchRowSet(input);

  assert.equal(result.complete, true);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.expectedRowCount, 2);
  assert.equal(result.actualRowCount, 2);
});
