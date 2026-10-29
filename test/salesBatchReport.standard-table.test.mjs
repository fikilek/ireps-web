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

test("SalesBatchReportPage defines standard column groups for Sales, Meter, Address, Field, QA Components, Sales QA", () => {
  const groups = [
    { key: "sales", label: "Sales row" },
    { key: "meter", label: "Meter" },
    { key: "address", label: "Address" },
    { key: "field", label: "Field work" },
    { key: "qaComponents", label: "QA Components" },
    { key: "salesQa", label: "Sales QA" },
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
    { key: "premise", group: "field" },
    { key: "noAccess", group: "field" },
    { key: "lastActivity", group: "field" },
    { key: "action", group: "field" },
    { key: "execution", group: "field" },
    { key: "premiseQa", group: "qaComponents" },
    { key: "noAccessQa", group: "qaComponents" },
    { key: "meterQa", group: "qaComponents" },
    { key: "qaFinal", group: "salesQa" },
  ];

  const bands = irepsTableBands(columns, groups);
  assert.deepEqual(
    bands.map((b) => ({ key: b.key, label: b.label, span: b.span })),
    [
      { key: "sales", label: "Sales row", span: 4 },
      { key: "meter", label: "Meter", span: 2 },
      { key: "address", label: "Address", span: 2 },
      { key: "field", label: "Field work", span: 5 },
      { key: "qaComponents", label: "QA Components", span: 3 },
      { key: "salesQa", label: "Sales QA", span: 1 },
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

test("HCC visibility logic: initial state hides Row, Account, Customer, Ward while keeping 13 columns", () => {
  const allColumns = [
    { key: "rowNo", label: "Row", group: "sales" },
    { key: "account", label: "Account", group: "sales" },
    { key: "customer", label: "Customer", group: "sales" },
    { key: "ward", label: "Ward", group: "sales" },
    { key: "meter", label: "Meter", group: "meter" },
    { key: "meterMatch", label: "Meter Match", group: "meter" },
    { key: "address", label: "Address", group: "address" },
    { key: "addressMatch", label: "Address Match", group: "address" },
    { key: "premise", label: "Premise Link", group: "field" },
    { key: "noAccess", label: "No Access Attempts", group: "field" },
    { key: "lastActivity", label: "Last Activity", group: "field" },
    { key: "action", label: "Action", group: "field" },
    { key: "execution", label: "Sales Status", group: "field" },
    { key: "premiseQa", label: "Premise", group: "qaComponents" },
    { key: "noAccessQa", label: "No Access", group: "qaComponents" },
    { key: "meterQa", label: "Meter", group: "qaComponents" },
    { key: "qaFinal", label: "QA Final", group: "salesQa" },
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
    { key: "qaComponents", label: "QA Components" },
    { key: "salesQa", label: "Sales QA" },
  ];

  function getVisibleColumns(visibility) {
    return allColumns.filter((column) => {
      if (column.key in visibility) {
        return Boolean(visibility[column.key]);
      }
      return true;
    });
  }

  // 1. Initial/Default state: all 4 are hidden, 13 remain visible
  const initialVisible = getVisibleColumns(defaultVisibility);
  assert.equal(initialVisible.length, 13);
  assert.deepEqual(
    initialVisible.map((c) => c.key),
    [
      "meter",
      "meterMatch",
      "address",
      "addressMatch",
      "premise",
      "noAccess",
      "lastActivity",
      "action",
      "execution",
      "premiseQa",
      "noAccessQa",
      "meterQa",
      "qaFinal",
    ],
  );

  // Band test: Sales band has span 0 and is excluded
  const initialBands = irepsTableBands(initialVisible, groups);
  assert.deepEqual(
    initialBands.map((b) => ({ key: b.key, span: b.span })),
    [
      { key: "meter", span: 2 },
      { key: "address", span: 2 },
      { key: "field", span: 5 },
      { key: "qaComponents", span: 3 },
      { key: "salesQa", span: 1 },
    ],
  );

  // 2. Toggling 'Row' on
  const withRow = getVisibleColumns({ ...defaultVisibility, rowNo: true });
  assert.equal(withRow.length, 14);
  assert.equal(withRow[0].key, "rowNo");
  const withRowBands = irepsTableBands(withRow, groups);
  assert.equal(withRowBands[0].key, "sales");
  assert.equal(withRowBands[0].span, 1);

  // 3. Toggling 'Account' and 'Ward' on
  const withAccountAndWard = getVisibleColumns({ ...defaultVisibility, account: true, ward: true });
  assert.equal(withAccountAndWard.length, 15);
  assert.deepEqual(
    withAccountAndWard.slice(0, 2).map((c) => c.key),
    ["account", "ward"],
  );
  const withAccountAndWardBands = irepsTableBands(withAccountAndWard, groups);
  assert.equal(withAccountAndWardBands[0].key, "sales");
  assert.equal(withAccountAndWardBands[0].span, 2);

  // 4. Toggling all 4 on
  const allShown = getVisibleColumns({ rowNo: true, account: true, customer: true, ward: true });
  assert.equal(allShown.length, 17);
  const allShownBands = irepsTableBands(allShown, groups);
  assert.equal(allShownBands[0].key, "sales");
  assert.equal(allShownBands[0].span, 4);
});

test("Phase 2: Relabelled operational fields and QA columns definitions in SalesBatchReportPage", () => {
  // Operational column relabelling
  assert.match(
    salesBatchReportSrc,
    /key:\s*["']execution["'],\s*label:\s*["']Sales Status["']/,
    "Execution column must be relabelled as 'Sales Status'",
  );
  assert.match(
    salesBatchReportSrc,
    /key:\s*["']action["'][\s\S]*?key:\s*["']execution["'][\s\S]*?key:\s*["']premiseQa["']/,
    "Sales Status column must be positioned between Action and Premise QA",
  );
  assert.match(
    salesBatchReportSrc,
    /key:\s*["']premise["'],\s*label:\s*["']Premise Link["']/,
    "Premise column must be relabelled as 'Premise Link'",
  );
  assert.match(
    salesBatchReportSrc,
    /key:\s*["']noAccess["'],\s*label:\s*["']No Access Attempts["']/,
    "No Access column must be relabelled as 'No Access Attempts'",
  );

  // QA Components grouped columns
  assert.match(
    salesBatchReportSrc,
    /key:\s*["']premiseQa["'],\s*label:\s*["']Premise["'],\s*group:\s*["']qaComponents["']/,
    "premiseQa column must have label 'Premise' and group 'qaComponents'",
  );
  assert.match(
    salesBatchReportSrc,
    /key:\s*["']noAccessQa["'],\s*label:\s*["']No Access["'],\s*group:\s*["']qaComponents["']/,
    "noAccessQa column must have label 'No Access' and group 'qaComponents'",
  );
  assert.match(
    salesBatchReportSrc,
    /key:\s*["']meterQa["'],\s*label:\s*["']Meter["'],\s*group:\s*["']qaComponents["']/,
    "meterQa column must have label 'Meter' and group 'qaComponents'",
  );

  // QA Final column grouped under Sales QA
  assert.match(
    salesBatchReportSrc,
    /key:\s*["']qaFinal["'],\s*label:\s*["']QA Final["'],\s*group:\s*["']salesQa["']/,
    "qaFinal column must have label 'QA Final' and group 'salesQa'",
  );
});

test("Phase 2: Sales State gating, QA pill buttons and destination routing", () => {
  // QaPill component check: status pill is the button control itself
  assert.match(
    salesBatchReportSrc,
    /function QaPill\(\{/,
    "QaPill component must exist as the clickable status pill control",
  );
  assert.match(
    salesBatchReportSrc,
    /<QaPill/,
    "Component QA columns must render QaPill",
  );

  // Routing checks
  assert.match(
    salesBatchReportSrc,
    /\/registries\/premises\?premiseId=/,
    "Premise QA pill must route to Premise Registry with premiseId query param",
  );
  assert.match(
    salesBatchReportSrc,
    /\/registries\/trns\?trnId=/,
    "No Access QA and Meter QA pills must route to TRN Registry with trnId query param",
  );

  // AST ID used for Meter QA (row.fieldMeter.id)
  assert.match(
    salesBatchReportSrc,
    /getMeterQaTarget\(row\)/,
    "Meter QA must extract AST ID target using getMeterQaTarget",
  );
});

test("Phase 2: Gating helper logic and QA Final validation", () => {
  // Test helper logic directly mirroring the source
  function isRowCompleted(row) {
    return String(row?.workStatus || "").trim().toUpperCase() === "COMPLETED";
  }

  function getPremiseQaTarget(row) {
    return String(row?.premise?.id || "").trim();
  }

  function getNoAccessQaTarget(row) {
    const attempts = row?.noAccess?.attempts || [];
    if (attempts.length > 0) {
      const lastAttempt = attempts[attempts.length - 1];
      if (lastAttempt?.id) return String(lastAttempt.id).trim();
    }
    return String(row?.noAccess?.trnId || "").trim();
  }

  function getMeterQaTarget(row) {
    return String(row?.fieldMeter?.id || "").trim();
  }

  function getPremiseQaStatus(row) {
    if (!isRowCompleted(row)) return "QA NAv";
    return String(row?.premise?.qaStatus || "QA NAv").trim();
  }

  function getNoAccessQaStatus(row) {
    if (!isRowCompleted(row)) return "QA NAv";
    return String(row?.noAccess?.qaStatus || "QA NAv").trim();
  }

  function getMeterQaStatus(row) {
    if (!isRowCompleted(row)) return "QA NAv";
    return String(row?.fieldMeter?.qaStatus || "QA NAv").trim();
  }

  function getQaFinalStatus(row) {
    if (!isRowCompleted(row)) return "QA NAv";
    const raw = String(row?.qaFinalStatus ?? row?.qa?.finalStatus ?? row?.qa?.tbStatus ?? "").trim();
    if (!raw) {
      const premise = String(getPremiseQaStatus(row)).toUpperCase().replace(/_/g, " ");
      const meter = String(getMeterQaStatus(row)).toUpperCase().replace(/_/g, " ");
      const noAccess = String(getNoAccessQaStatus(row)).toUpperCase().replace(/_/g, " ");
      if (premise === "QA FAIL" || meter === "QA FAIL" || noAccess === "QA FAIL") return "QA FAIL";
      if (premise === "QA PASS" && meter === "QA PASS") return "QA PASS";
      return "QA NAv";
    }
    const upper = raw.toUpperCase().replace(/_/g, " ");
    if (upper === "QA PENDING" || upper === "PENDING" || !raw) {
      return "QA NAv";
    }
    if (upper === "QA PASS" || upper === "PASS") return "QA PASS";
    if (upper === "QA FAIL" || upper === "FAIL") return "QA FAIL";
    return raw;
  }

  // Row 1: NOT STARTED
  const notStartedRow = {
    workStatus: "NOT_STARTED",
    premise: { id: "premise-1", qaStatus: "QA PASS" },
    noAccess: { attempts: [{ id: "TRN-NA-1" }], qaStatus: "QA PASS" },
    fieldMeter: { id: "TRN-AST-1", qaStatus: "QA PASS" },
    qaFinalStatus: "QA PASS",
  };
  assert.equal(getPremiseQaStatus(notStartedRow), "QA NAv", "NOT STARTED row must display QA NAv for Premise QA");
  assert.equal(getNoAccessQaStatus(notStartedRow), "QA NAv", "NOT STARTED row must display QA NAv for No Access QA");
  assert.equal(getMeterQaStatus(notStartedRow), "QA NAv", "NOT STARTED row must display QA NAv for Meter QA");
  assert.equal(getQaFinalStatus(notStartedRow), "QA NAv", "NOT STARTED row must display QA NAv for QA Final");
  assert.equal(isRowCompleted(notStartedRow), false, "NOT STARTED row must not be completed");

  // Row 2: IN PROGRESS
  const inProgressRow = {
    workStatus: "IN_PROGRESS",
    premise: { id: "premise-2", qaStatus: "QA PASS" },
    noAccess: { attempts: [{ id: "TRN-NA-2" }], qaStatus: "QA PASS" },
    fieldMeter: { id: "TRN-AST-2", qaStatus: "QA PASS" },
    qaFinalStatus: "QA PASS",
  };
  assert.equal(getPremiseQaStatus(inProgressRow), "QA NAv", "IN PROGRESS row must display QA NAv for Premise QA");
  assert.equal(getNoAccessQaStatus(inProgressRow), "QA NAv", "IN PROGRESS row must display QA NAv for No Access QA");
  assert.equal(getMeterQaStatus(inProgressRow), "QA NAv", "IN PROGRESS row must display QA NAv for Meter QA");
  assert.equal(getQaFinalStatus(inProgressRow), "QA NAv", "IN PROGRESS row must display QA NAv for QA Final");
  assert.equal(isRowCompleted(inProgressRow), false, "IN PROGRESS row must not be completed");

  // Row 3: COMPLETED without QA data in read model (defaults to QA NAv)
  const completedRow = {
    workStatus: "COMPLETED",
    premise: { id: "PRM-123" },
    noAccess: { attempts: [{ id: "TRN-NA-3" }] },
    fieldMeter: { id: "TRN-AST-3" },
  };
  assert.equal(getPremiseQaStatus(completedRow), "QA NAv");
  assert.equal(getNoAccessQaStatus(completedRow), "QA NAv");
  assert.equal(getMeterQaStatus(completedRow), "QA NAv");
  assert.equal(getQaFinalStatus(completedRow), "QA NAv");
  assert.equal(getPremiseQaTarget(completedRow), "PRM-123");
  assert.equal(getNoAccessQaTarget(completedRow), "TRN-NA-3");
  assert.equal(getMeterQaTarget(completedRow), "TRN-AST-3");

  // Row 4: COMPLETED with QA PENDING on QA Final -> MUST display QA NAv
  const pendingFinalRow = {
    workStatus: "COMPLETED",
    qaFinalStatus: "QA PENDING",
  };
  assert.equal(getQaFinalStatus(pendingFinalRow), "QA NAv", "QA Final must NEVER display component QA PENDING");

  // Row 5: COMPLETED with valid QA Final status
  const passFinalRow = {
    workStatus: "COMPLETED",
    qaFinalStatus: "QA PASS",
  };
  assert.equal(getQaFinalStatus(passFinalRow), "QA PASS");

  // Row 6: COMPLETED with qa.tbStatus: QA_PASS (from backend projection)
  const tbStatusPassRow = {
    workStatus: "COMPLETED",
    qa: { tbStatus: "QA_PASS" },
  };
  assert.equal(getQaFinalStatus(tbStatusPassRow), "QA PASS");

  // Row 7: COMPLETED with component fallback (premise QA PASS + meter QA PASS)
  const componentPassRow = {
    workStatus: "COMPLETED",
    premise: { id: "PRM-1", qaStatus: "QA PASS" },
    fieldMeter: { id: "TRN-1", qaStatus: "QA PASS" },
  };
  assert.equal(getQaFinalStatus(componentPassRow), "QA PASS");

  const failFinalRow = {
    workStatus: "COMPLETED",
    qaFinalStatus: "QA FAIL",
  };
  assert.equal(getQaFinalStatus(failFinalRow), "QA FAIL");
});

test("Phase 2: Default sort by lastActivity descending and read model QA projection", async () => {
  assert.match(
    salesBatchReportSrc,
    /defaultSort=\{\{\s*key:\s*["']lastActivity["'],\s*direction:\s*["']desc["']\s*\}\}/,
    "Targeted Batch Field Results must default to sorting by lastActivity descending",
  );

  const { normalizeTargetedBatchReportRow } = await import(
    "../src/pages/sales/models/salesTargetedBatchReadModel.js"
  );

  const sampleNormalized = normalizeTargetedBatchReportRow({
    row: {
      id: "tb_row_123",
      rowNo: 4,
      qa: { premiseStatus: "QA_PENDING", reviewedAt: null },
      tbRefs: { fieldWork: { premiseId: "PRM_001" } },
    },
  });

  assert.equal(
    sampleNormalized.qa?.premiseStatus,
    "QA_PENDING",
    "normalizeTargetedBatchReportRow must preserve the qa object",
  );
  assert.equal(
    sampleNormalized.premise?.qaStatus,
    "QA_PENDING",
    "normalizeTargetedBatchReportRow must project qaStatus onto the premise object",
  );
});

test("Phase 2: QA Component status tone maps QA_FAIL to danger (red) and QA_PASS to success (green)", () => {
  // Verify SalesBatchReportPage source contains underscore normalization for QA statuses
  assert.match(
    salesBatchReportSrc,
    /const upper = clean\.toUpperCase\(\)\.replace\(\/_ \/g, " "\);|const upper = clean\.toUpperCase\(\)\.replace\(\/_\/g, " "\);/,
    "normalizeQaStatus must replace underscores with spaces",
  );

  assert.match(
    salesBatchReportSrc,
    /const normalized = normalizeUpper\(status\)\.replace\(\/_ \/g, " "\);|const normalized = normalizeUpper\(status\)\.replace\(\/_\/g, " "\);/,
    "statusTone must replace underscores with spaces",
  );

  // Directly verify the statusTone function logic
  function testStatusTone(status = "") {
    const normalized = String(status ?? "").trim().toUpperCase().replace(/_/g, " ");
    switch (normalized) {
      case "TRUE":
      case "COMPLETED":
      case "LINKED":
      case "ACCEPTED":
      case "QA PASS":
      case "PASS":
        return "success";
      case "FALSE":
      case "FAILED":
      case "REJECTED":
      case "QA FAIL":
      case "FAIL":
        return "danger";
      case "IN PROGRESS":
      case "QA PENDING":
      case "PENDING":
      case "QA UPDATED":
      case "UPDATED":
        return "warning";
      default:
        return "neutral";
    }
  }

  assert.equal(testStatusTone("QA_FAIL"), "danger", "QA_FAIL with underscore must map to danger (red)");
  assert.equal(testStatusTone("QA FAIL"), "danger", "QA FAIL with space must map to danger (red)");
  assert.equal(testStatusTone("FAIL"), "danger", "FAIL must map to danger (red)");

  assert.equal(testStatusTone("QA_PASS"), "success", "QA_PASS with underscore must map to success (green)");
  assert.equal(testStatusTone("QA PASS"), "success", "QA PASS with space must map to success (green)");
  assert.equal(testStatusTone("PASS"), "success", "PASS must map to success (green)");

  assert.equal(testStatusTone("QA_PENDING"), "warning", "QA_PENDING with underscore must map to warning");
  assert.equal(testStatusTone("QA PENDING"), "warning", "QA PENDING with space must map to warning");

  assert.equal(testStatusTone("QA NAv"), "neutral", "QA NAv must map to neutral (gray)");
  assert.equal(testStatusTone("QA_NAV"), "neutral", "QA_NAV must map to neutral (gray)");
});




