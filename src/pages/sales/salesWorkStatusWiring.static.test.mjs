import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const table = await readFile(
  new URL("./components/SalesMetersTable.jsx", import.meta.url),
  "utf8",
);
const prepaid = await readFile(new URL("./PrepaidSales.jsx", import.meta.url), "utf8");
const astsApi = await readFile(
  new URL("../../redux/astsApi.js", import.meta.url),
  "utf8",
);

test("Sales table consumes only the projected three-state Work Status", () => {
  assert.match(table, /row\?\.salesWorkStatus/);
  assert.doesNotMatch(table, /classifySalesStatus/);
  assert.doesNotMatch(table, /models\/salesStatusModel\.js/);
  assert.doesNotMatch(table, /getSalesStatusLabel|getSalesStatusSortRank/);
  assert.doesNotMatch(table, /salesStatusIntegrityException/);

  const options = table.match(
    /const SALES_TABLE_WORK_STATUS_FILTER_OPTIONS = \[([\s\S]*?)\n\];/,
  )?.[1];
  assert.equal(options?.match(/value:/g)?.length, 3);
  assert.doesNotMatch(options, /INTEGRITY_EXCEPTION/);
  assert.match(table, /\?\.label \|\| "—"/);
  assert.match(table, /SALES_TABLE_WORK_STATUS_RANKS\[status\] \?\? 3/);
});

test("Prepaid Sales uses current-LM Sales data as its only Work Status stream", () => {
  for (const removed of [
    "useGetSalesWorkStatusAstsByLmPcodeQuery",
    "useGetRegistryMetersByLmQuery",
    "salesWorkStatusAstSync",
    "registryLoading",
    "Reconciling live Sales, Meter Registry and AST evidence.",
    "Sales, Meter Registry and AST evidence must all be available",
  ]) {
    assert.equal(prepaid.includes(removed), false, removed);
  }
  assert.match(prepaid, /currentData: currentSalesRows/);
  assert.doesNotMatch(prepaid, /currentData: currentSalesRows\s*=/);
  assert.doesNotMatch(prepaid, /currentData: salesRows/);
  assert.doesNotMatch(prepaid, /data: salesRows/);
  assert.match(
    prepaid,
    /const salesRows = Array\.isArray\(currentSalesRows\)\s*\? currentSalesRows\s*: EMPTY_SALES_ROWS;/,
  );
  assert.match(
    prepaid,
    /const salesWorkStatusError = activeLmPcode && error \? error : null;/,
  );

  const readiness = prepaid.match(
    /const salesWorkStatusReady =([\s\S]*?);/,
  )?.[1];
  assert.match(readiness, /Boolean\(activeLmPcode\)/);
  assert.match(readiness, /Array\.isArray\(currentSalesRows\)/);
  assert.doesNotMatch(readiness, /isLoading|isFetching/);
  assert.match(prepaid, /buildSalesTableWorkStatusRows\(\{ salesRows \}\)/);
  assert.match(prepaid, /registryName: "Selected Prepaid Sales Meters"/);
});

test("LM-switch readiness distinguishes pending current data from a loaded empty LM", () => {
  const getReadiness = ({ activeLmPcode, currentSalesRows, error = null }) => {
    const salesWorkStatusError = activeLmPcode && error ? error : null;
    return (
      Boolean(activeLmPcode) &&
      Array.isArray(currentSalesRows) &&
      !salesWorkStatusError
    );
  };

  assert.equal(
    getReadiness({
      activeLmPcode: "LM_B",
      currentSalesRows: undefined,
      previousArgumentData: [{ id: "LM_A_METER" }],
    }),
    false,
  );
  assert.equal(
    getReadiness({ activeLmPcode: "LM_B", currentSalesRows: [] }),
    true,
  );
});

test("Sales-specific AST stream is removed while general AST hooks remain", () => {
  for (const removed of [
    "getSalesWorkStatusAstsByLmPcode",
    "createSalesWorkStatusAstStreamState",
    "mapSalesWorkStatusAstDoc",
  ]) {
    assert.equal(astsApi.includes(removed), false, removed);
  }
  for (const retained of [
    "useGetAstByIdQuery",
    "useGetAstsByLmPcodeQuery",
    "useGetAstsByLmPcodeWardPcodeQuery",
  ]) {
    assert.equal(astsApi.includes(retained), true, retained);
  }
});
