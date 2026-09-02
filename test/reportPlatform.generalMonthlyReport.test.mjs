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
  "2026-06", "2026-07", "2026-08", "2026-09",
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
    streetNo: String(index + 1),
    streetNumber: String(index + 1),
    streetName: "Example",
    streetType: "Street",
    suburbName: "Example Suburb",
    fullAddress: `${index + 1} Example Street`,
    batchId: index === 0 ? "AD HOC" : `TB_${index}`,
    areaName: "Example Suburb",
    propertyType: "Residential",
    propertyName: index === 1 ? null : `Property ${index}`,
    propertyUnitNo: index === 1 ? null : `Unit ${index}`,
    investigationStatus: "Completed",
    investigationDate: "2026-08-15T10:00:00.000Z",
    fieldWorkerName: `Field Worker ${index}`,
    fieldStatsTeam: index < 2 ? "Kaiser Team" : index < 5 ? "Peter Team" : "Unassigned",
    captureDate: "2026-08-15T10:00:00.000Z",
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
    normalisation: index === 0 ? "Meter Disconnection • Issue Fine" : null,
    sealNo: index === 0 ? "SEAL-001" : null,
    fieldComment: index === 0 ? "Customer present during audit." : null,
    propertyAccessible: "Yes",
    meterExists: "Yes",
    meterNumberVerified: invisible ? "Incorrect" : "Correct",
    sameDifferent: invisible ? "Different" : "Same",
    meterAccessible: "Yes",
    meterKind: "prepaid",
    meterMode: "Prepaid",
    meterPhase: "Single Phase",
    meterUtilityType: "electricity",
    meterConnectionStatus: "CONNECTED",
    primaryFinding: invisible ? "Illegally Connected" : "Meter Ok",
    findingDetail: invisible ? "Straight Connection (Meter Bypass)" : "Meter Ok",
    illegalConnectionIndicator: invisible ? "Yes" : "No",
    findingDate: "2026-08-15T10:00:00.000Z",
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
  rows[0].monthlyPurchases["2026-09"] = 125;
  rows[1].monthlyPurchases["2026-06"] = 9463.97;
  rows[1].latestAvailablePurchaseValue = 9463.97;
  rows[1].latestPurchasingStatus = "Purchasing";

  return {
    schemaVersion: 1,
    reportType: "GENERAL_MONTHLY_REPORT",
    generatedAt: "2026-09-02T06:51:00.000Z",
    reportMonth: "2026-08",
    reportingPeriodLabel: "August 2026",
    activityScope: "REGISTRY_LINKED_DISCOVERY_AND_COMPLETED_DCN_RCN",
    municipality: { lmPcode: "ZA5241", lmName: "Endumeni" },
    generationMode: "MONTHLY_GMR",
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
      monthlyDiscoveryCount: rows.length,
      monthlyInterventionEventCount: 0,
      metersWithInterventions: 0,
      interventionEventCount: 0,
      exceptionCount: 1,
    },
    rows,
    fieldRows: rows,
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

function workbookFrom(dataset, fileName = "gmr_test.xlsx") {
  const artifact = buildGmrExcelArtifact({ dataset, fileName });
  return {
    artifact,
    workbook: XLSX.read(artifact.bytes, { type: "array", cellDates: true }),
  };
}

test("GMR workbook keeps the ten approved sheets and all full-context meter rows", () => {
  const dataset = makeDataset();
  const { artifact, workbook } = workbookFrom(dataset);
  assert.equal(artifact.format, "XLSX");
  assert.ok(artifact.bytes.byteLength > 0);
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
  const range = XLSX.utils.decode_range(workbook.Sheets["GMR Master Meter"]["!ref"]);
  assert.equal(range.e.r + 1, 9);
  const columns = getGmrMasterColumnDefinitions(MONTH_KEYS);
  assert.ok(columns.some((item) => item.header === "Purchase Value Sep-2026"));
});

test("Field Data keeps its approved columns while using fieldRows instead of full rows", () => {
  const dataset = makeDataset();
  dataset.fieldRows = dataset.rows.slice(0, 2);
  dataset.summary.monthlyDiscoveryCount = 2;
  const { workbook } = workbookFrom(dataset, "gmr_zamo.xlsx");
  const zamo = XLSX.utils.sheet_to_json(workbook.Sheets["Field Data"], { header: 1, defval: "" });

  assert.deepEqual(zamo[0], [
    "Capture Date", "Field Worker Name", "Batch ID", "Street No", "Street Name",
    "Street Type", "SuburbName", "GPS Coordinates", "Ward", "Property Type",
    "Property Name", "Unit No", "Meter Mode", "Meter Phase",
    "Original / Project Meter Number", "Field-Found Meter Number", "Same/Different",
    "Primary Finding", "Finding Explanation", "Normalisation", "Seal No", "Comment",
    "Photo 1", "Photo 2", "Photo 3", "Photo 4", "Photo 5", "Photo 6",
  ]);
  assert.equal(zamo.length, 3);

  const master = workbook.Sheets["GMR Master Meter"];
  const range = XLSX.utils.decode_range(master["!ref"]);
  assert.equal(range.e.r + 1, 9, "Master remains full seven-meter context");
});

