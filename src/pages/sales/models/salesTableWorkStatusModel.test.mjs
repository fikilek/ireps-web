import assert from "node:assert/strict";
import test from "node:test";

import { SALES_STATUSES } from "./salesStatusModel.js";
import {
  buildSalesTableWorkStatusRows,
  classifySalesTableWorkStatus,
  normalizeSalesWorkStatusMeterNo,
} from "./salesTableWorkStatusModel.js";

const LM = "ZA5241";
const METER = "38646963";
const AST_ID = "TRN_MDIS_38646963";

function sales(overrides = {}) {
  return {
    id: METER,
    meterNo: METER,
    meterNoNormalized: METER,
    lmPcode: LM,
    tbRefs: [],
    tbRefsIntegrity: { valid: true, issues: [] },
    ...overrides,
  };
}

function registry(overrides = {}) {
  return {
    id: AST_ID,
    meterId: AST_ID,
    meterNo: METER,
    lmPcode: LM,
    ...overrides,
  };
}

function ast(overrides = {}) {
  return {
    id: AST_ID,
    meterNo: METER,
    masterId: METER,
    lmPcode: LM,
    ...overrides,
  };
}

test("meter identity uses canonical whitespace-free uppercase letters/digits", () => {
  assert.equal(normalizeSalesWorkStatusMeterNo(" 38 646 963 "), METER);
  assert.equal(normalizeSalesWorkStatusMeterNo("abc123"), "ABC123");
  assert.equal(normalizeSalesWorkStatusMeterNo("38-646"), "");
});

test("Sales + reconciled Registry + AST is COMPLETED even with no Targeted Batch", () => {
  assert.equal(
    classifySalesTableWorkStatus({
      sales: sales(),
      registryMatches: [registry()],
      astMatches: [ast()],
      expectedLmPcode: LM,
    }).status,
    SALES_STATUSES.COMPLETED,
  );
});

test("genuine TB field work with no Registry or AST is IN_PROGRESS", () => {
  const result = classifySalesTableWorkStatus({
    sales: sales({
      tbRefs: [
        {
          id: "TGB_1",
          fieldWork: { status: "IN_PROGRESS" },
        },
      ],
    }),
    registryMatches: [],
    astMatches: [],
    expectedLmPcode: LM,
  });

  assert.equal(result.status, SALES_STATUSES.IN_PROGRESS);
});

test("untouched Sales meter with no Registry, AST or field work is NOT_STARTED", () => {
  const result = classifySalesTableWorkStatus({
    sales: sales(),
    registryMatches: [],
    astMatches: [],
    expectedLmPcode: LM,
  });

  assert.equal(result.status, SALES_STATUSES.NOT_STARTED);
});

test("AST without Meter Registry is quarantined as an integrity exception", () => {
  const result = classifySalesTableWorkStatus({
    sales: sales(),
    registryMatches: [],
    astMatches: [ast()],
    expectedLmPcode: LM,
  });

  assert.equal(result.status, SALES_STATUSES.INTEGRITY_EXCEPTION);
  assert.ok(result.issues.includes("AST_WITHOUT_METER_REGISTRY"));
});

test("Meter Registry without AST is quarantined as an integrity exception", () => {
  const result = classifySalesTableWorkStatus({
    sales: sales(),
    registryMatches: [registry()],
    astMatches: [],
    expectedLmPcode: LM,
  });

  assert.equal(result.status, SALES_STATUSES.INTEGRITY_EXCEPTION);
  assert.ok(result.issues.includes("METER_REGISTRY_WITHOUT_AST"));
});

test("Registry and AST must resolve to the same AST identity", () => {
  const result = classifySalesTableWorkStatus({
    sales: sales(),
    registryMatches: [registry({ meterId: "AST_OTHER", id: "AST_OTHER" })],
    astMatches: [ast()],
    expectedLmPcode: LM,
  });

  assert.equal(result.status, SALES_STATUSES.INTEGRITY_EXCEPTION);
  assert.ok(result.issues.includes("REGISTRY_AST_ID_MISMATCH"));
});

test("multiple authoritative matches are quarantined", () => {
  const result = classifySalesTableWorkStatus({
    sales: sales(),
    registryMatches: [registry()],
    astMatches: [ast(), ast({ id: "AST_SECOND" })],
    expectedLmPcode: LM,
  });

  assert.equal(result.status, SALES_STATUSES.INTEGRITY_EXCEPTION);
  assert.ok(result.issues.includes("MULTIPLE_AST_MATCHES"));
});

test("TB COMPLETED alone cannot substitute for Registry + AST completion", () => {
  const result = classifySalesTableWorkStatus({
    sales: sales({
      tbRefs: [
        {
          id: "TGB_1",
          fieldWork: { status: "COMPLETED" },
        },
      ],
    }),
    registryMatches: [],
    astMatches: [],
    expectedLmPcode: LM,
  });

  assert.equal(result.status, SALES_STATUSES.INTEGRITY_EXCEPTION);
  assert.ok(
    result.issues.includes("TB_COMPLETED_WITHOUT_RECONCILED_REGISTRY_AST"),
  );
});

test("builder reconciles a completed-outside-batch Sales row", () => {
  const [row] = buildSalesTableWorkStatusRows({
    salesRows: [sales()],
    registryRows: [registry()],
    astRows: [ast()],
    lmPcode: LM,
  });

  assert.equal(row.salesWorkStatus, SALES_STATUSES.COMPLETED);
  assert.deepEqual(row.salesWorkStatusIssues, []);
  assert.equal(row.salesWorkStatusEvidence.astId, AST_ID);
});
