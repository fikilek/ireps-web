import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const targetedBatchUtilsSource = await readFile(
  new URL("./targetedBatchUtils.js", import.meta.url),
  "utf8",
);
const draftModelUrl = new URL(
  "../../../redux/targetedBatchDraftModel.js",
  import.meta.url,
).href;
const targetedBatchUtils = await import(
  `data:text/javascript;base64,${Buffer.from(
    targetedBatchUtilsSource.replace(
      '"../../../redux/targetedBatchDraftModel"',
      JSON.stringify(draftModelUrl),
    ),
  ).toString("base64")}`
);
const {
  buildSalesTargetedBatchDraftPlan,
  getSalesAllMeterId,
  normalizeSalesTargetRows,
} = targetedBatchUtils;

const baseRow = {
  id: "07142661326",
  meterNo: "07142661326",
  meterNoNormalized: "07142661326",
  lmPcode: "ZA5241",
  erfId: "ERF_1",
  erfNo: "1",
  wardPcode: "ZA5241001",
  wardNumber: "1",
  totalSalesC: 100,
};

test("flat Sales masterVisibility propagates without changing draft row shape", () => {
  const [withoutVisibility] = normalizeSalesTargetRows([baseRow], "TEST");
  const [withVisibility] = normalizeSalesTargetRows(
    [{ ...baseRow, masterVisibility: "VISIBLE" }],
    "TEST",
  );

  assert.equal(withVisibility.masterVisibility, "VISIBLE");
  assert.deepEqual(
    { ...withVisibility, masterVisibility: null },
    withoutVisibility,
  );
});

test("masterVisibility changes no Targeted Batch eligibility or row identity", () => {
  const withoutVisibility = buildSalesTargetedBatchDraftPlan({
    rows: [baseRow],
    lmPcode: "ZA5241",
    lmName: "Endumeni",
  });
  const withVisibility = buildSalesTargetedBatchDraftPlan({
    rows: [{ ...baseRow, masterVisibility: "VISIBLE" }],
    lmPcode: "ZA5241",
    lmName: "Endumeni",
  });

  assert.equal(withVisibility.ok, withoutVisibility.ok);
  assert.deepEqual(withVisibility.failures, withoutVisibility.failures);
  assert.deepEqual(withVisibility.salesAllMeterIds, withoutVisibility.salesAllMeterIds);
  assert.deepEqual(
    withVisibility.proposedBatches.map((batch) => ({
      scope: batch.scope,
      rowCount: batch.rowCount,
      salesAllMeterIds: batch.salesAllMeterIds,
      validation: batch.validation,
    })),
    withoutVisibility.proposedBatches.map((batch) => ({
      scope: batch.scope,
      rowCount: batch.rowCount,
      salesAllMeterIds: batch.salesAllMeterIds,
      validation: batch.validation,
    })),
  );
  assert.equal(
    getSalesAllMeterId({ ...baseRow, masterVisibility: "VISIBLE" }),
    getSalesAllMeterId(baseRow),
  );
});

test("server Sales visibility remains authoritative over the client draft", async () => {
  const documentFactory = await readFile(
    new URL(
      "../../../../functions/targetedBatches/documentFactory.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    documentFactory,
    /salesSource\?\.master\?\.visibility \|\|\s*draftRow\?\.masterVisibility/,
  );
});
