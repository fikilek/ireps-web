import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

import {
  buildGeneralMonthlyManagedReport,
  createGeneralMonthlyReportManagedGenerator,
} from "../src/pages/reports/generalMonthlyReportArtifact.js";
import {
  GMR_FIELD_DATA_COLUMNS,
  GMR_SHEET_NAMES,
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
    normalisation: "none",
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
    normalisationActions: ["none"],
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

test("Field Data states the month and carries the schema columns in order, then one photo column per photo", () => {
  const { workbook } = readWorkbook(makeDataset());
  const sheet = workbook.Sheets["Field Data"];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  assert.match(rows[0][0], /^Endumeni — September 2026 \(incomplete month\) — General Monthly Report: Field Data$/);
  assert.match(rows[1][0], /month they reached the server, South African time\. Generated 2026-09-21 12:05\./);
  assert.deepEqual(rows[2], [...GMR_FIELD_DATA_COLUMNS.map((item) => item.header), "Photo 1", "Photo 2"]);
  assert.equal(GMR_FIELD_DATA_COLUMNS.length, 36);
  assert.equal(rows[2][1], "Transaction Number");
  assert.equal(rows[3][1], "TRN_MD_1");
});

test("Field Data writes NAv for what the record does not hold, South African time, and photo links", () => {
  const rows = [row(), row({ trnId: "LATE", captureDate: "2026-09-30T21:30:00.000Z" })];
  const artifact = buildGmrExcelArtifact({ dataset: makeDataset(rows), fileName: "gmr.xlsx" });
  // Read the saved bytes back, as Excel would, whatever this machine's time zone.
  const workbook = XLSX.read(artifact.bytes, { type: "array", cellNF: true });
  const sheet = workbook.Sheets["Field Data"];
  const header = XLSX.utils.sheet_to_json(sheet, { header: 1 })[2];
  const cellFor = (name, r = 3) => sheet[XLSX.utils.encode_cell({ r, c: header.indexOf(name) })];
  // The text Excel shows, from the stored number and its stored format.
  const shown = (cell) => cell.w;

  assert.equal(cellFor("Property Name").v, "NAv");
  assert.equal(cellFor("Reason For Not Acting").v, "NAv");
  assert.equal(shown(cellFor("Capture Date")), "2026-09-10 10:00", "08:00 UTC is 10:00 in South Africa");
  assert.equal(shown(cellFor("Capture Date", 4)), "2026-09-30 23:30", "late on the last day stays in the month");
  assert.equal(cellFor("Photo 2").v, "Photo 2");
  assert.equal(cellFor("Photo 2").l.Target, "https://example.test/2.jpg");
});

test("a month with no field work still makes a report", () => {
  const { workbook } = readWorkbook(makeDataset([]));
  assert.deepEqual(workbook.SheetNames, [...GMR_SHEET_NAMES]);
  const managed = buildGeneralMonthlyManagedReport({ dataset: makeDataset([]), generatedAt: new Date("2026-09-21T10:05:00.000Z") });
  assert.equal(managed.metadata.itemCount, 0);
});

test("Field Stats keeps None for Meter Ok, counts no action by reason, and splits suspicions", () => {
  const rows = [
    row({ trnId: "A" }),
    row({ trnId: "B", findingGroup: "Meter Ok · Suspicion", findingDetail: "Bypass Suspicion" }),
    row({
      trnId: "C",
      primaryFinding: "Illegally Connected",
      findingGroup: "Illegally Connected",
      normalisationActions: ["none"],
      noActionReason: "Not recorded - captured before this rule",
    }),
    row({
      trnId: "D",
      fieldWorkerName: "Sipho Worker",
      team: "Team B",
      primaryFinding: "Illegally Connected",
      findingGroup: "Illegally Connected",
      normalisationActions: ["Disconnect meter", "Tamper removed"],
      followUpRequired: "Meter Disconnection",
      followUpStatus: "Completed",
    }),
    row({
      trnId: "E",
      primaryFinding: "Illegally Connected",
      findingGroup: "Illegally Connected",
      normalisationActions: ["Disconnect meter"],
      followUpRequired: "Meter Disconnection",
      followUpStatus: "No disconnection record",
    }),
    row({ trnId: "F", trnType: "METER_DISCONNECTION", trnTypeLabel: "Meter Disconnection", batchId: "AD HOC", findingGroup: null, normalisationActions: [], team: "Team B", fieldWorkerName: "Sipho Worker" }),
    row({ trnId: "G", hasAccess: false, primaryFinding: "No Access", findingGroup: "No Access", normalisationActions: [], batchId: "AD HOC", photoUrls: [] }),
  ];
  const model = buildGmrFieldStatsModel(makeDataset(rows));
  const find = (group, label) => model.groups.find((item) => item.name === group).rows.find((item) => item.label === label);

  assert.equal(find("Transactions", "Payable total").total, 7);
  assert.equal(find("Transactions", "Meter Disconnection").total, 1);
  assert.equal(find("Findings", "Meter Ok · Operationally Ok").total, 1);
  assert.equal(find("Findings", "Meter Ok · Suspicion").total, 1);
  assert.equal(find("Findings", "Illegally Connected").total, 3);
  assert.equal(find("Findings", "No Access").total, 1);
  assert.equal(find("Normalisation", "None").total, 2, "None belongs to the Meter Ok rows only");
  assert.equal(find("Normalisation", "No action taken — Not recorded - captured before this rule").total, 1);
  assert.equal(find("Normalisation", "Disconnect meter").total, 2);
  assert.equal(find("Normalisation", "Tamper removed").total, 1);
  assert.equal(find("Disconnections called for", "Called for").total, 2);
  assert.equal(find("Disconnections called for", "Completed").total, 1);
  assert.equal(find("Disconnections called for", "No disconnection record").total, 1);
  assert.equal(find("Outside batches (AD HOC)", "Meter Disconnection").total, 1);

  const byWorker = find("Transactions", "Payable total").byWorker;
  const byTeam = find("Transactions", "Payable total").byTeam;
  const sum = (map) => [...map.values()].reduce((total, value) => total + value, 0);
  assert.equal(sum(byWorker), 7);
  assert.equal(sum(byTeam), 7);
  assert.equal(byTeam.get("Team B"), 2);

  const control = Object.fromEntries(model.controlLines.map((line) => [line.label, line.count]));
  assert.equal(control["Submitted this month but not on Field Data (must be 0)"], 0);
  assert.equal(control["Transactions without a batch (AD HOC)"], 2);
});

test("None is for Meter Ok only, and workers are told apart by user, not by name", () => {
  const rows = [
    row({ trnId: "A", fieldWorkerUid: "U1", fieldWorkerName: "Sipho Dlamini" }),
    row({ trnId: "B", fieldWorkerUid: "U2", fieldWorkerName: "Sipho Dlamini" }),
    row({
      trnId: "C",
      meterType: "WATER",
      primaryFinding: "Illegally Connected",
      findingGroup: "Illegally Connected",
      normalisationActions: ["NONE"],
      onVendingList: null,
    }),
  ];
  const model = buildGmrFieldStatsModel(makeDataset(rows));
  const none = model.groups.find((group) => group.name === "Normalisation").rows.find((item) => item.label === "None");
  assert.equal(none.total, 2, "a water finding with NONE is not a Meter Ok None");
  assert.equal(model.workers.length, 2, "two people with the same name stay two columns");
  const labels = model.workers.map((key) => model.workerLabels.get(key));
  assert.equal(new Set(labels).size, 2);
  assert.ok(labels.every((label) => label.startsWith("Sipho Dlamini")));
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

  assert.equal(control["Submitted this month but not on Field Data (must be 0)"], 1);
  assert.equal(control["Meters found that are not on the vending list"], 1);
  assert.equal(control["Visibility mark that disagrees with Sales"], 1);
  assert.equal(control["Transactions with no Sales Category"], 2, "water is never on the vending list");
  assert.equal(control["Missing GPS, photograph or normalisation answer"], 1);
  assert.equal(control["Workers whose team could not be resolved"], 1);
});

test("the Field Stats sheet lists the work not placed on Field Data", () => {
  const { workbook } = readWorkbook(makeDataset([row()], { unplaced: [{ trnId: "TRN_X", reason: "The submission time cannot be read." }] }));
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Field Stats"], { header: 1, defval: "" });
  const headerIndex = rows.findIndex((item) => item[0] === "NOT ON FIELD DATA");
  assert.ok(headerIndex > 0);
  assert.deepEqual(rows[headerIndex + 1].slice(1, 3), ["TRN_X", "The submission time cannot be read."]);
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
