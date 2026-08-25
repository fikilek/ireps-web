import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

import {
  buildGeneralMonthlyManagedReport,
  createGeneralMonthlyReportManagedGenerator,
} from "../src/pages/reports/generalMonthlyReportArtifact.js";
import {
  buildGmrExcelArtifact,
  getGmrMasterColumnDefinitions,
} from "../src/utils/reportPlatform/buildGmrExcelArtifact.js";

const MONTH_KEYS = [
  "2023-12", "2024-01", "2024-02", "2024-03", "2024-04", "2024-05",
  "2024-06", "2024-07", "2024-08", "2024-09", "2024-10", "2024-11",
  "2024-12", "2025-01", "2025-02", "2025-03", "2025-04", "2025-05",
  "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11",
  "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05",
  "2026-06", "2026-07", "2026-08",
];

function makeRow(index) {
  const invisible = index < 2;
  const categories = [
    "Normal - No Leakage Flag",
    "CAT1 - Zero Purchaser",
    "CAT5 - Stopped Purchasing",
    "CAT8 - Energy Without Purchase",
    null,
    "CAT3 - Micro Purchaser (<R400)",
    "Normal - No Leakage Flag",
  ];
  const salesCategory = categories[index] ?? null;
  return {
    originalProjectMeterNo: invisible ? `ORIG${index}` : `METER${index}`,
    fieldFoundMeterNo: `METER${index}`,
    iRepsMeterId: `TRN_MD_${index}`,
    registryVisibility: invisible ? "Invisible" : "Visible",
    fieldFoundMeterInSales: invisible ? "No" : "Yes",
    fieldFoundSalesMeterNo: invisible ? null : `METER${index}`,
    salesHistorySourceMeterNo: invisible ? `ORIG${index}` : `METER${index}`,
    salesHistoryAvailable: "Yes",
    salesCategory,
    targetCategory: salesCategory && /^CAT[1-8]\b/i.test(salesCategory) ? "Yes" : salesCategory ? "No" : null,
    accountNumber: `ACC${index}`,
    customerName: `Customer ${index}`,
    iRepsPremiseId: `PREM${index}`,
    lm: "Endumeni",
    lmPcode: "ZA5241",
    ward: `Ward ${(index % 3) + 2}`,
    areaWorkbase: "Endumeni",
    erf: String(1000 + index),
    streetNumber: String(index + 1),
    streetName: "Example Street",
    fullAddress: `${index + 1} Example Street`,
    propertyType: "Residential",
    investigationStatus: "Completed",
    investigationDate: "2026-06-15T10:00:00.000Z",
    fieldWorkerName: `Field Worker ${index}`,
    captureDate: "2026-06-15T10:00:00.000Z",
    gpsCoordinates: `-28.12${index}, 30.65${index}`,
    photoUrls: index === 0
      ? [
          "https://example.test/photo-1.jpg",
          "https://example.test/photo-2.jpg",
          "https://example.test/photo-3.jpg",
          "https://example.test/photo-4.jpg",
          "https://example.test/photo-5.jpg",
          "https://example.test/photo-6.jpg",
          "https://example.test/photo-7.jpg",
        ]
      : ["https://example.test/photo-1.jpg"],
    normalisation: index === 0
      ? "Meter number corrected • Address corrected"
      : null,
    propertyAccessible: "Yes",
    meterExists: "Yes",
    meterNumberVerified: invisible ? "Incorrect" : "Correct",
    meterAccessible: "Yes",
    meterKind: "prepaid",
    meterMode: "Prepaid",
    meterPhase: "Single Phase",
    meterUtilityType: "electricity",
    meterConnectionStatus: "CONNECTED",
    primaryFinding: invisible ? "Illegally Connected" : "Meter Ok",
    findingDetail: invisible ? "Straight Connection (Meter Bypass)" : "Meter Ok",
    illegalConnectionIndicator: invisible ? "Yes" : "No",
    findingDate: "2026-06-15T10:00:00.000Z",
    latestRelevantTrnType: "METER_DISCOVERY",
    latestRelevantTrnId: `TRN_MD_${index}`,
    interventionRequired: invisible ? "Yes" : "No",
    interventionStatus: invisible ? "Required" : "Not Required",
    interventionCount: 0,
    disconnected: "No",
    reconnected: "No",
    monthlyPurchases: Object.fromEntries(MONTH_KEYS.map((key) => [key, null])),
    latestPurchasingStatus: null,
    revenueAssessmentStatus: "Insufficient Data",
  };
}

