import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

import {
  buildGeneralMonthlyManagedReport,
  createGeneralMonthlyReportManagedGenerator,
} from "../src/pages/reports/generalMonthlyReportArtifact.js";
import {
  GMR_EXTRA_FIELD_DATA_COLUMNS,
  GMR_SHEET_NAMES,
  GMR_ZAMO_FIELD_DATA_COLUMNS,
  buildGmrExcelArtifact,
} from "../src/utils/reportPlatform/buildGmrExcelArtifact.js";
import { buildGmrFieldStatsModel } from "../src/utils/reportPlatform/gmrFieldStatsModel.js";

function row(overrides = {}) {
  return {
    captureDate: "2026-09-10T08:00:00.000Z",
    trnId: "TRN_MD_1",
    trnType: "METER_DISCOVERY",
    trnTypeLabel: "Meter Discovery",
    channel: "Field",
    fieldWorkerUid: "U1",
    fieldWorkerName: "Lefu Worker",
    team: "Team A",
    batchId: "TB_9",
    streetNo: "14",
    streetName: "Van Rensburg",
    streetType: "Street",
    suburbName: "Dundee",
    gpsCoordinates: "-28.1, 30.2",
    ward: "Ward 6",
    propertyType: "Residential",
    propertyName: null,
    propertyUnitNo: null,
    meterMode: "Prepaid",
    meterPhase: "Single Phase",
    meterPlacement: "Outside",
    originalProjectMeterNo: "07141234567",
    fieldFoundMeterNo: "07141234567",
    sameDifferent: "Same",
    remainingCredit: "12.5",
    salesCategory: "CAT4 - Long Gap",
    primaryFinding: "Meter Ok",
    findingDetail: "Operationally Ok",
    normalisation: "Meter Ok - None",
    noActionReason: null,
    sealNo: "S1",
    fieldComment: null,
    visibility: "Visible",
    onVendingList: "Yes",
    startedFrom: null,
    followUpRequired: null,
    followUpStatus: null,
    followUpTrnId: null,
    photoUrls: ["https://example.test/1.jpg", "https://example.test/2.jpg"],
    hasAccess: true,
    meterType: "ELECTRICITY",
    findingGroup: "Meter Ok · Operationally Ok",
    normalisationActions: ["None"],
    ...overrides,
  };
}

function makeDataset(fieldRows = [row()], extra = {}) {
  return {
    schemaVersion: 2,
    reportType: "GENERAL_MONTHLY_REPORT",
    generationMode: "MONTHLY_GMR",
    generatedAt: "2026-09-21T10:05:00.000Z",
    reportMonth: "2026-09",
    reportingPeriodLabel: "September 2026",
    isIncompleteMonth: true,
    municipality: { lmPcode: "ZA5241", lmName: "Endumeni" },
    photoColumnCount: Math.max(0, ...fieldRows.map((item) => item.photoUrls.length)),
    fieldRows,
    unplaced: [],
    summary: { payableTotal: fieldRows.length, unplacedCount: 0 },
    ...extra,
  };
}

function readWorkbook(dataset) {
  const artifact = buildGmrExcelArtifact({ dataset, fileName: "gmr.xlsx" });
  return { artifact, workbook: XLSX.read(artifact.bytes, { type: "array", cellDates: true }) };
}

test("the workbook holds exactly Field Data and Field Stats, in that order", () => {
  const { workbook } = readWorkbook(makeDataset());
  assert.deepEqual(workbook.SheetNames, [...GMR_SHEET_NAMES]);
});

test("the workbook is written compressed", () => {
  const { artifact } = readWorkbook(makeDataset());
  const view = new DataView(artifact.bytes.buffer, artifact.bytes.byteOffset);
  assert.equal(view.getUint32(0, true), 0x04034b50, "starts with a zip entry");
  assert.equal(view.getUint16(8, true), 8, "the first part is deflated, not stored");
});

const ZAMO_HEADERS = [
  "Capture Date", "Field Worker Name", "Sales Category", "Batch ID", "Street No", "Street Name",
  "Street Type", "SuburbName", "GPS Coordinates", "Ward", "Property Type", "Property Name", "Unit No",
  "Meter Mode", "Meter Phase", "Meter Placement", "Original / Project Meter Number",
  "Field-Found Meter Number", "Same/Different", "Remaining Credit", "Primary Finding",
  "Finding Explanation", "Normalisation", "Seal No", "Comment",
  "Photo 1", "Photo 2", "Photo 3", "Photo 4", "Photo 5", "Photo 6",
];

