import test from "node:test";
import assert from "node:assert/strict";

import { enrichTargetedBatchRow } from "../targetedBatches/getTargetedBatchRowsCallable.js";
import {
  buildSalesAppend,
  resolveSalesTbRef,
} from "../targetedBatches/recordTargetedBatchNoAccessCallable.js";

const TB_ID = "TGB_20260804_221932_OP6H";
const ROW_ID = "TBR_20260804_221932_OP6H_000001";
const SALES_ID = "07027981971";
const NOW = { seconds: 10, nanoseconds: 0 };

function fakeSalesSnapshot(data) {
  return {
    exists: true,
    data: () => data,
  };
}

function input() {
  return {
    tbId: TB_ID,
    rowId: ROW_ID,
    capturedAt: {
      iso: "2026-08-05T00:05:06.000Z",
    },
  };
}

test("row enrichment reads the Sales tbRef by batch ID without requiring rowId", () => {
  const row = {
    id: ROW_ID,
    tbId: TB_ID,
    salesAllMeterId: SALES_ID,
  };
  const creationDate = { seconds: 1, nanoseconds: 0 };

  const result = enrichTargetedBatchRow(
    row,
    fakeSalesSnapshot({
      tbRefs: [{ id: TB_ID, date: creationDate }],
    }),
  );

  assert.equal(result.salesDocId, SALES_ID);
  assert.equal(result.noAccessCount, 0);
  assert.equal(result.fieldWorkMeterId, null);
  assert.equal(result.noAccessSourceStatus, "OK");
});

test("row enrichment returns NA length and fieldWork meterId", () => {
  const result = enrichTargetedBatchRow(
    {
      id: ROW_ID,
      tbId: TB_ID,
      salesAllMeterId: SALES_ID,
    },
    fakeSalesSnapshot({
      tbRefs: [
        {
          id: TB_ID,
          rowId: ROW_ID,
          fieldWork: {
            meterId: "AST_001",
            noAccess: [{}, {}, {}],
          },
        },
      ],
    }),
  );

  assert.equal(result.noAccessCount, 3);
  assert.equal(result.fieldWorkMeterId, "AST_001");
  assert.equal(result.noAccessSourceStatus, "OK");
});

test("first NA accepts the original batch-only Sales tbRef and stamps rowId", () => {
  const creationDate = { seconds: 1, nanoseconds: 0 };
  const result = buildSalesAppend({
    tbRefs: [{ id: TB_ID, date: creationDate }],
    input: input(),
    premiseId: null,
    actorName: "Peter Peter",
    now: NOW,
  });

  assert.equal(result.count, 1);
  assert.equal(result.tbRefs[0].id, TB_ID);
  assert.strictEqual(result.tbRefs[0].date, creationDate);
  assert.equal(result.tbRefs[0].rowId, ROW_ID);
  assert.equal(result.tbRefs[0].fieldWork.meterId, undefined);
  assert.deepEqual(result.tbRefs[0].fieldWork.noAccess, [
    {
      date: "2026-08-05",
      time: "00:05:06",
      user: "Peter Peter",
    },
  ]);
});

test("NA is rejected only when fieldWork meterId has a value", () => {
  assert.throws(
    () =>
      buildSalesAppend({
        tbRefs: [
          {
            id: TB_ID,
            rowId: ROW_ID,
            fieldWork: {
              meterId: "AST_001",
              noAccess: [],
            },
          },
        ],
        input: input(),
        premiseId: null,
        actorName: "Peter Peter",
        now: NOW,
      }),
    (error) => {
      assert.equal(error.code, "TARGETED_BATCH_METER_ALREADY_LINKED");
      return true;
    },
  );
});

test("a Sales tbRef already assigned to another row is rejected", () => {
  assert.throws(
    () =>
      resolveSalesTbRef({
        tbRefs: [{ id: TB_ID, rowId: "TBR_OTHER" }],
        input: input(),
      }),
    (error) => {
      assert.equal(error.code, "SALES_TB_REF_ROW_CONFLICT");
      return true;
    },
  );
});
