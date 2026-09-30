import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  IREPS_TABLE_DEFAULT_PAGE_SIZE,
  IREPS_TABLE_PAGE_SIZES,
  filterIrepsTableRows,
  irepsTableBands,
  irepsTableDateRange,
  irepsTableFilterActive,
  irepsTableSelectOptions,
  paginateIrepsTableRows,
  sortIrepsTableRows,
} from "./irepsTableModel.js";

// One table for the whole of iREPS (owner, 2026-09-23): same bands, headings,
// filters, pagination and colours, whatever the page.
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const COLUMNS = [
  { key: "no", label: "No", group: "who", filter: "text", value: (row) => row.no, sortValue: (row) => row.no },
  { key: "name", label: "Name", group: "who", filter: "text", value: (row) => row.name },
  { key: "ward", label: "Ward", group: "where", filter: "select", value: (row) => row.ward },
  { key: "at", label: "Last activity", group: "where", filter: "date", value: (row) => row.at },
  { key: "action", label: "Action", group: "where", filter: null, value: () => "" },
];

const GROUPS = [
  { key: "who", label: "Who" },
  { key: "where", label: "Where" },
];

const rows = [
  { no: 1, name: "Khanyile", ward: "006", at: Date.parse("2026-09-23T08:00:00Z") },
  { no: 2, name: "Makhathini", ward: "004", at: Date.parse("2026-09-01T08:00:00Z") },
  { no: 10, name: "Zulu", ward: "006", at: 0 },
];

test("the bands span their own columns, in the order given", () => {
  assert.deepEqual(
    irepsTableBands(COLUMNS, GROUPS).map((band) => [band.label, band.span]),
    [["Who", 2], ["Where", 3]],
  );
  assert.deepEqual(irepsTableBands(COLUMNS, []), []);
});

test("a typed box matches part of a value, a dropdown the whole of it", () => {
  assert.deepEqual(filterIrepsTableRows(rows, COLUMNS, { filters: { name: "zul" } }).map((r) => r.no), [10]);
  assert.deepEqual(filterIrepsTableRows(rows, COLUMNS, { filters: { ward: "006" } }).map((r) => r.no), [1, 10]);
  assert.deepEqual(filterIrepsTableRows(rows, COLUMNS, { filters: { ward: "00" } }), []);
  assert.equal(filterIrepsTableRows(rows, COLUMNS, { filters: {} }).length, 3);
});

test("the date window matches the registries, and a row with no date is out", () => {
  const now = new Date("2026-09-23T12:00:00Z");
  assert.deepEqual(
    filterIrepsTableRows(rows, COLUMNS, { filters: { at: { mode: "TODAY" } }, now }).map((r) => r.no),
    [1],
  );
  assert.deepEqual(
    filterIrepsTableRows(rows, COLUMNS, { filters: { at: { mode: "THIS_MONTH" } }, now }).map((r) => r.no),
    [1, 2],
  );

  const { start, end } = irepsTableDateRange({ mode: "CUSTOM", startDate: "2026-09-01", endDate: "2026-09-02" });
  assert.equal(start.getDate(), 1);
  assert.equal(end.getHours(), 23);

  assert.equal(irepsTableFilterActive(COLUMNS[3], { mode: "ALL" }), false);
  assert.equal(irepsTableFilterActive(COLUMNS[4], "anything"), false, "a column with no filter never filters");
});

test("every column with a filter sorts, numbers as numbers", () => {
  assert.deepEqual(sortIrepsTableRows(rows, COLUMNS, { key: "no", direction: "asc" }).map((r) => r.no), [1, 2, 10]);
  assert.deepEqual(sortIrepsTableRows(rows, COLUMNS, { key: "no", direction: "desc" }).map((r) => r.no), [10, 2, 1]);
  assert.deepEqual(sortIrepsTableRows(rows, COLUMNS, { key: "name", direction: "asc" }).map((r) => r.no), [1, 2, 10]);
  assert.deepEqual(sortIrepsTableRows(rows, COLUMNS, {}).map((r) => r.no), [1, 2, 10]);
});

test("a dropdown lists only what the table holds", () => {
  assert.deepEqual(irepsTableSelectOptions(rows, COLUMNS[2]), ["004", "006"]);
  assert.deepEqual(irepsTableSelectOptions(rows, COLUMNS[0]), [], "a typed box has no list");
});

test("five rows a page by default, and a page past the end comes back", () => {
  const many = Array.from({ length: 12 }, (_, index) => ({ no: index + 1, name: "x", ward: "006", at: 0 }));
  assert.equal(IREPS_TABLE_DEFAULT_PAGE_SIZE, 5);
  assert.deepEqual(IREPS_TABLE_PAGE_SIZES, [5, 10, 25, 50, 100]);

  const first = paginateIrepsTableRows(many, 1, 5);
  assert.equal(first.rows.length, 5);
  assert.equal(first.totalPages, 3);
  assert.equal(paginateIrepsTableRows(many, 99, 5).page, 3);
});

test("the table writes its colours in one place, and the pages do not write their own", async () => {
  const component = await read("./IrepsTable.jsx");
  const tokens = await read("./irepsTableTokens.js");

  assert.match(component, /irepsTableTokens/, "the component reads the tokens");
  assert.match(component, /DatetimeFilterModal/, "a date column opens the standard window");
  assert.match(tokens, /headBackground/);

  // No colour is written into the component itself.
  const colours = component.match(/#[0-9a-fA-F]{3,6}/g) || [];
  assert.deepEqual(colours, [], `the component should take every colour from the tokens: ${colours.join(", ")}`);
});

test("TB Rows is built on the shared table", async () => {
  const page = await read("../../pages/operations/targeted-batches/rows/TargetedBatchRowsTable.jsx");
  assert.match(page, /IrepsTable/, "the page uses the one table");
  assert.equal(page.includes("styles.filters"), false, "the old control strip is gone");
});