test("Field Data keeps Zamo's 31 columns exactly, in row 1, with the added columns after Photo 6", () => {
  const eightPhotos = row({ photoUrls: Array.from({ length: 8 }, (_, index) => `https://example.test/${index + 1}.jpg`) });
  const { workbook } = readWorkbook(makeDataset([row(), eightPhotos]));
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Field Data"], { header: 1, defval: "" });

  assert.deepEqual(GMR_ZAMO_FIELD_DATA_COLUMNS.map((item) => item.header), ZAMO_HEADERS);
  assert.deepEqual(rows[0].slice(0, 31), ZAMO_HEADERS, "Zamo's columns come first, untouched");
  assert.deepEqual(rows[0].slice(31, 31 + GMR_EXTRA_FIELD_DATA_COLUMNS.length), GMR_EXTRA_FIELD_DATA_COLUMNS.map((item) => item.header));
  assert.equal(rows[0][31], "Transaction Type");
  assert.equal(rows[0][32], "Transaction Number");
  assert.deepEqual(rows[0].slice(-2), ["Photo 7", "Photo 8"], "a seventh photograph goes last, never inside Zamo's columns");
  assert.equal(rows[1][3], "TB_9");
  assert.equal(rows[1][32], "TRN_MD_1");
});

test("Field Data writes AD HOC, NAv, the South African date and photo links as Zamo had them", () => {
  const rows = [
    row({ batchId: null }),
    row({ trnId: "LATE", captureDate: "2026-09-30T21:30:00.000Z" }),
  ];
  const artifact = buildGmrExcelArtifact({ dataset: makeDataset(rows), fileName: "gmr.xlsx" });
  // Read the saved bytes back, as Excel would, whatever this machine's time zone.
  const workbook = XLSX.read(artifact.bytes, { type: "array", cellNF: true });
  const sheet = workbook.Sheets["Field Data"];
  const header = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0];
  const cellFor = (name, r = 1) => sheet[XLSX.utils.encode_cell({ r, c: header.indexOf(name) })];

  assert.equal(cellFor("Batch ID").v, "AD HOC");
  assert.equal(cellFor("Property Name").v, "NAv");
  assert.equal(cellFor("Reason For Not Acting").v, "NAv");
  assert.equal(cellFor("Capture Date").w, "2026-09-10");
  assert.equal(cellFor("Capture Date", 2).w, "2026-09-30", "23:30 on the last day stays in the month");
  assert.equal(cellFor("Photo 2").v, "Photo 2");
  assert.equal(cellFor("Photo 2").l.Target, "https://example.test/2.jpg");
  assert.equal(cellFor("Photo 3").v, "", "no photograph, empty cell, as before");
});

test("a month with no field work still makes a report", () => {
  const { workbook } = readWorkbook(makeDataset([]));
  assert.deepEqual(workbook.SheetNames, [...GMR_SHEET_NAMES]);
  const managed = buildGeneralMonthlyManagedReport({ dataset: makeDataset([]), generatedAt: new Date("2026-09-21T10:05:00.000Z") });
  assert.equal(managed.metadata.itemCount, 0);
});