function makeDataset() {
  const rows = Array.from({ length: 7 }, (_, index) => makeRow(index));
  rows[0].monthlyPurchases["2026-06"] = 0;
  rows[0].monthlyPurchases["2026-07"] = null;
  rows[1].monthlyPurchases["2026-06"] = 9463.97;
  rows[1].latestAvailablePurchaseValue = 9463.97;
  rows[1].latestPurchasingStatus = "Purchasing";

  return {
    schemaVersion: 1,
    reportType: "GENERAL_MONTHLY_REPORT",
    generatedAt: "2026-08-25T06:51:00.000Z",
    municipality: { lmPcode: "ZA5241", lmName: "Endumeni" },
    generationMode: "FULL_FIELD_POPULATION",
    populationSize: rows.length,
    monthKeys: MONTH_KEYS,
    zamoReport: {
      observedMaxPhotoCount: 7,
      photoColumnCount: 6,
      hardCeiling: 6,
      truncatedPhotoCount: 1,
    },
    summary: {
      populationTotal: 7,
      visiblePopulation: 5,
      invisiblePopulation: 2,
      unclassifiedPopulation: 0,
      selectedTotal: 7,
      visibleSelected: 5,
      invisibleSelected: 2,
      unclassifiedSelected: 0,
      fieldFoundSalesMatchedSelected: 5,
      salesHistoryAvailableSelected: 7,
      premiseLinkedSelected: 7,
      targetCategorySelected: 4,
      normalCategorySelected: 2,
      categoryNotAvailableSelected: 1,
      metersWithInterventions: 0,
      interventionEventCount: 0,
      exceptionCount: 2,
    },
    rows,
    interventionEvents: [],
    exceptions: [
      {
        meterKey: "TRN_MD_0",
        fieldFoundMeterNo: "METER0",
        registryVisibility: "Invisible",
        exceptionType: "FIELD_FOUND_METER_NOT_IN_SALES",
        sourceJoin: "registry_meters -> sales-all-meters",
        severity: "INFO",
        details: "Field-found meter is absent from current Sales.",
        resolutionStatus: "OPEN",
        resolutionNotes: null,
      },
    ],
  };
}

test("GMR workbook contains Financial Analysis plus dedicated Field Data and Field Stats sheets and every supplied full-population meter row", () => {
  const dataset = makeDataset();
  const artifact = buildGmrExcelArtifact({
    dataset,
    fileName: "gmr_test.xlsx",
  });

  assert.equal(artifact.format, "XLSX");
  assert.ok(artifact.bytes.byteLength > 0);

  const workbook = XLSX.read(artifact.bytes, { type: "array", cellDates: true });
  assert.deepEqual(workbook.SheetNames, [
    "GMR Dashboard",
    "GMR Master Meter",
    "Property Analysis",
    "Meter Verification",
    "Intervention & Recovery Detail",
    "Financial Analysis",
    "Field Data",
    "Field Stats",
    "Reconciliation Exceptions",
    "Data Dictionary",
  ]);

  const master = workbook.Sheets["GMR Master Meter"];
  const range = XLSX.utils.decode_range(master["!ref"]);
  assert.equal(range.e.r + 1, 9); // section header + column header + 7 rows

  const columns = getGmrMasterColumnDefinitions(MONTH_KEYS);
  assert.ok(columns.some((item) => item.header === "Sales Category"));
  assert.ok(columns.some((item) => item.header === "Target Category (1-8)"));
});


