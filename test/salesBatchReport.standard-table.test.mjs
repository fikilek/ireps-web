import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  filterIrepsTableRows,
  sortIrepsTableRows,
  paginateIrepsTableRows,
  irepsTableBands,
  irepsTableSelectOptions,
} from "../src/components/table/irepsTableModel.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const salesBatchReportSrc = readFileSync(
  join(here, "..", "src/pages/sales/SalesBatchReportPage.jsx"),
  "utf8",
);

test("SalesBatchReportPage imports and renders the shared IrepsTable component", () => {
  assert.match(
    salesBatchReportSrc,
    /import IrepsTable from ["']\.\.\/\.\.\/components\/table\/IrepsTable["'];/,
    "IrepsTable must be imported from the shared components directory",
  );
  assert.match(
    salesBatchReportSrc,
    /<IrepsTable\s+title="Targeted Batch Field Results"/,
    "Targeted Batch Field Results must render IrepsTable with the standard title",
  );
  assert.match(
    salesBatchReportSrc,
    /stickyHeader/,
    "IrepsTable must enable stickyHeader",
  );
  assert.match(
    salesBatchReportSrc,
    /topScrollbar/,
    "IrepsTable must enable topScrollbar for wide table navigation",
  );
});

test("SalesBatchReportPage defines standard column groups for Sales, Meter, Address, Field", () => {
  const groups = [
    { key: "sales", label: "Sales row" },
    { key: "meter", label: "Meter" },
    { key: "address", label: "Address" },
    { key: "field", label: "Field work" },
  ];

  const columns = [
    { key: "rowNo", group: "sales" },
    { key: "account", group: "sales" },
    { key: "customer", group: "sales" },
    { key: "ward", group: "sales" },
    { key: "meter", group: "meter" },
    { key: "meterMatch", group: "meter" },
    { key: "address", group: "address" },
    { key: "addressMatch", group: "address" },
    { key: "execution", group: "field" },
    { key: "premise", group: "field" },
    { key: "noAccess", group: "field" },
    { key: "lastActivity", group: "field" },
    { key: "action", group: "field" },
  ];

  const bands = irepsTableBands(columns, groups);
  assert.deepEqual(
    bands.map((b) => ({ key: b.key, label: b.label, span: b.span })),
    [
      { key: "sales", label: "Sales row", span: 4 },
      { key: "meter", label: "Meter", span: 2 },
      { key: "address", label: "Address", span: 2 },
      { key: "field", label: "Field work", span: 5 },
    ],
  );
});

test("Targeted Batch Field Results filtering and sorting via IrepsTable model", () => {
  const sampleRows = [
    {
      id: "tb-row-1",
      rowNo: 1,
      source: { accountNumber: "ACC001", customerName: "Alice Smith", sgCode: "SG01", categoryReason: "Zero purchases" },
      scope: { wardLabel: "Ward 12" },
      originalMeter: { number: "MTR-100" },
      fieldMeter: { number: "MTR-100", id: "meter-doc-1", canOpenMap: true },
      comparison: { meterMatch: "TRUE", addressMatch: "TRUE" },
      addresses: { original: "10 Main St", field: "10 Main St" },
      workStatus: "COMPLETED",
      premise: { status: "LINKED", id: "premise-1" },
      noAccess: { count: 0, attempts: [] },
      execution: { lastActivityAtMs: 1729000000000 },
    },
    {
      id: "tb-row-2",
      rowNo: 2,
      source: { accountNumber: "ACC002", customerName: "Bob Jones", sgCode: "SG02", categoryReason: "Low consumption" },
      scope: { wardLabel: "Ward 15" },
      originalMeter: { number: "MTR-200" },
      fieldMeter: { number: "MTR-999", id: "meter-doc-2", canOpenMap: true },
      comparison: { meterMatch: "FALSE", addressMatch: "TRUE" },
      addresses: { original: "20 Oak Ave", field: "20 Oak Ave" },
      workStatus: "IN_PROGRESS",
      premise: { status: "PENDING", id: null },
      noAccess: { count: 2, attempts: [{ id: "att-1" }, { id: "att-2" }] },
      execution: { lastActivityAtMs: 1729100000000 },
    },
    {
      id: "tb-row-3",
      rowNo: 3,
      source: { accountNumber: "ACC003", customerName: "Charlie Brown", sgCode: "SG03", categoryReason: "Tamper flag" },
      scope: { wardLabel: "Ward 12" },
      originalMeter: { number: "MTR-300" },
      fieldMeter: { number: null, id: null, canOpenMap: false },
      comparison: { meterMatch: "PENDING", addressMatch: "PENDING" },
      addresses: { original: "30 Pine Rd", field: null },
      workStatus: "NOT_STARTED",
      premise: { status: "UNLINKED", id: null },
      noAccess: { count: 0, attempts: [] },
      execution: { lastActivityAtMs: 0 },
    },
  ];

  const columns = [
    {
      key: "rowNo",
      label: "Row",
      filter: "text",
      sortable: true,
      value: (row) => row.rowNo || "NAv",
      sortValue: (row) => Number(row.rowNo) || 0,
    },
    {
      key: "account",
      label: "Account",
      filter: "text",
      sortable: true,
      value: (row) => row.source?.accountNumber || "",
      sortValue: (row) => String(row.source?.accountNumber || ""),
    },
    {
      key: "customer",
      label: "Customer",
      filter: "text",
      sortable: true,
      value: (row) => row.source?.customerName || "",
      sortValue: (row) => String(row.source?.customerName || ""),
    },
    {
      key: "ward",
      label: "Ward",
      filter: "select",
      sortable: true,
      value: (row) => row.scope?.wardLabel || "",
    },
    {
      key: "meter",
      label: "Meter",
      filter: "text",
      sortable: true,
      value: (row) => [row.originalMeter?.number, row.fieldMeter?.number || "PENDING"].filter(Boolean).join(" "),
      sortValue: (row) => String(row.originalMeter?.number || ""),
    },
    {
      key: "meterMatch",
      label: "Meter Match",
      filter: "select",
      filterOptions: [
        { value: "TRUE", label: "TRUE" },
        { value: "FALSE", label: "FALSE" },
        { value: "PENDING", label: "PENDING" },
      ],
      sortable: true,
      value: (row) => row.comparison?.meterMatch || "",
    },
    {
      key: "address",
      label: "Address",
      filter: "text",
      sortable: true,
      value: (row) => [row.addresses?.original, row.addresses?.field || "PENDING"].filter(Boolean).join(" "),
      sortValue: (row) => String(row.addresses?.original || ""),
    },
    {
      key: "addressMatch",
      label: "Address Match",
      filter: "select",
      filterOptions: [
        { value: "TRUE", label: "TRUE" },
        { value: "FALSE", label: "FALSE" },
        { value: "PENDING", label: "PENDING" },
      ],
      sortable: true,
      value: (row) => row.comparison?.addressMatch || "",
    },
    {
      key: "execution",
      label: "Execution",
      filter: "select",
      sortable: true,
      value: (row) => row.workStatus,
    },
    {
      key: "premise",
      label: "Premise",
      filter: "select",
      sortable: true,
      value: (row) => row.premise?.status || "",
    },
    {
      key: "noAccess",
      label: "No Access",
      filter: "select",
      filterOptions: [
        { value: "HAS_NA", label: "Has No Access" },
        { value: "NO_NA", label: "No No Access" },
      ],
      filterValues: (row) => (Number(row.noAccess?.count) > 0 ? ["HAS_NA"] : ["NO_NA"]),
      sortable: true,
      value: (row) => String(row.noAccess?.count ?? 0),
      sortValue: (row) => Number(row.noAccess?.count) || 0,
    },
    {
      key: "lastActivity",
      label: "Last Activity",
      filter: "date",
      sortable: true,
      value: (row) => row.execution?.lastActivityAtMs || null,
      sortValue: (row) => Number(row.execution?.lastActivityAtMs) || 0,
    },
    {
      key: "action",
      label: "Action",
      filter: null,
      sortable: false,
      export: false,
      value: () => "",
    },
  ];

  // 1. Filter by text (Account)
  const accFiltered = filterIrepsTableRows(sampleRows, columns, { filters: { account: "002" } });
  assert.equal(accFiltered.length, 1);
  assert.equal(accFiltered[0].id, "tb-row-2");

  // 2. Filter by meter (searches both original and field meter)
  const mtrOriginal = filterIrepsTableRows(sampleRows, columns, { filters: { meter: "MTR-100" } });
  assert.equal(mtrOriginal.length, 1);
  assert.equal(mtrOriginal[0].id, "tb-row-1");

  const mtrField = filterIrepsTableRows(sampleRows, columns, { filters: { meter: "MTR-999" } });
  assert.equal(mtrField.length, 1);
  assert.equal(mtrField[0].id, "tb-row-2");

  // 3. Filter by select (Ward)
  const wardFiltered = filterIrepsTableRows(sampleRows, columns, { filters: { ward: "Ward 12" } });
  assert.equal(wardFiltered.length, 2);

  // 4. Filter by No Access select (HAS_NA vs NO_NA)
  const naHas = filterIrepsTableRows(sampleRows, columns, { filters: { noAccess: "HAS_NA" } });
  assert.equal(naHas.length, 1);
  assert.equal(naHas[0].id, "tb-row-2");

  const naNo = filterIrepsTableRows(sampleRows, columns, { filters: { noAccess: "NO_NA" } });
  assert.equal(naNo.length, 2);

  // 5. Global search value
  function searchVal(row) {
    return [
      row.rowNo,
      row.source?.accountNumber,
      row.source?.customerName,
      row.scope?.wardLabel,
      row.originalMeter?.number,
      row.fieldMeter?.number || "PENDING",
      row.addresses?.original,
      row.addresses?.field || "PENDING",
      row.source?.sgCode,
      row.source?.categoryReason,
    ].filter(Boolean).join(" ");
  }

  const searchFiltered = filterIrepsTableRows(sampleRows, columns, {
    filters: { $search: "Tamper" },
    searchValue: searchVal,
  });
  assert.equal(searchFiltered.length, 1);
  assert.equal(searchFiltered[0].id, "tb-row-3");

  // 6. Sorting
  const sortedDesc = sortIrepsTableRows(sampleRows, columns, { key: "rowNo", direction: "desc" });
  assert.deepEqual(sortedDesc.map((r) => r.rowNo), [3, 2, 1]);

  const sortedNa = sortIrepsTableRows(sampleRows, columns, { key: "noAccess", direction: "desc" });
  assert.equal(sortedNa[0].id, "tb-row-2");

  // 7. Pagination
  const page1 = paginateIrepsTableRows(sampleRows, 1, 2);
  assert.equal(page1.rows.length, 2);
  assert.equal(page1.totalPages, 2);
  assert.equal(sampleRows.length, 3);
});

test("SalesBatchReportPage defines HCC with exactly four columns hidden by default", () => {
  assert.match(
    salesBatchReportSrc,
    /const HCC_COLUMN_OPTIONS = \[\s*\{\s*key:\s*["']rowNo["'],\s*label:\s*["']Row["']\s*\},\s*\{\s*key:\s*["']account["'],\s*label:\s*["']Account["']\s*\},\s*\{\s*key:\s*["']customer["'],\s*label:\s*["']Customer["']\s*\},\s*\{\s*key:\s*["']ward["'],\s*label:\s*["']Ward["']\s*\},?\s*\];/,
    "HCC must configure exactly Row, Account, Customer, and Ward",
  );

  assert.match(
    salesBatchReportSrc,
    /const DEFAULT_COLUMN_VISIBILITY = \{\s*rowNo:\s*false,\s*account:\s*false,\s*customer:\s*false,\s*ward:\s*false,?\s*\};/,
    "All four configurable columns must be hidden by default (initially false)",
  );

  assert.match(
    salesBatchReportSrc,
    /showColumnControls\s*\?\s*["']Hide Column Controls["']\s*:\s*["']Show Column Controls["']/,
    "Toolbar button must display Show Column Controls when closed and Hide Column Controls when open",
  );

  assert.match(
    salesBatchReportSrc,
    /columnControls=\{columnControlsPanel\}/,
    "IrepsTable must receive columnControlsPanel",
  );

  assert.match(
    salesBatchReportSrc,
    /columns=\{visibleColumns\}/,
    "IrepsTable must receive visibleColumns based on columnVisibility",
  );
});

test("HCC visibility logic: initial state hides Row, Account, Customer, Ward while keeping 9 columns", () => {
  const allColumns = [
    { key: "rowNo", label: "Row", group: "sales" },
    { key: "account", label: "Account", group: "sales" },
    { key: "customer", label: "Customer", group: "sales" },
    { key: "ward", label: "Ward", group: "sales" },
    { key: "meter", label: "Meter", group: "meter" },
    { key: "meterMatch", label: "Meter Match", group: "meter" },
    { key: "address", label: "Address", group: "address" },
    { key: "addressMatch", label: "Address Match", group: "address" },
    { key: "execution", label: "Execution", group: "field" },
    { key: "premise", label: "Premise", group: "field" },
    { key: "noAccess", label: "No Access", group: "field" },
    { key: "lastActivity", label: "Last Activity", group: "field" },
    { key: "action", label: "Action", group: "field" },
  ];

  const defaultVisibility = {
    rowNo: false,
    account: false,
    customer: false,
    ward: false,
  };

  const groups = [
    { key: "sales", label: "Sales row" },
    { key: "meter", label: "Meter" },
    { key: "address", label: "Address" },
    { key: "field", label: "Field work" },
  ];

  function getVisibleColumns(visibility) {
    return allColumns.filter((column) => {
      if (column.key in visibility) {
        return Boolean(visibility[column.key]);
      }
      return true;
    });
  }

  // 1. Initial/Default state: all 4 are hidden, 9 remain visible
  const initialVisible = getVisibleColumns(defaultVisibility);
  assert.equal(initialVisible.length, 9);
  assert.deepEqual(
    initialVisible.map((c) => c.key),
    ["meter", "meterMatch", "address", "addressMatch", "execution", "premise", "noAccess", "lastActivity", "action"],
  );

  // Band test: Sales band has span 0 and is excluded
  const initialBands = irepsTableBands(initialVisible, groups);
  assert.deepEqual(
    initialBands.map((b) => ({ key: b.key, span: b.span })),
    [
      { key: "meter", span: 2 },
      { key: "address", span: 2 },
      { key: "field", span: 5 },
    ],
  );

  // 2. Toggling 'Row' on
  const withRow = getVisibleColumns({ ...defaultVisibility, rowNo: true });
  assert.equal(withRow.length, 10);
  assert.equal(withRow[0].key, "rowNo");
  const withRowBands = irepsTableBands(withRow, groups);
  assert.equal(withRowBands[0].key, "sales");
  assert.equal(withRowBands[0].span, 1);

  // 3. Toggling 'Account' and 'Ward' on
  const withAccountAndWard = getVisibleColumns({ ...defaultVisibility, account: true, ward: true });
  assert.equal(withAccountAndWard.length, 11);
  assert.deepEqual(
    withAccountAndWard.slice(0, 2).map((c) => c.key),
    ["account", "ward"],
  );
  const withAccountAndWardBands = irepsTableBands(withAccountAndWard, groups);
  assert.equal(withAccountAndWardBands[0].key, "sales");
  assert.equal(withAccountAndWardBands[0].span, 2);

  // 4. Toggling all 4 on
  const allShown = getVisibleColumns({ rowNo: true, account: true, customer: true, ward: true });
  assert.equal(allShown.length, 13);
  const allShownBands = irepsTableBands(allShown, groups);
  assert.equal(allShownBands[0].key, "sales");
  assert.equal(allShownBands[0].span, 4);
});