test("Field Stats is Zamo's three blocks and nothing else", () => {
  const rows = [
    row({ trnId: "A", fieldWorkerName: "Lefu Motlou", team: "Lesedi Audit" }),
    row({ trnId: "B", fieldWorkerName: "Peter Peter", team: "Peter Team", primaryFinding: "Illegally Connected", findingDetail: "Bridge Wire On The Meter", normalisation: "Illegally Connected - Disconnect meter", normalisationActions: ["Disconnect meter"] }),
    row({ trnId: "C", fieldWorkerName: "Peter Peter", team: "Peter Team", primaryFinding: "Illegally Connected", findingDetail: "Straight Connection (Meter Bypassed)", normalisation: 'Illegally Connected - None, reason "Not recorded - captured before this rule"', normalisationActions: ["None"], noActionReason: "Not recorded - captured before this rule" }),
    row({ trnId: "D", fieldWorkerName: "Peter Peter", team: "Peter Team", normalisation: "Meter Ok - Tamper removed", normalisationActions: ["Tamper removed"] }),
    row({ trnId: "E", trnType: "METER_DISCONNECTION", trnTypeLabel: "Meter Disconnection", fieldWorkerName: "Sipho Worker", primaryFinding: null, findingDetail: null, normalisation: null }),
    row({ trnId: "F", hasAccess: false, fieldWorkerName: "Lefu Motlou", team: "Lesedi Audit", primaryFinding: "No Access", findingDetail: "Gate locked", normalisation: "No Access", normalisationActions: [], photoUrls: [] }),
  ];
  const { workbook } = readWorkbook(makeDataset(rows, { isIncompleteMonth: false }));
  const sheet = XLSX.utils.sheet_to_json(workbook.Sheets["Field Stats"], { header: 1, defval: "" })
    .map((line) => {
      const cells = [...line];
      while (cells.length && cells.at(-1) === "") cells.pop();
      return cells;
    });

  assert.deepEqual(sheet[0], ["SEPTEMBER 2026 - METER AUDIT"]);
  assert.deepEqual(sheet[1], ["ITEM", "METER STATUS", "Lefu Motlou", "Peter Peter", "TOTAL"]);
  assert.deepEqual(sheet[2], [1, "Illegally Connected", 0, 2, 2]);
  assert.deepEqual(sheet[3], [2, "Meter Damaged", 0, 0, 0]);
  assert.deepEqual(sheet[4], [3, "Meter Faulty", 0, 0, 0]);
  assert.deepEqual(sheet[5], [4, "Meter Ok", 1, 1, 2]);
  assert.deepEqual(sheet[6], [5, "No Access", 1, 0, 1], "the one line the owner added to his layout");
  assert.deepEqual(sheet[7], ["", "TOTAL: METER DISCOVERY RECORDS", 2, 3, 5], "a disconnection is not in these blocks");
  assert.deepEqual(sheet[9], ["SEPTEMBER 2026 - NORMALISATION"]);
  assert.deepEqual(sheet[10], [1, "Meter Ok - None", 1, 0, 1], "every row carries its finding, the healthy one included");
  assert.deepEqual(sheet[11], [2, "Illegally Connected - Disconnect meter", 0, 1, 1]);
  assert.deepEqual(sheet[12], [3, 'Illegally Connected - None, reason "Not recorded - captured before this rule"', 0, 1, 1]);
  assert.deepEqual(sheet[13], [4, "Meter Ok - Tamper removed", 0, 1, 1], "a healthy meter's own fix");
  assert.deepEqual(sheet[14], [5, "No Access", 1, 0, 1], "and No Access last of all");
  assert.deepEqual(sheet[15], ["", "TOTAL: NORMALISATION", 2, 3, 5]);
  assert.deepEqual(sheet[18], ["Teams", "METER STATUS", "Lesedi Audit", "Peter Team", "TOTAL"]);
  assert.deepEqual(sheet[24], ["", "TOTAL: METER DISCOVERY RECORDS", 2, 3, 5]);

  // The only thing under the three sections: the control lines.
  const after = sheet.slice(25).filter((cells) => cells.length);
  assert.deepEqual(after[0], ["SEPTEMBER 2026 - CONTROL LINES"]);
  assert.deepEqual(after[1], ["ITEM", "CONTROL LINE", "COUNT"]);
  assert.equal(after.length, 2 + 7, "seven control lines, and nothing else");
  assert.equal(after[2][1], "SUBMITTED THIS MONTH BUT NOT ON FIELD DATA (MUST BE 0)");
  assert.equal(after.at(-1)[1], "WORKERS WHOSE TEAM COULD NOT BE RESOLVED");
});