test("Field Data is independent from Financial Analysis and keeps only the currently approved columns", () => {
  const dataset = makeDataset();
  const artifact = buildGmrExcelArtifact({ dataset, fileName: "gmr_zamo.xlsx" });
  const workbook = XLSX.read(artifact.bytes, { type: "array", cellDates: true });
  const zamo = XLSX.utils.sheet_to_json(workbook.Sheets["Field Data"], { header: 1 });

  assert.deepEqual(zamo[0], [
    "Original / Project Meter Number",
    "Field-Found Meter Number",
    "Address",
    "GPS Coordinates",
    "Field Worker Name",
    "Capture Date",
    "Property Type",
    "Meter Mode",
    "Meter Phase",
    "Primary Finding",
    "Finding Explanation",
    "Photo 1",
    "Photo 2",
    "Photo 3",
    "Photo 4",
    "Photo 5",
    "Photo 6",
    "Normalisation",
  ]);

  [
    "Sales Category",
    "Target Category (1-8)",
    "Registry Visibility",
    "Sales History Source Meter Number",
    "Latest Intervention Type",
    "Direct Fine Recovery (R)",
    "Pre-Investigation 3M Average (R)",
    "Post-Investigation 3M Average (R)",
    "Observed Vending Movement (R)",
    "Observed Vending Movement (%)",
    "Latest Available Purchase (R)",
    "Latest Purchasing Status",
    "Last Purchase Month",
    "Revenue Assessment Status",
  ].forEach((removedHeader) => {
    assert.equal(zamo[0].includes(removedHeader), false);
  });

  assert.equal(zamo[1][zamo[0].indexOf("Property Type")], "Residential");
  assert.equal(zamo[1][zamo[0].indexOf("Meter Mode")], "Prepaid");
  assert.equal(zamo[1][zamo[0].indexOf("Meter Phase")], "Single Phase");
  assert.equal(zamo[1][zamo[0].indexOf("Primary Finding")], "Illegally Connected");
  assert.equal(
    zamo[1][zamo[0].indexOf("Finding Explanation")],
    "Straight Connection (Meter Bypass)",
  );
  assert.equal(zamo[0].filter((header) => header === "Primary Finding").length, 1);
  assert.equal(zamo[0].includes("Anomaly"), false);

  const zamoSheet = workbook.Sheets["Field Data"];
  const photo1Col = zamo[0].indexOf("Photo 1");
  const photo6Col = zamo[0].indexOf("Photo 6");
  const photo1Cell = zamoSheet[XLSX.utils.encode_cell({ r: 1, c: photo1Col })];
  const photo6Cell = zamoSheet[XLSX.utils.encode_cell({ r: 1, c: photo6Col })];

  assert.equal(photo1Cell.v, "Photo 1");
  assert.equal(photo1Cell.l.Target, "https://example.test/photo-1.jpg");
  assert.equal(photo6Cell.v, "Photo 6");
  assert.equal(photo6Cell.l.Target, "https://example.test/photo-6.jpg");
  assert.equal(zamo[1][zamo[0].indexOf("Normalisation")], "Meter number corrected • Address corrected");
  assert.equal(zamo[1].includes("https://example.test/photo-7.jpg"), false);
});

test("Field Stats counts each Field Data transaction exactly once in normalisation totals", () => {
  const dataset = makeDataset();
  dataset.rows[0].fieldWorkerName = "Worker B";
  dataset.rows[1].fieldWorkerName = "Worker A";
  dataset.rows[2].fieldWorkerName = "Worker A";
  dataset.rows[0].normalisation = "Meter Disconnection • Issue Fine";
  dataset.rows[1].normalisation = "Issue Fine";
  dataset.rows[2].normalisation = null;

  const artifact = buildGmrExcelArtifact({ dataset, fileName: "gmr_zamo_stats.xlsx" });
  const workbook = XLSX.read(artifact.bytes, { type: "array", cellDates: true });
  const stats = XLSX.utils.sheet_to_json(workbook.Sheets["Field Stats"], { header: 1, defval: "" });

  assert.equal(stats[0][0], "AUGUST 2026 - METER AUDIT");
  assert.equal(stats[1][0], "ITEM");
  assert.equal(stats[1][1], "METER STATUS");
  assert.equal(stats[1][2], "Field Worker 3");
  assert.ok(stats[1].includes("Worker A"));
  assert.ok(stats[1].includes("Worker B"));
  assert.equal(stats[1][stats[1].length - 1], "TOTAL");

  const totalAuditRow = stats.find((row) => row[1] === "TOTAL: INSPECTIONS COMPLETED");
  assert.ok(totalAuditRow);
  assert.equal(totalAuditRow[totalAuditRow.length - 1], dataset.rows.length);

  const illegalRow = stats.find((row) => row[1] === "ILLEGALLY CONNECTED");
  assert.ok(illegalRow);
  assert.equal(illegalRow[illegalRow.length - 1], 2);

  const normalisationTitleRow = stats.find((row) => row[0] === "AUGUST 2026 - NORMALISATION");
  assert.ok(normalisationTitleRow);

  const combinedActionRow = stats.find((row) => row[1] === "METER DISCONNECTION • ISSUE FINE");
  assert.ok(combinedActionRow);
  assert.equal(combinedActionRow[combinedActionRow.length - 1], 1);

  const issueFineRow = stats.find((row) => row[1] === "ISSUE FINE");
  assert.ok(issueFineRow);
  assert.equal(issueFineRow[issueFineRow.length - 1], 1);

  const notAvailableRow = stats.find((row) => row[1] === "NOT AVAILABLE");
  assert.ok(notAvailableRow);
  const expectedNotAvailableCount = dataset.rows.filter((row) => !row.normalisation).length;
  assert.equal(notAvailableRow[notAvailableRow.length - 1], expectedNotAvailableCount);

  const totalNormalisationRow = stats.find((row) => row[1] === "TOTAL: NORMALISATION");
  assert.ok(totalNormalisationRow);
  assert.equal(totalNormalisationRow[totalNormalisationRow.length - 1], dataset.rows.length);
  assert.deepEqual(
    totalNormalisationRow.slice(2),
    totalAuditRow.slice(2),
    "Normalisation totals must reconcile to inspections completed for every field worker and overall.",
  );
});

