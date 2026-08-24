import assert from "node:assert/strict";
import test from "node:test";

import { buildTargetedBatchDashboardReadModel } from "../src/pages/sales/models/salesTargetedBatchReadModel.js";

const TB_ID = "TGB_20260824_120000_AB12";

function makeBatch(overrides = {}) {
  return {
    id: TB_ID,
    source: { type: "PREPAID_SALES" },
    ...overrides,
  };
}

function makeRow(index, salesAllMeterId, overrides = {}) {
  return {
    id: `ROW_${index}`,
    tbId: TB_ID,
    salesAllMeterId,
    ...overrides,
  };
}

function makeInitialRef(overrides = {}) {
  return {
    id: TB_ID,
    date: "2026-08-24",
    ...overrides,
  };
}

function makeCompletedFieldWork(overrides = {}) {
  return {
    status: "COMPLETED",
    outcomeCode: "METER_DISCOVERED",
    targetedMeterNo: "07100000001",
    discoveredMeterNo: "07100000001",
    meterMatch: true,
    premiseId: "PRM_001",
    meterId: "AST_001",
    trnId: "TRN_001",
    submittedAt: "2026-08-24T10:00:00.000Z",
    updatedAt: "2026-08-24T10:00:00.000Z",
    noAccess: [],
    ...overrides,
  };
}

function resolve({ rows, salesById, batches = [makeBatch()] }) {
  return buildTargetedBatchDashboardReadModel({ batches, rows, salesById });
}

function metrics(result) {
  return result.metricsByTbId[TB_ID];
}

function integrity(result) {
  return result.integrityByTbId[TB_ID];
}

test("initial canonical tbRef counts Original only", () => {
  const row = makeRow(1, "07100000001");
  const result = resolve({
    rows: [row],
    salesById: {
      "07100000001": { tbRefs: [makeInitialRef()] },
    },
  });

  assert.deepEqual(
    {
      originalMeters: metrics(result).originalMeters,
      metersFound: metrics(result).metersFound,
      metersDifferent: metrics(result).metersDifferent,
      premises: metrics(result).premises,
      noAccessAttempts: metrics(result).noAccessAttempts,
    },
    {
      originalMeters: 1,
      metersFound: 0,
      metersDifferent: 0,
      premises: 0,
      noAccessAttempts: 0,
    },
  );
});

test("same-meter completed discovery counts Found and Premises", () => {
  const row = makeRow(1, "07100000001");
  const result = resolve({
    rows: [row],
    salesById: {
      "07100000001": {
        tbRefs: [
          makeInitialRef({
            rowId: row.id,
            fieldWork: makeCompletedFieldWork(),
          }),
        ],
      },
    },
  });

  assert.equal(metrics(result).originalMeters, 1);
  assert.equal(metrics(result).metersFound, 1);
  assert.equal(metrics(result).metersDifferent, 0);
  assert.equal(metrics(result).premises, 1);
  assert.equal(integrity(result).issueCount, 0);
});

test("different-meter completed discovery uses persisted meterMatch", () => {
  const row = makeRow(1, "07100000001");
  const result = resolve({
    rows: [row],
    salesById: {
      "07100000001": {
        tbRefs: [
          makeInitialRef({
            rowId: row.id,
            fieldWork: makeCompletedFieldWork({
              discoveredMeterNo: "07100000002",
              meterMatch: false,
            }),
          }),
        ],
      },
    },
  });

  assert.equal(metrics(result).metersFound, 1);
  assert.equal(metrics(result).metersDifferent, 1);
});

test("Premises counts distinct premise IDs", () => {
  const rows = [makeRow(1, "07100000001"), makeRow(2, "07100000002")];
  const result = resolve({
    rows,
    salesById: {
      "07100000001": {
        tbRefs: [makeInitialRef({ rowId: rows[0].id, fieldWork: makeCompletedFieldWork({ premiseId: "PRM_SHARED" }) })],
      },
      "07100000002": {
        tbRefs: [makeInitialRef({ rowId: rows[1].id, fieldWork: makeCompletedFieldWork({ premiseId: "PRM_SHARED", meterId: "AST_002", trnId: "TRN_002" }) })],
      },
    },
  });

  assert.equal(metrics(result).metersFound, 2);
  assert.equal(metrics(result).premises, 1);
});