test("Field Data preserves AD HOC, NAv and photo hyperlink behaviour", () => {
  const dataset = makeDataset();
  dataset.fieldRows[2].batchId = null;
  dataset.fieldRows[2].streetNo = null;
  dataset.fieldRows[2].streetName = null;
  dataset.fieldRows[2].streetType = null;
  dataset.fieldRows[2].suburbName = null;
  dataset.fieldRows[2].sameDifferent = null;
  dataset.fieldRows[2].sealNo = null;
  dataset.fieldRows[2].fieldComment = null;
  const { workbook } = workbookFrom(dataset, "gmr_values.xlsx");
  const zamo = XLSX.utils.sheet_to_json(workbook.Sheets["Field Data"], { header: 1, defval: "" });
  assert.equal(zamo[1][zamo[0].indexOf("Batch ID")], "AD HOC");
  assert.equal(zamo[3][zamo[0].indexOf("Batch ID")], "AD HOC");
  assert.equal(zamo[3][zamo[0].indexOf("Street No")], "NAv");
  assert.equal(zamo[3][zamo[0].indexOf("Same/Different")], "NAv");
  const photo1Col = zamo[0].indexOf("Photo 1");
  const photoCell = workbook.Sheets["Field Data"][XLSX.utils.encode_cell({ r: 1, c: photo1Col })];
  assert.equal(photoCell.l.Target, "https://example.test/photo-1.jpg");
});

test("Field Stats uses reportMonth rather than generatedAt and counts only fieldRows", () => {
  const dataset = makeDataset();
  dataset.generatedAt = "2026-09-02T06:51:00.000Z";
  dataset.fieldRows = dataset.rows.slice(0, 3);
  dataset.fieldRows[0].fieldWorkerName = "Worker B";
  dataset.fieldRows[1].fieldWorkerName = "Worker A";
  dataset.fieldRows[2].fieldWorkerName = "Worker A";
  dataset.fieldRows[1].normalisation = "Issue Fine";
  dataset.summary.monthlyDiscoveryCount = 3;

  const { workbook } = workbookFrom(dataset, "gmr_zamo_stats.xlsx");
  const stats = XLSX.utils.sheet_to_json(workbook.Sheets["Field Stats"], { header: 1, defval: "" });
  assert.equal(stats[0][0], "AUGUST 2026 - METER AUDIT");
  const totalAuditRow = stats.find((row) => row[1] === "TOTAL: METER DISCOVERY RECORDS");
  assert.ok(totalAuditRow);
  assert.equal(totalAuditRow[totalAuditRow.length - 1], 3);
  const normalisationTitleRow = stats.find((row) => row[0] === "AUGUST 2026 - NORMALISATION");
  assert.ok(normalisationTitleRow);
  const totalNormalisationRow = stats.find((row) => row[1] === "TOTAL: NORMALISATION");
  assert.equal(totalNormalisationRow[totalNormalisationRow.length - 1], 3);
});

test("zero selected-month activity still generates valid Field Data and Field Stats", () => {
  const dataset = makeDataset();
  dataset.fieldRows = [];
  dataset.interventionEvents = [];
  dataset.summary.monthlyDiscoveryCount = 0;
  dataset.summary.monthlyInterventionEventCount = 0;
  dataset.summary.metersWithInterventions = 0;
  const { workbook } = workbookFrom(dataset, "gmr_zero_activity.xlsx");

  const fieldData = XLSX.utils.sheet_to_json(workbook.Sheets["Field Data"], { header: 1, defval: "" });
  assert.equal(fieldData.length, 1);
  const stats = XLSX.utils.sheet_to_json(workbook.Sheets["Field Stats"], { header: 1, defval: "" });
  assert.equal(stats[0][0], "AUGUST 2026 - METER AUDIT");
  const total = stats.find((row) => row[1] === "TOTAL: METER DISCOVERY RECORDS");
  assert.ok(total);
  assert.equal(total[total.length - 1], 0);
});

