// Targeted Batch rules TB-R054 (1.3.45): Sales Reporting and Open Report wiring. The counting
// itself is tested in models/salesReportingCountsModel.test.mjs and the stream in
// redux/salesTargetedBatchRowCounts.contract.test.mjs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reporting = await readFile(new URL("./SalesReportingPage.jsx", import.meta.url), "utf8");
const report = await readFile(new URL("./SalesBatchReportPage.jsx", import.meta.url), "utf8");

test("Sales Reporting counts the batch rows, never the running totals on the batch", () => {
  assert.match(reporting, /useGetTargetedBatchRowCountsByLmQuery\(activeLmPcode \|\| skipToken\)/);
  assert.match(reporting, /withRowCounts\(/);
  assert.match(reporting, /batchesStatus: streamStatus/);
  assert.doesNotMatch(reporting, /counts\?\.(totalRows|executionStartedRows|completedRows)/);
});

test("the cards follow the table filters and read Sales Rows = Not Started + In Progress + Completed", () => {
  assert.match(reporting, /summarizeReportingCards\(filteredBatches, \{\s+countsState,\s+listPending,\s+batchesReady:/);
  const cards = reporting.slice(reporting.indexOf('label="Targeted Batches"'), reporting.indexOf('countsState === "error" ? ('));
  const order = ['label="Targeted Batches"', 'label="Sales Rows"', 'sign="="', 'label="Not Started"', 'sign="+"', 'label="In Progress"', 'sign="+"', 'label="Completed"'];
  let from = 0;
  for (const part of order) {
    const at = cards.indexOf(part, from);
    assert.ok(at >= from, `${part} out of order`);
    from = at + part.length;
  }
  assert.doesNotMatch(reporting, /Across all visible batches/);
});

test("no old number while counting, and count filters wait for the counts", () => {
  assert.match(reporting, /countsState === "error" \? "Not available" : "Counting…"/);
  assert.match(reporting, /<td>\{countText\(progress\?\.notStarted\)\}<\/td>/);
  assert.match(reporting, /const listPending = countsState !== "ready" && hasCountFilter\(filters\)/);
  assert.equal(reporting.match(/!listPending && totalRows > 0/g)?.length, 2);
  assert.match(reporting, /!listPending &&\s+paginatedBatches\.map/);
});

test("Open Report shows and filters each row by its one status, after the Sales meters are read", () => {
  assert.match(report, /<Badge value=\{statusPending \? "Counting…" : row\.workStatus\} \/>/);
  assert.match(report, /\(statusPending \|\| row\.workStatus !== executionFilter\)/);
  assert.match(report, /value=\{statusPending \? "Counting…" : row\.workStatus\}\s+\/>/);
  assert.match(report, /const statusPending = !TERMINAL_STREAM_STATES\.has\(sourceStatuses\.sales\)/);
  assert.doesNotMatch(report, /value=\{row\.execution\.status\}/);
});