test("No Access sums attempts and separately counts affected meters", () => {
  const rows = [makeRow(1, "07100000001"), makeRow(2, "07100000002")];
  const result = resolve({
    rows,
    salesById: {
      "07100000001": {
        tbRefs: [
          makeInitialRef({
            rowId: rows[0].id,
            fieldWork: {
              status: "IN_PROGRESS",
              outcomeCode: null,
              noAccess: [{ date: "2026-08-24" }, { date: "2026-08-24" }],
            },
          }),
        ],
      },
      "07100000002": {
        tbRefs: [
          makeInitialRef({
            rowId: rows[1].id,
            fieldWork: {
              status: "IN_PROGRESS",
              outcomeCode: null,
              noAccess: [{ date: "2026-08-24" }],
            },
          }),
        ],
      },
    },
  });

  assert.equal(metrics(result).noAccessAttempts, 3);
  assert.equal(metrics(result).metersWithNoAccess, 2);
});

test("No Access history survives later successful discovery", () => {
  const row = makeRow(1, "07100000001");
  const result = resolve({
    rows: [row],
    salesById: {
      "07100000001": {
        tbRefs: [
          makeInitialRef({
            rowId: row.id,
            fieldWork: makeCompletedFieldWork({
              noAccess: [{ date: "2026-08-24" }, { date: "2026-08-24" }],
            }),
          }),
        ],
      },
    },
  });

  assert.equal(metrics(result).metersFound, 1);
  assert.equal(metrics(result).noAccessAttempts, 2);
  assert.equal(metrics(result).metersWithNoAccess, 1);
});

test("current tbId ignores historical references for other batches", () => {
  const row = makeRow(1, "07100000001");
  const result = resolve({
    rows: [row],
    salesById: {
      "07100000001": {
        tbRefs: [
          { id: "TGB_OLD", date: "2026-08-01" },
          makeInitialRef(),
          { id: "TGB_OTHER", date: "2026-08-02" },
        ],
      },
    },
  });

  assert.equal(metrics(result).originalMeters, 1);
  assert.equal(integrity(result).issueCount, 0);
});

test("normalized duplicate tbRef IDs fail closed", () => {
  const row = makeRow(1, "07100000001");
  const result = resolve({
    rows: [row],
    salesById: {
      "07100000001": {
        tbRefs: [
          makeInitialRef(),
          makeInitialRef({ id: ` ${TB_ID.toLowerCase()} ` }),
        ],
      },
    },
  });

  assert.equal(metrics(result).originalMeters, 0);
  assert.equal(integrity(result).metricCompleteness.originalMeters, false);
  assert.ok(integrity(result).issues.some((issue) => issue.code === "TB_REF_DUPLICATE"));
});

test("missing Sales document marks Original incomplete", () => {
  const result = resolve({
    rows: [makeRow(1, "07100000001")],
    salesById: {},
  });

  assert.equal(metrics(result).originalMeters, 0);
  assert.equal(integrity(result).metricCompleteness.originalMeters, false);
  assert.ok(integrity(result).issues.some((issue) => issue.code === "SALES_DOCUMENT_MISSING"));
});

test("rowId mismatch keeps Original but excludes derived outcomes", () => {
  const row = makeRow(1, "07100000001");
  const result = resolve({
    rows: [row],
    salesById: {
      "07100000001": {
        tbRefs: [
          makeInitialRef({
            rowId: "ROW_OTHER",
            fieldWork: makeCompletedFieldWork({ noAccess: [{ date: "2026-08-24" }] }),
          }),
        ],
      },
    },
  });

  assert.equal(metrics(result).originalMeters, 1);
  assert.equal(metrics(result).metersFound, 0);
  assert.equal(metrics(result).noAccessAttempts, 0);
  assert.ok(integrity(result).issues.some((issue) => issue.code === "TB_REF_ROW_MISMATCH"));
});

test("completed discovery missing discoveredMeterNo does not count Found", () => {
  const row = makeRow(1, "07100000001");
  const result = resolve({
    rows: [row],
    salesById: {
      "07100000001": {
        tbRefs: [
          makeInitialRef({
            rowId: row.id,
            fieldWork: makeCompletedFieldWork({ discoveredMeterNo: "" }),
          }),
        ],
      },
    },
  });

  assert.equal(metrics(result).metersFound, 0);
  assert.equal(integrity(result).metricCompleteness.metersFound, false);
});

