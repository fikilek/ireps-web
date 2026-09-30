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
  "Field-Found Meter Number", "Same/Different", "Remaining Credit", "Anomaly",
  "Anomaly Detail", "Normalisation", "Seal No", "Comment",
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

// GMR-R013 (1.11.0) and the owner's NAv rule.
test("a no access visit is off Field Data, on its own sheet, and still counted", () => {
  const noAccess = row({
    trnId: "B",
    hasAccess: false,
    fieldWorkerName: "Lefu Motlou",
    team: "Lesedi Audit",
    primaryFinding: null,
    findingDetail: null,
    noAccessReason: "Gate locked",
    erfNo: "689",
    normalisation: "NAv",
    normalisationActions: [],
    photoUrls: [],
  });
  const { workbook } = readWorkbook(
    makeDataset([row({ trnId: "A", fieldWorkerName: "Lefu Motlou", team: "Lesedi Audit" })], {
      noAccessRows: [noAccess],
    }),
  );

  assert.deepEqual(workbook.SheetNames, ["Field Data", "Field Stats", "No Access", "Exceptions"]);

  const data = XLSX.utils.sheet_to_json(workbook.Sheets["Field Data"], { header: 1, defval: "" });
  const numbers = data.slice(1).map((cells) => cells[data[0].indexOf("Transaction Number")]);
  assert.deepEqual(numbers, ["A"], "the no access visit is not on the sheet the municipality pays on");

  const sheet = XLSX.utils.sheet_to_json(workbook.Sheets["No Access"], { header: 1, defval: "" });
  const header = sheet.find((cells) => cells[0] === "ITEM");
  assert.deepEqual(header, [
    "ITEM", "CAPTURE DATE", "FIELD WORKER", "TEAM", "ERF", "ADDRESS",
    "TRANSACTION TYPE", "TRANSACTION NUMBER", "REASON",
  ]);
  const listed = sheet[sheet.indexOf(header) + 1];
  assert.equal(listed[2], "Lefu Motlou");
  assert.equal(listed[3], "Lesedi Audit");
  assert.equal(listed[4], "689");
  assert.equal(listed[6], "Meter Discovery", "a no access is an outcome, not a transaction type");
  assert.equal(listed[7], "B");
  assert.equal(listed[8], "Gate locked", "the reason has a home at last");

  // It is still the period's work, so Field Stats counts it.
  const stats = XLSX.utils.sheet_to_json(workbook.Sheets["Field Stats"], { header: 1, defval: "" });
  const auditNoAccess = stats.find((cells) => cells[1] === "No Access");
  assert.ok(auditNoAccess, "METER AUDIT keeps its No Access line");
  assert.equal(auditNoAccess.at(-1), 1);
});

// GMR-R041
test("the Exceptions sheet names every exception, one row each, with its explanation", () => {
  const rows = [
    row({ trnId: "A", fieldWorkerName: "Lefu Motlou" }),
    row({ trnId: "B", fieldWorkerName: "Peter Peter", batchId: "AD HOC" }),
    row({ trnId: "C", fieldWorkerName: "Sipho Worker", gpsCoordinates: "", photoUrls: [] }),
    row({ trnId: "D", fieldWorkerName: "Thandi Worker", meterInMaster: false }),
  ];
  const dataset = makeDataset(rows, {
    droppedCaptures: [
      {
        trnId: "E",
        trnTypeLabel: "Meter Discovery",
        captureDate: "2026-09-12T08:00:00.000Z",
        fieldWorkerName: "Thabo Worker",
        claimedMeterNo: "07149999999",
        reason: "The capture says a meter was created, but the meter is not there.",
      },
    ],
    meterMasterGapCount: 1,
  });

  const { workbook } = readWorkbook(dataset);
  assert.deepEqual(workbook.SheetNames, ["Field Data", "Field Stats", "No Access", "Exceptions"]);

  const sheet = XLSX.utils.sheet_to_json(workbook.Sheets.Exceptions, { header: 1, defval: "" });
  const header = sheet.find((cells) => cells[0] === "ITEM");
  assert.deepEqual(header, [
    "ITEM",
    "EXCEPTION",
    "COUNTED IN THE REPORT?",
    "TRANSACTION NUMBER",
    "TRANSACTION TYPE",
    "CAPTURE DATE",
    "FIELD WORKER",
    "METER NUMBER",
    "WHY IT IS AN EXCEPTION",
  ]);

  const listed = sheet.slice(sheet.indexOf(header) + 1).filter((cells) => cells[0]);
  const byKind = new Map(listed.map((cells) => [cells[1], cells]));

  const claimed = byKind.get("A meter was claimed but not created");
  assert.ok(claimed, "the capture with no meter is listed");
  assert.equal(claimed[2], "No", "it is not counted");
  assert.equal(claimed[3], "E");
  assert.equal(claimed[6], "Thabo Worker");
  assert.equal(claimed[7], "07149999999");
  assert.match(claimed[8], /the meter is not there/);

  const master = byKind.get("Meter not in meter master");
  assert.ok(master, "the meter master gap is listed");
  assert.equal(master[2], "Yes", "the field did the work, so the row is counted");

  const evidence = byKind.get("Missing GPS, photograph or normalisation");
  assert.equal(evidence[2], "Yes");
  assert.match(evidence[8], /no GPS/);

  assert.ok(byKind.get("Work with no batch"), "work outside a batch is listed");
  assert.equal(listed.length, 4, "one row per exception, and nothing else");
});

