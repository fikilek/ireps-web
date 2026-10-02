import test from "node:test";
import assert from "node:assert/strict";

import { enrichTargetedBatchRow } from "../targetedBatches/getTargetedBatchRowsCallable.js";

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
          date: NOW,
          rowId: ROW_ID,
          fieldWork: {
            status: "IN_PROGRESS", updatedAt: NOW,
            meterId: "AST_001",
            noAccess: Array.from({ length: 3 }, () => ({ date: "2026-08-05", time: "00:05:06", user: "Operator" })),
          },
        },
      ],
    }),
  );

  assert.equal(result.noAccessCount, 3);
  assert.equal(result.fieldWorkMeterId, "AST_001");
  assert.equal(result.noAccessSourceStatus, "OK");
});






