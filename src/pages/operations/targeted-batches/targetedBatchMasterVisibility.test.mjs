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
    targetedBatchUtilsSource.replaceAll("../../../../functions/salesAllMeters/sales-batch-policy.js", new URL("../../../../functions/salesAllMeters/sales-batch-policy.js", import.meta.url).href).replace(
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

test("visible Sales cannot enter a draft; identity is independent of visibility", () => {
  const row = { ...baseRow, erfId: null, master: { id: baseRow.id, visibility: "INVISIBLE" }, hasUsableGps: true,
    erfCandidates: [{ ErfId: "ERF_1", Latitude: -28.5, Longitude: 30.5 }] };
  const open = buildSalesTargetedBatchDraftPlan({ rows: [row], lmPcode: "ZA5241", lmName: "Endumeni" });
  const completed = buildSalesTargetedBatchDraftPlan({ rows: [{ ...row, master: { ...row.master, visibility: "VISIBLE" } }], lmPcode: "ZA5241", lmName: "Endumeni" });
  assert.equal(open.ok, true); assert.equal(completed.ok, false);
  assert.equal(getSalesAllMeterId(row), getSalesAllMeterId({ ...row, masterVisibility: "VISIBLE" }));
});
test("server Sales visibility remains authoritative with no draft fallback", async () => {
  const source = await readFile(new URL("../../../../functions/targetedBatches/documentFactory.js", import.meta.url), "utf8");
  assert.match(source, /masterVisibility = salesSource\.master\?\.visibility/);
  assert.doesNotMatch(source, /draftRow\?\.masterVisibility/);
});