// September 2026 as it was measured on LIVE on 25 September: 599 Meter
// Discovery transactions, 462 with a meter and 137 no access.
function septemberRows() {
  const rows = [];
  const add = (count, overrides) => {
    for (let index = 0; index < count; index += 1) rows.push(row({ trnId: `TRN_${rows.length}`, ...overrides }));
  };
  const marker = "Not recorded - captured before this rule";
  const ic = { primaryFinding: "Illegally Connected", findingDetail: "Bridge Wire On The Meter" };

  add(388, { primaryFinding: "Meter Ok", findingDetail: "Operationally Ok", normalisation: "Meter Ok - None", normalisationActions: ["None"] });
  add(10, { ...ic, normalisation: "Illegally Connected - Disconnect meter", normalisationActions: ["Disconnect meter"] });
  add(5, { ...ic, normalisation: "Illegally Connected - Disconnect meter, Tamper removed", normalisationActions: ["Disconnect meter", "Tamper removed"] });
  add(1, { ...ic, normalisation: "Illegally Connected - Disconnect meter, Tamper removed, Replace meter", normalisationActions: ["Disconnect meter", "Tamper removed", "Replace meter"] });
  add(1, { ...ic, normalisation: "Illegally Connected - Tamper removed", normalisationActions: ["Tamper removed"] });
  add(40, { ...ic, normalisation: 'Illegally Connected - None, reason "Not recorded - captured before this rule"', normalisationActions: ["None"], noActionReason: marker });
  add(10, { ...ic, normalisation: "Illegally Connected - None", normalisationActions: ["None"] });
  add(1, { primaryFinding: "Meter Damaged", findingDetail: "Meter Burnt", normalisation: "Meter Damaged - Replace meter", normalisationActions: ["Replace meter"] });
  add(4, { primaryFinding: "Meter Damaged", findingDetail: "Meter Burnt", normalisation: 'Meter Damaged - None, reason "Not recorded, captured before this rule"', normalisationActions: ["None"], noActionReason: marker });
  add(1, { primaryFinding: "Meter Faulty", findingDetail: "Meter Display Blank", normalisation: 'Meter Faulty - None, reason "Not recorded, captured before this rule"', normalisationActions: ["None"], noActionReason: marker });
  add(1, { primaryFinding: "Meter Faulty", findingDetail: "Meter Display Blank", normalisation: "Meter Faulty - None", normalisationActions: ["None"] });
  add(137, { hasAccess: false, primaryFinding: "No Access", findingDetail: "Gate locked", normalisation: "No Access", normalisationActions: [], photoUrls: [] });

  return rows;
}

test("Field Stats reproduces September 2026 on LIVE: 462 with a meter, 137 no access, 599 in each section", () => {
  const { workbook } = readWorkbook(makeDataset(septemberRows(), { isIncompleteMonth: false }));
  const sheet = XLSX.utils.sheet_to_json(workbook.Sheets["Field Stats"], { header: 1, defval: "" })
    .map((line) => {
      const cells = [...line];
      while (cells.length && cells.at(-1) === "") cells.pop();
      return cells;
    });
  const lineOf = (label) => sheet.find((cells) => cells[1] === label);
  const totalOf = (label) => lineOf(label)?.at(-1);

  assert.equal(totalOf("Illegally Connected"), 67);
  assert.equal(totalOf("Meter Damaged"), 5);
  assert.equal(totalOf("Meter Faulty"), 2);
  assert.equal(totalOf("Meter Ok"), 388);
  assert.equal(totalOf("No Access"), 137, "the line the owner added to his layout");
  assert.equal(totalOf("TOTAL: METER DISCOVERY RECORDS"), 599);
  assert.equal(totalOf("TOTAL: NORMALISATION"), 599);

  const start = sheet.findIndex((cells) => cells[0] === "SEPTEMBER 2026 - NORMALISATION");
  const labels = sheet.slice(start + 1).map((cells) => cells[1]);
  assert.deepEqual(labels.slice(0, labels.indexOf("TOTAL: NORMALISATION") + 1), [
    "Meter Ok - None",
    "Illegally Connected - Disconnect meter",
    "Illegally Connected - Disconnect meter, Tamper removed",
    "Illegally Connected - Disconnect meter, Tamper removed, Replace meter",
    "Illegally Connected - Tamper removed",
    'Illegally Connected - None, reason "Not recorded - captured before this rule"',
    "Illegally Connected - None",
    "Meter Damaged - Replace meter",
    'Meter Damaged - None, reason "Not recorded, captured before this rule"',
    'Meter Faulty - None, reason "Not recorded, captured before this rule"',
    "Meter Faulty - None",
    "No Access",
    "TOTAL: NORMALISATION",
  ]);
  assert.equal(totalOf('Illegally Connected - None, reason "Not recorded - captured before this rule"'), 40, "never asked");
  assert.equal(totalOf("Illegally Connected - None"), 10, "asked, and nothing chosen");
});