test("workbook tolerates no Sales month evidence while retaining full meter context", () => {
  const dataset = makeDataset();
  dataset.monthKeys = [];
  dataset.rows.forEach((row) => { row.monthlyPurchases = {}; });
  dataset.fieldRows = dataset.rows.slice(0, 1);
  const { workbook } = workbookFrom(dataset, "gmr_no_sales_months.xlsx");
  const columns = getGmrMasterColumnDefinitions([]);
  assert.equal(columns.some((item) => item.header.startsWith("Purchase Value ")), false);
  assert.ok(workbook.Sheets["GMR Master Meter"]);
});

test("GMR Excel preserves confirmed zero and renders missing purchase evidence as Not Available", () => {
  const dataset = makeDataset();
  const { workbook } = workbookFrom(dataset, "gmr_purchase_values.xlsx");
  const master = workbook.Sheets["GMR Master Meter"];
  const columns = getGmrMasterColumnDefinitions(MONTH_KEYS);
  const juneIndex = columns.findIndex((item) => item.header === "Purchase Value Jun-2026");
  const julyIndex = columns.findIndex((item) => item.header === "Purchase Value Jul-2026");
  const septemberIndex = columns.findIndex((item) => item.header === "Purchase Value Sep-2026");
  const juneCell = master[XLSX.utils.encode_cell({ r: 2, c: juneIndex })];
  const julyCell = master[XLSX.utils.encode_cell({ r: 2, c: julyIndex })];
  const septemberCell = master[XLSX.utils.encode_cell({ r: 2, c: septemberIndex })];
  assert.equal(juneCell.v, 0);
  assert.equal(juneCell.t, "n");
  assert.equal(julyCell.v, "Not Available");
  assert.equal(julyCell.t, "s");
  assert.equal(septemberCell.v, 125, "purchase history later than August remains present");
});

test("Dashboard separates reporting month from generated timestamp and full population from monthly activity", () => {
  const dataset = makeDataset();
  dataset.fieldRows = dataset.rows.slice(0, 2);
  dataset.summary.monthlyDiscoveryCount = 2;
  dataset.summary.monthlyInterventionEventCount = 1;
  const { workbook } = workbookFrom(dataset, "gmr_dashboard.xlsx");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["GMR Dashboard"], { header: 1, defval: "" });
  assert.ok(rows.some((row) => row[0] === "Reporting Month" && row[1] === "August 2026"));
  assert.ok(rows.some((row) => row[0] === "Generated At"));
  assert.ok(rows.some((row) => row[0] === "Total Meters" && row[1] === 7));
  assert.ok(rows.some((row) => row[0] === "Meter Discovery Records" && row[1] === 2));
  assert.ok(rows.some((row) => row[0] === "Completed DCN / RCN Events" && row[1] === 1));
});

test("managed GMR identity carries reporting month while itemCount remains full meter population", () => {
  const dataset = makeDataset();
  dataset.fieldRows = dataset.rows.slice(0, 3);
  dataset.summary.monthlyDiscoveryCount = 3;
  dataset.summary.monthlyInterventionEventCount = 2;
  const result = buildGeneralMonthlyManagedReport({
    dataset,
    generatedAt: new Date("2026-09-02T06:51:00.000Z"),
    buildArtifact({ fileName }) {
      return { format: "XLSX", fileName, bytes: Uint8Array.from([1, 2, 3]) };
    },
  });
  assert.equal(result.metadata.reportType, "GENERAL_MONTHLY_REPORT");
  assert.equal(result.metadata.format, "XLSX");
  assert.equal(result.metadata.itemCount, 7);
  assert.equal(result.metadata.sourceScope.reportMonth, "2026-08");
  assert.equal(result.metadata.sourceScope.reportingPeriodLabel, "August 2026");
  assert.equal(result.metadata.sourceScope.monthlyDiscoveryCount, 3);
  assert.equal(result.metadata.sourceScope.monthlyInterventionEventCount, 2);
  assert.equal(result.metadata.sourceScope.activityScope, "REGISTRY_LINKED_DISCOVERY_AND_COMPLETED_DCN_RCN");
  assert.match(result.metadata.fileName, /^general_monthly_report_endumeni_2026-08_\d{12}\.xlsx$/);
});

test("managed GMR persistence happens before browser download and uses the same artifact", async () => {
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
  const result = await generate({ dataset, generatedAt: new Date("2026-09-02T06:51:00.000Z") });
  assert.deepEqual(calls, ["persist", "download"]);
  assert.strictEqual(persistedArtifact, downloadedArtifact);
  assert.strictEqual(result.artifact, persistedArtifact);
  assert.equal(result.persistence.lifecycle.reportId, "RPT_GMR_1");
});