test("a period with no exceptions says so rather than leaving the sheet empty", () => {
  const { workbook } = readWorkbook(makeDataset([row({ trnId: "A" })]));
  const sheet = XLSX.utils.sheet_to_json(workbook.Sheets.Exceptions, { header: 1, defval: "" });
  assert.ok(sheet.some((cells) => cells[1] === "No exceptions found for this period."));
});

test("Field Stats is Zamo's three blocks and nothing else", () => {
  const rows = [
    row({ trnId: "A", fieldWorkerName: "Lefu Motlou", team: "Lesedi Audit" }),
    row({ trnId: "B", fieldWorkerName: "Peter Peter", team: "Peter Team", primaryFinding: "Illegally Connected", findingDetail: "Bridge Wire On The Meter", normalisation: "Illegally Connected - Disconnect meter", normalisationActions: ["Disconnect meter"] }),
    row({ trnId: "C", fieldWorkerName: "Peter Peter", team: "Peter Team", primaryFinding: "Illegally Connected", findingDetail: "Straight Connection (Meter Bypassed)", normalisation: 'Illegally Connected - None, reason "Not recorded - captured before this rule"', normalisationActions: ["None"], noActionReason: "Not recorded - captured before this rule" }),
    row({ trnId: "D", fieldWorkerName: "Peter Peter", team: "Peter Team", normalisation: "Meter Ok - Tamper removed", normalisationActions: ["Tamper removed"] }),
    row({ trnId: "E", trnType: "METER_DISCONNECTION", trnTypeLabel: "Meter Disconnection", fieldWorkerName: "Sipho Worker", primaryFinding: null, findingDetail: null, normalisation: null }),
    row({ trnId: "F", hasAccess: false, fieldWorkerName: "Lefu Motlou", team: "Lesedi Audit", primaryFinding: null, findingDetail: null, noAccessReason: "Gate locked", normalisation: "NAv", normalisationActions: [], photoUrls: [] }),
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

  // The only thing under the three sections: Summary Stats. The control lines
  // were withdrawn in 1.11.0 - Zamo never asked for them.
  const after = sheet.slice(25).filter((cells) => cells.length);
  assert.deepEqual(after[0], ["SEPTEMBER 2026 - SUMMARY STATS"]);
  assert.deepEqual(after[1], ["ITEM", "LINE", "COUNT"]);
  assert.equal(after[2][1], "TRANSACTIONS THIS PERIOD, EVERY TYPE");
  assert.equal(after.at(-1)[1], "EXCEPTIONS NOT COUNTED, NO METER CREATED");
  assert.ok(!after.some((cells) => String(cells[1]).includes("CONTROL LINE")), "no control lines");
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
  const all = septemberRows();
  const { workbook } = readWorkbook(
    makeDataset(all.filter((item) => item.hasAccess !== false), {
      isIncompleteMonth: false,
      noAccessRows: all.filter((item) => item.hasAccess === false),
    }),
  );
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

// GMR-R044
test("Summary Stats says why the numbers are what they are", () => {
  const payable = [
    row({ trnId: "A" }),
    row({ trnId: "B" }),
    row({ trnId: "C", trnType: "METER_DISCONNECTION", trnTypeLabel: "Meter Disconnection" }),
  ];
  const noAccessRows = [row({ trnId: "D", hasAccess: false, noAccessReason: "Property Locked", photoUrls: [] })];
  const { workbook } = readWorkbook(
    makeDataset(payable, {
      noAccessRows,
      droppedCaptures: [{ trnId: "E", trnTypeLabel: "Meter Discovery", captureDate: "2026-09-12T08:00:00.000Z", fieldWorkerName: "Thabo Worker", claimedMeterNo: "0714", reason: "The capture says a meter was created, but the meter is not there." }],
    }),
  );
  const sheet = XLSX.utils.sheet_to_json(workbook.Sheets["Field Stats"], { header: 1, defval: "" });
  const value = (label) => sheet.find((cells) => String(cells[1]).trim() === label)?.[2];

  assert.ok(sheet.some((cells) => String(cells[0]).includes("SUMMARY STATS")), "the section is there");
  assert.equal(value("TRANSACTIONS THIS PERIOD, EVERY TYPE"), 4);
  assert.equal(value("METER DISCOVERY"), 3, "generated from the types actually present");
  assert.equal(value("METER DISCONNECTION"), 1);
  assert.equal(value("NO ACCESS - LISTED ON THE NO ACCESS SHEET"), 1);
  assert.equal(value("ROWS ON THE FIELD DATA SHEET"), 3);
  assert.equal(value("METER AUDIT TOTAL"), 3);
  assert.equal(value("EXCEPTIONS NOT COUNTED, NO METER CREATED"), 1);
  assert.ok(!sheet.some((cells) => String(cells[0]).includes("CONTROL LINES")), "the control lines are withdrawn");
});

// GMR-R019 lives on the Exceptions sheet now that the control lines are gone.
test("an illegal connection found without a batch is allowed, and the rest is listed", () => {
  const rows = [
    row({ trnId: "A", batchId: "AD HOC", primaryFinding: "Illegally Connected", findingDetail: "Bypassed" }),
    row({ trnId: "B", batchId: "AD HOC" }),
    row({ trnId: "C", batchId: "TB_9" }),
  ];
  const { workbook } = readWorkbook(makeDataset(rows));
  const sheet = XLSX.utils.sheet_to_json(workbook.Sheets.Exceptions, { header: 1, defval: "" });
  const listed = sheet.filter((cells) => cells[1] === "Work with no batch");

  assert.equal(listed.length, 1, "the illegal connection found along the way is allowed, and not listed");
  assert.equal(listed[0][3], "B");
  assert.equal(listed[0][2], "Yes", "it is still counted on Field Data");
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