test("the extra counts tell workers apart by user, not by name", () => {
  const rows = [
    row({ trnId: "A", fieldWorkerUid: "U1", fieldWorkerName: "Sipho Dlamini" }),
    row({ trnId: "B", fieldWorkerUid: "U2", fieldWorkerName: "Sipho Dlamini" }),
  ];
  const model = buildGmrFieldStatsModel(makeDataset(rows));
  assert.equal(model.workers.length, 2);
  const labels = model.workers.map((key) => model.workerLabels.get(key));
  assert.equal(new Set(labels).size, 2);
});

test("the control lines count unplaced work, meters off the vending list, and stale visibility once per meter", () => {
  const rows = [
    row({ trnId: "A", fieldFoundMeterNo: "M1", onVendingList: "No", visibility: "Invisible", salesCategory: null }),
    row({ trnId: "B", fieldFoundMeterNo: "M1", onVendingList: "No", visibility: "Invisible", salesCategory: null }),
    row({ trnId: "C", fieldFoundMeterNo: "M2", onVendingList: "Yes", visibility: "Invisible" }),
    row({ trnId: "D", fieldFoundMeterNo: "W1", meterType: "WATER", onVendingList: null, salesCategory: null }),
    row({ trnId: "E", team: "Unassigned", fieldWorkerName: "New Worker", gpsCoordinates: null }),
  ];
  const model = buildGmrFieldStatsModel(makeDataset(rows, { unplaced: [{ trnId: "X", reason: "The submission time cannot be read." }] }));
  const control = Object.fromEntries(model.controlLines.map((line) => [line.label, line.count]));

  assert.equal(control["SUBMITTED THIS MONTH BUT NOT ON FIELD DATA (MUST BE 0)"], 1);
  assert.equal(control["METERS FOUND THAT ARE NOT ON THE VENDING LIST"], 1);
  assert.equal(control["VISIBILITY MARK THAT DISAGREES WITH SALES"], 1);
  assert.equal(control["TRANSACTIONS WITH NO SALES CATEGORY"], 2, "water is never on the vending list");
  assert.equal(control["MISSING GPS, PHOTOGRAPH OR NORMALISATION ANSWER"], 1);
  assert.equal(control["WORKERS WHOSE TEAM COULD NOT BE RESOLVED"], 1);
});

test("the saved report names the month and counts its transactions", () => {
  const managed = buildGeneralMonthlyManagedReport({ dataset: makeDataset([row(), row({ trnId: "B" })]), generatedAt: new Date("2026-09-21T10:05:00.000Z") });
  assert.equal(managed.metadata.itemCount, 2);
  assert.equal(managed.metadata.sourceScope.reportMonth, "2026-09");
  assert.equal(managed.metadata.sourceScope.payableTotal, 2);
  assert.equal(managed.metadata.sourceScope.isIncompleteMonth, true);
  assert.match(managed.metadata.fileName, /^general_monthly_report_endumeni_2026-09_\d{12}\.xlsx$/);
});

test("the report is saved before it is offered to the browser, and each step is reported", async () => {
  const calls = [];
  const generate = createGeneralMonthlyReportManagedGenerator({
    buildArtifact({ fileName }) {
      return { format: "XLSX", fileName, bytes: Uint8Array.from([1, 2, 3]) };
    },
    async persist({ artifact }) {
      calls.push("persist");
      return { lifecycle: { reportId: "RPT_1" }, artifact };
    },
    download() {
      calls.push("download");
    },
  });
  const steps = [];
  const result = await generate({ dataset: makeDataset(), onStep: (step) => steps.push(step) });
  assert.deepEqual(calls, ["persist", "download"]);
  assert.deepEqual(steps, ["BUILD", "SAVE", "DOWNLOAD"]);
  assert.equal(result.downloaded, true);
});

test("a failed save still hands back the built workbook", async () => {
  const generate = createGeneralMonthlyReportManagedGenerator({
    buildArtifact({ fileName }) {
      return { format: "XLSX", fileName, bytes: Uint8Array.from([1, 2, 3]) };
    },
    async persist() {
      throw new Error("Storage is unavailable.");
    },
    download() {
      throw new Error("must not download an unsaved report automatically");
    },
  });
  await assert.rejects(generate({ dataset: makeDataset() }), (error) => {
    assert.equal(error.message, "Storage is unavailable.");
    assert.ok(error.gmrArtifact?.bytes instanceof Uint8Array);
    return true;
  });
});
