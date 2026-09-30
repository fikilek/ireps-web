import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { buildTargetedBatchRows, buildTargetedBatchWorkSummary } from "./targetedBatchRowsModel.js";
import { TB_ROW_COLUMNS, TB_ROW_DOWNLOAD_COLUMNS, targetedBatchRowSearchValue } from "./targetedBatchRowsColumns.js";
import { filterIrepsTableRows, sortIrepsTableRows, paginateIrepsTableRows, irepsTableDownloadColumns } from "../../../../components/table/irepsTableModel.js";
import { buildExcelArtifact } from "../../../../utils/reportPlatform/buildExcelArtifact.js";
import { takeOutBlockedReason } from "./takeOutOfBatchModel.js";

const batch = { id: "TB_TEST", source: { type: "PREPAID_SALES" }, rows: [
  { rowNo: 1, tbRowId: "R1", meterNo: "0001", salesAllMeterId: "0001", town: "Dundee", completionStatus: "NOT_STARTED", totalSalesC: 0 },
  { rowNo: 2, tbRowId: "R2", meterNo: "0002", salesAllMeterId: "0002", town: "Dundee", completionStatus: "IN_PROGRESS", totalSalesC: 45000 },
  { rowNo: 3, tbRowId: "R3", meterNo: "0003", salesAllMeterId: "0003", town: "Glencoe", completionStatus: "COMPLETED", totalSalesC: 200000, foundMeterNo: "0099", executionOutcome: "DIFFERENT_METER_FOUND_AT_ERF", premiseId: "PRM_TEST" },
  { rowNo: 10, tbRowId: "R10", meterNo: "0010", town: "Dundee", completionStatus: "COMPLETED", totalSalesC: null },
] };
const rows = buildTargetedBatchRows(batch);
const filter = filters => filterIrepsTableRows(rows, TB_ROW_COLUMNS, { filters, searchValue: targetedBatchRowSearchValue });

test("the three work-status buckets balance and each KPI filters exactly its count", () => {
  assert.deepEqual(buildTargetedBatchWorkSummary(rows), { total: 4, notStarted: 1, inProgress: 1, completed: 2 });
  for (const [status, count] of [["Not Started", 1], ["In Progress", 1], ["Completed", 2]]) {
    assert.equal(filter({ workStatus: status }).length, count);
  }
  assert.equal(filter({}).length, 4);
});

test("KPI status and column filters intersect; clearing only status retains the other filters", () => {
  assert.deepEqual(filter({ workStatus: "Completed", town: "Dundee" }).map(row => row.rowNo), ["10"]);
  assert.equal(filter({ workStatus: "", town: "Dundee" }).length, 3);
  assert.equal(filter({}).length, 4);
});

test("search and meter filtering retain found meters and linked references", () => {
  assert.deepEqual(filter({ meterNo: "0099" }).map(row => row.tbRowId), ["R3"]);
  assert.deepEqual(filter({ $search: "prm_test" }).map(row => row.tbRowId), ["R3"]);
  assert.deepEqual(filter({ $search: "different meter" }).map(row => row.tbRowId), ["R3"]);
  assert.equal(filter({ workStatus: "Not Started", $search: "0099" }).length, 0);
});

test("amount filtering distinguishes no data from zero and uses rand bounds on stored cents", () => {
  assert.deepEqual(filter({ totalSalesC: { selectedRangeIds: ["ZERO"] } }).map(row => row.tbRowId), ["R1"]);
  assert.deepEqual(filter({ totalSalesC: { selectedRangeIds: ["CUSTOM"], customMinR: "400", customMaxR: "500" } }).map(row => row.tbRowId), ["R2"]);
});

test("Excel includes all matching sorted rows, not just a page, with original/found meters intact", () => {
  const sorted = sortIrepsTableRows(filter({ town: "Dundee" }), TB_ROW_COLUMNS, { key: "rowNo", direction: "desc" });
  assert.equal(paginateIrepsTableRows(sorted, 1, 1).rows.length, 1);
  const artifact = buildExcelArtifact({ rows: sorted, columns: TB_ROW_DOWNLOAD_COLUMNS, fileName: "rows.xlsx", sheetName: "TB Rows" });
  const workbook = XLSX.read(artifact.bytes, { type: "array" });
  const exported = XLSX.utils.sheet_to_json(workbook.Sheets["TB Rows"]);
  assert.deepEqual(exported.map(row => row.Row), ["10", "2", "1"]);
  assert.equal(exported[1]["Total Sales"], 450);
  assert.equal(exported[2]["Meter No"], "0001");
  const found = TB_ROW_DOWNLOAD_COLUMNS.find(column => column.header === "Found Meter No");
  assert.equal(found.value(rows[2]), "0099");
  assert.equal(irepsTableDownloadColumns([{ key: "action", export: false, value: () => "" }, ...TB_ROW_COLUMNS]).length, TB_ROW_COLUMNS.length);
});

test("KPI presentation does not change take-out eligibility or lose integrity errors", () => {
  assert.match(takeOutBlockedReason(rows[2], { rowCount: 4 }), /completed/i);
  const [broken] = buildTargetedBatchRows({ ...batch, rows: [{ ...batch.rows[0], completionStatus: "INTEGRITY_ERROR" }] });
  assert.equal(broken.completionStatus, "INTEGRITY_ERROR");
  assert.match(takeOutBlockedReason(broken, { rowCount: 4 }), /does not read properly/);
  assert.equal(buildTargetedBatchWorkSummary([broken]).notStarted, 1);
});