test("Found can remain countable while Different and Premises are incomplete", () => {
  const row = makeRow(1, "07100000001");
  const result = resolve({
    rows: [row],
    salesById: {
      "07100000001": {
        tbRefs: [
          makeInitialRef({
            rowId: row.id,
            fieldWork: makeCompletedFieldWork({
              meterMatch: null,
              premiseId: "",
            }),
          }),
        ],
      },
    },
  });

  assert.equal(metrics(result).metersFound, 1);
  assert.equal(metrics(result).metersDifferent, 0);
  assert.equal(metrics(result).premises, 0);
  assert.equal(integrity(result).metricCompleteness.metersDifferent, false);
  assert.equal(integrity(result).metricCompleteness.premises, false);
});

test("duplicate permanent Sales membership counts Original once and fails derived closed", () => {
  const rows = [makeRow(1, "07100000001"), makeRow(2, "07100000001")];
  const result = resolve({
    rows,
    salesById: {
      "07100000001": {
        tbRefs: [
          makeInitialRef({
            rowId: rows[0].id,
            fieldWork: makeCompletedFieldWork(),
          }),
        ],
      },
    },
  });

  assert.equal(metrics(result).originalMeters, 1);
  assert.equal(metrics(result).metersFound, 0);
  assert.ok(integrity(result).issues.some((issue) => issue.code === "DUPLICATE_SALES_MEMBERSHIP"));
});

test("No Access attempts may exceed Original without changing affected-meter count", () => {
  const row = makeRow(1, "07100000001");
  const result = resolve({
    rows: [row],
    salesById: {
      "07100000001": {
        tbRefs: [
          makeInitialRef({
            rowId: row.id,
            fieldWork: {
              status: "IN_PROGRESS",
              noAccess: Array.from({ length: 4 }, () => ({ date: "2026-08-24" })),
            },
          }),
        ],
      },
    },
  });

  assert.equal(metrics(result).originalMeters, 1);
  assert.equal(metrics(result).noAccessAttempts, 4);
  assert.equal(metrics(result).metersWithNoAccess, 1);
});


test("Non-GPS batches use the same Sales tbRef metric semantics", () => {
  const row = makeRow(1, "07100000001");
  const result = resolve({
    batches: [makeBatch({ source: { type: "PREPAID_SALES_NON_GPS" } })],
    rows: [row],
    salesById: {
      "07100000001": {
        tbRefs: [makeInitialRef({ rowId: row.id, fieldWork: makeCompletedFieldWork() })],
      },
    },
  });

  assert.equal(metrics(result).originalMeters, 1);
  assert.equal(metrics(result).metersFound, 1);
  assert.equal(metrics(result).premises, 1);
});

test("IN_PROGRESS with stale discovered meter fields does not count Found", () => {
  const row = makeRow(1, "07100000001");
  const result = resolve({
    rows: [row],
    salesById: {
      "07100000001": {
        tbRefs: [
          makeInitialRef({
            rowId: row.id,
            fieldWork: makeCompletedFieldWork({
              status: "IN_PROGRESS",
              outcomeCode: null,
            }),
          }),
        ],
      },
    },
  });

  assert.equal(metrics(result).metersFound, 0);
});

test("COMPLETED with a non-discovery outcome does not count Found", () => {
  const row = makeRow(1, "07100000001");
  const result = resolve({
    rows: [row],
    salesById: {
      "07100000001": {
        tbRefs: [
          makeInitialRef({
            rowId: row.id,
            fieldWork: makeCompletedFieldWork({ outcomeCode: "OTHER_OUTCOME" }),
          }),
        ],
      },
    },
  });

  assert.equal(metrics(result).metersFound, 0);
});

test("malformed No Access array is diagnosed without inventing attempts", () => {
  const row = makeRow(1, "07100000001");
  const result = resolve({
    rows: [row],
    salesById: {
      "07100000001": {
        tbRefs: [
          makeInitialRef({
            rowId: row.id,
            fieldWork: { status: "IN_PROGRESS", noAccess: { count: 2 } },
          }),
        ],
      },
    },
  });

  assert.equal(metrics(result).noAccessAttempts, 0);
  assert.equal(integrity(result).metricCompleteness.noAccess, false);
});