test("GMR Excel preserves confirmed zero and renders missing purchase evidence as Not Available", () => {
  const dataset = makeDataset();
  const artifact = buildGmrExcelArtifact({ dataset, fileName: "gmr_values.xlsx" });
  const workbook = XLSX.read(artifact.bytes, { type: "array" });
  const master = workbook.Sheets["GMR Master Meter"];
  const columns = getGmrMasterColumnDefinitions(MONTH_KEYS);
  const juneIndex = columns.findIndex((item) => item.header === "Purchase Value Jun-2026");
  const julyIndex = columns.findIndex((item) => item.header === "Purchase Value Jul-2026");

  const juneCell = master[XLSX.utils.encode_cell({ r: 2, c: juneIndex })];
  const julyCell = master[XLSX.utils.encode_cell({ r: 2, c: julyIndex })];

  assert.equal(juneCell.v, 0);
  assert.equal(juneCell.t, "n");
  assert.equal(julyCell.v, "Not Available");
  assert.equal(julyCell.t, "s");
});

test("managed GMR metadata is GENERAL_MONTHLY_REPORT and XLSX-only with dynamic full-population item count", () => {
  const dataset = makeDataset();
  const result = buildGeneralMonthlyManagedReport({
    dataset,
    generatedAt: new Date("2026-08-25T06:51:00.000Z"),
    buildArtifact({ fileName }) {
      return {
        format: "XLSX",
        fileName,
        bytes: Uint8Array.from([1, 2, 3]),
      };
    },
  });

  assert.equal(result.metadata.reportType, "GENERAL_MONTHLY_REPORT");
  assert.equal(result.metadata.format, "XLSX");
  assert.equal(result.metadata.itemCount, 7);
  assert.equal(result.metadata.sourceId, "ZA5241");
  assert.equal(result.metadata.sourceScope.invisibleSelected, 2);
  assert.equal(result.metadata.sourceScope.targetCategorySelected, 4);
  assert.equal(result.metadata.sourceScope.normalCategorySelected, 2);
  assert.equal(result.metadata.sourceScope.categoryNotAvailableSelected, 1);
  assert.match(
    result.metadata.fileName,
    /^general_monthly_report_endumeni_full_7_\d{12}\.xlsx$/,
  );
});

test("managed GMR persistence happens before browser download and uses the exact same artifact", async () => {
  const dataset = makeDataset();
  const calls = [];
  let persistedArtifact;
  let downloadedArtifact;

  const generate = createGeneralMonthlyReportManagedGenerator({
    buildArtifact({ fileName }) {
      return { format: "XLSX", fileName, bytes: Uint8Array.from([1, 2, 3, 4]) };
    },
    async persist({ artifact }) {
      calls.push("persist");
      persistedArtifact = artifact;
      return { lifecycle: { reportId: "RPT_GMR_1" } };
    },
    download(artifact) {
      calls.push("download");
      downloadedArtifact = artifact;
    },
  });

  const result = await generate({
    dataset,
    generatedAt: new Date("2026-08-25T06:51:00.000Z"),
  });

  assert.deepEqual(calls, ["persist", "download"]);
  assert.strictEqual(persistedArtifact, downloadedArtifact);
  assert.strictEqual(result.artifact, persistedArtifact);
  assert.equal(result.persistence.lifecycle.reportId, "RPT_GMR_1");
});
