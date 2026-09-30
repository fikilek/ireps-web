// General Monthly Report workbook (GMR 1.2.0, schema 1.1.0): exactly two
// worksheets, Field Data and Field Stats (GMR-R001), written compressed
// (GMR-R002).
import * as XLSX from "xlsx";

import { GMR_NAV, buildGmrFieldStatsModel, buildZamoFieldStats } from "./gmrFieldStatsModel.js";

// The report is about Meter Discovery. The two sheets that list records say so
// in their name and in their first row, because a tab name is lost the moment
// someone copies a sheet into an email (owner, 30 September 2026).
export const GMR_SHEET_NAMES = Object.freeze(["Field Data - MD", "Field Stats", "No Access", "Exceptions"]);

export const GMR_DISCOVERY = "METER_DISCOVERY";

export function gmrDiscoveryRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row?.trnType === GMR_DISCOVERY);
}

const JOHANNESBURG_OFFSET_MS = 2 * 60 * 60 * 1000;

function column(key, header, type = "text") {
  return { key, header, type };
}

// Schema 1.1.0 section 4. Zamo's Field Data columns come first, exactly as he
// uses them: same names, same order, Photo 1 to Photo 6. The columns the rules
// add follow Photo 6, and any seventh or later photograph comes last.
export const GMR_ZAMO_FIELD_DATA_COLUMNS = Object.freeze([
  column("captureDate", "Capture Date", "date"),
  column("fieldWorkerName", "Field Worker Name"),
  column("salesCategory", "Sales Category"),
  column("batchId", "Batch ID", "batch"),
  column("streetNo", "Street No"),
  column("streetName", "Street Name"),
  column("streetType", "Street Type"),
  column("suburbName", "SuburbName"),
  column("gpsCoordinates", "GPS Coordinates"),
  column("ward", "Ward"),
  column("propertyType", "Property Type"),
  column("propertyName", "Property Name"),
  column("propertyUnitNo", "Unit No"),
  column("meterMode", "Meter Mode"),
  column("meterPhase", "Meter Phase"),
  column("meterPlacement", "Meter Placement"),
  column("originalProjectMeterNo", "Original / Project Meter Number"),
  column("fieldFoundMeterNo", "Field-Found Meter Number"),
  column("sameDifferent", "Same/Different"),
  column("remainingCredit", "Remaining Credit"),
  column("primaryFinding", "Anomaly"),
  column("findingDetail", "Anomaly Detail"),
  column("normalisation", "Normalisation"),
  column("sealNo", "Seal No"),
  column("fieldComment", "Comment"),
  ...Array.from({ length: 6 }, (_, index) => column(`photoUrls.${index}`, `Photo ${index + 1}`, "photo")),
]);

export const GMR_EXTRA_FIELD_DATA_COLUMNS = Object.freeze([
  column("trnTypeLabel", "Transaction Type"),
  column("trnId", "Transaction Number"),
  column("noActionReason", "Reason For Not Acting"),
  column("followUpRequired", "Follow-up Required"),
  column("followUpStatus", "Follow-up Status"),
  column("followUpTrnId", "Follow-up Transaction"),
  column("startedFrom", "Started From"),
  column("channel", "Channel"),
  column("team", "Team"),
  column("visibility", "Visibility"),
  column("onVendingList", "On Vending List"),
]);

export function getGmrFieldDataColumns(photoColumnCount = 0) {
  const morePhotos = Array.from({ length: Math.max(0, (Number(photoColumnCount) || 0) - 6) }, (_, index) =>
    column(`photoUrls.${index + 6}`, `Photo ${index + 7}`, "photo"),
  );
  return [...GMR_ZAMO_FIELD_DATA_COLUMNS, ...GMR_EXTRA_FIELD_DATA_COLUMNS, ...morePhotos];
}

function getPath(row, key) {
  return String(key)
    .split(".")
    .reduce((value, part) => (value === null || value === undefined ? undefined : value[part]), row);
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const EXCEL_EPOCH_OFFSET_DAYS = 25569;

// Excel has no time zone. The South African wall-clock time is written as an
// Excel serial number, so the browser's own time zone can never shift it.
export function toJohannesburgExcelSerial(iso) {
  const milliseconds = new Date(iso || "").getTime();
  if (!Number.isFinite(milliseconds)) return null;
  return (milliseconds + JOHANNESBURG_OFFSET_MS) / MILLISECONDS_PER_DAY + EXCEL_EPOCH_OFFSET_DAYS;
}

function formatJohannesburg(iso) {
  const milliseconds = new Date(iso || "").getTime();
  if (!Number.isFinite(milliseconds)) return GMR_NAV;
  const date = new Date(milliseconds + JOHANNESBURG_OFFSET_MS);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function cellValue(row, item) {
  const value = getPath(row, item.key);
  if (item.type === "photo") return value ? item.header : "";
  if (item.type === "date") return toJohannesburgExcelSerial(value) ?? GMR_NAV;
  if (item.type === "batch") return value === null || value === undefined || value === "" ? "AD HOC" : value;
  if (value === null || value === undefined || value === "") return GMR_NAV;
  return value;
}

function monthStatement(dataset) {
  return `Field transactions counted in the month they reached the server, South African time. Generated ${formatJohannesburg(dataset?.generatedAt)}.`;
}

// GMR-R037: the period is named wherever the report is named. The owner asked
// for the period and nothing else - no "(INCOMPLETE)" marker (30 Sep 2026).
function periodLabel(dataset) {
  return String(dataset?.periodLabel || dataset?.reportingPeriodLabel || dataset?.reportMonth || "GMR").toUpperCase();
}

function notForPaymentNotice(dataset) {
  return dataset?.isPaymentRecord === false
    ? dataset?.notForPaymentNotice ||
      "General Report — for looking only, never the record the municipality pays on."
    : null;
}

// Zamo's column widths.
function zamoWidth(item) {
  const base = Math.max(String(item.header || "").length + 2, 12);
  const wide = /Notes|Address|Finding Detail|Reason|Definition/i.test(item.header || "");
  return { wch: Math.min(wide ? Math.max(base, 28) : base, wide ? 42 : 24) };
}

function buildFieldDataSheet(dataset) {
  const rows = gmrDiscoveryRows(dataset.fieldRows);
  const columns = getGmrFieldDataColumns(dataset.photoColumnCount);
  // A General Report says so on its own first sheet, above the headings, so a
  // workbook that travels by email cannot be mistaken for the payment record.
  const notice = notForPaymentNotice(dataset);
  const aoa = [
    ...(notice ? [[`${periodLabel(dataset)} — ${notice}`]] : []),
    columns.map((item) => item.header),
    ...rows.map((row) => columns.map((item) => cellValue(row, item))),
  ];
  const headerRow = notice ? 1 : 0;

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet["!autofilter"] = {
    ref: `A${headerRow + 1}:${XLSX.utils.encode_col(columns.length - 1)}${Math.max(headerRow + 1, aoa.length)}`,
  };
  worksheet["!cols"] = columns.map(zamoWidth);

  rows.forEach((row, rowIndex) => {
    columns.forEach((item, columnIndex) => {
      const cell = worksheet[XLSX.utils.encode_cell({ r: headerRow + 1 + rowIndex, c: columnIndex })];
      if (!cell) return;
      if (item.type === "date" && typeof cell.v === "number") cell.z = "yyyy-mm-dd";
      if (item.type === "photo") {
        const url = getPath(row, item.key);
        if (url) cell.l = { Target: String(url), Tooltip: `Open ${item.header}` };
      }
    });
  });

  return worksheet;
}

function sumOf(counts) {
  return [...counts.values()].reduce((total, value) => total + value, 0);
}

// Zamo's Field Stats, exactly as he uses them: METER DISCOVERY, NORMALISATION and
// Teams, and nothing else on the sheet (owner, 25 September 2026).
function appendZamoFieldStats(aoa, merges, stats, period) {
  const lastColumnIndex = Math.max(stats.workers.length, stats.teams.length) + 2;
  const row = (index, label, names, counts, total) =>
    [index, label, ...names.map((name) => counts.get(name) || 0), total];

  merges.push({ s: { r: aoa.length, c: 0 }, e: { r: aoa.length, c: lastColumnIndex } });
  aoa.push(["Meter Discovery"]);
  stats.workerHeaderRow = aoa.length;
  aoa.push(["Individual FWR Report", "METER ANOMALY", ...stats.workers, "TOTAL"]);
  stats.statuses.forEach((status, index) => {
    const counts = stats.statusByWorker.get(status);
    aoa.push(row(index + 1, status, stats.workers, counts, sumOf(counts)));
  });
  aoa.push(row("", "TOTAL: METER DISCOVERY RECORDS", stats.workers, stats.workerTotals, stats.records));
  const auditEndRow = aoa.length;
  aoa.push([]);

  merges.push({ s: { r: aoa.length, c: 0 }, e: { r: aoa.length, c: lastColumnIndex } });
  aoa.push(["Normalisation"]);
  stats.normalisations.forEach((label, index) => {
    const counts = stats.normalisationByWorker.get(label);
    aoa.push(row(index + 1, label, stats.workers, counts, sumOf(counts)));
  });
  aoa.push(row("", "TOTAL: METER DISCOVERY NORMALISATION", stats.workers, stats.workerTotals, stats.records));

  aoa.push([]);
  aoa.push([]);
  aoa.push(["Teams Report", "METER ANOMALY", ...stats.teams, "TOTAL"]);
  stats.statuses.forEach((status, index) => {
    const counts = stats.statusByTeam.get(status);
    aoa.push(row(index + 1, status, stats.teams, counts, sumOf(counts)));
  });
  aoa.push(row("", "TOTAL: METER DISCOVERY RECORDS", stats.teams, stats.teamTotals, stats.records));

  stats.auditEndRow = auditEndRow;
}

function buildFieldStatsSheet(dataset) {
  const period = periodLabel(dataset);
  const stats = buildZamoFieldStats(dataset);
  const model = buildGmrFieldStatsModel(dataset);
  const aoa = [];
  const merges = [];
  const notice = notForPaymentNotice(dataset);
  if (notice) {
    aoa.push([notice]);
    aoa.push([]);
  }
  // The heading says which report this is: a General Report and a General
  // Monthly Report must never be mistaken for one another (owner, 30 Sep 2026).
  const rawPeriod = String(
    dataset?.periodLabel || dataset?.reportingPeriodLabel || dataset?.reportMonth || "",
  ).toUpperCase();
  const heading = dataset?.reportKind === "GR"
    ? `GR - ${rawPeriod}`
    : `GMR - ${rawPeriod} REPORT`;
  aoa.push([heading]);

  // GMR-R036: the three blocks count the same records three ways. If they
  // disagree the report is wrong and says so rather than printing.
  const auditTotal = stats.statuses.reduce((total, status) => total + sumOf(stats.statusByWorker.get(status)), 0);
  const normalisationTotal = stats.normalisations.reduce(
    (total, label) => total + sumOf(stats.normalisationByWorker.get(label)), 0);
  const teamsTotal = stats.statuses.reduce((total, status) => total + sumOf(stats.statusByTeam.get(status)), 0);
  if (auditTotal !== stats.records || normalisationTotal !== stats.records || teamsTotal !== stats.records) {
    throw new Error(
      `Field Stats does not balance: ${stats.records} discovery records, ` +
      `Meter Audit ${auditTotal}, Normalisation ${normalisationTotal}, Teams ${teamsTotal}. ` +
      "The report was not produced.",
    );
  }

  appendZamoFieldStats(aoa, merges, stats, period);

  // The extra counts the owner agreed to: one block of control lines under his
  // three sections, and nothing else on the sheet.
  aoa.push([]);
  aoa.push([]);
  aoa.push(["Summary Stats"]);
  aoa.push(["ITEM", "LINE", "COUNT"]);
  model.summaryLines.forEach((line, index) => aoa.push([index + 1, line.label, line.count]));

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet["!merges"] = merges;
  const width = Math.max(stats.workers.length, stats.teams.length);
  worksheet["!cols"] = [{ wch: 8 }, { wch: 42 }, ...Array.from({ length: width }, () => ({ wch: 18 })), { wch: 12 }];
  worksheet["!autofilter"] = {
    ref: `A${stats.workerHeaderRow + 1}:${XLSX.utils.encode_col(stats.workers.length + 2)}${stats.auditEndRow}`,
  };
  return { worksheet, model, stats };
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return Uint8Array.from(value || []);
}

// GMR-R041: the third worksheet. The counts stay on Field Stats; every
// exception behind them is written here, one row each, with its explanation.
// Zamo's two sheets are left exactly as he uses them.
export const GMR_EXCEPTION_COLUMNS = Object.freeze([
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

export function buildExceptionsSheet(dataset, model) {
  const period = periodLabel(dataset);
  const aoa = [];
  if (dataset?.notForPaymentNotice) {
    aoa.push([dataset.notForPaymentNotice]);
    aoa.push([]);
  }
  aoa.push([`${period} - EXCEPTIONS (ALL TRANSACTIONS)`]);
  aoa.push(["Every exception this report found, one row each. The counts are on Field Stats."]);
  aoa.push([]);
  aoa.push([...GMR_EXCEPTION_COLUMNS]);

  if (!model.exceptions.length) {
    aoa.push(["", "No exceptions found for this period."]);
  }

  model.exceptions.forEach((item, index) =>
    aoa.push([
      index + 1,
      item.kind,
      item.counted,
      item.trnId,
      item.trnTypeLabel,
      formatJohannesburg(item.captureDate),
      item.fieldWorkerName,
      item.meterNo,
      item.explanation,
    ]),
  );

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet["!cols"] = [
    { wch: 6 },
    { wch: 38 },
    { wch: 20 },
    { wch: 26 },
    { wch: 20 },
    { wch: 18 },
    { wch: 22 },
    { wch: 18 },
    { wch: 72 },
  ];
  return worksheet;
}

// GMR-R043: a no-access visit is not payable work, so it is not on Field Data.
// It is here, with the reason, and this sheet is where the No Access line on
// Field Stats is verified.
export const GMR_NO_ACCESS_COLUMNS = Object.freeze([
  "ITEM",
  "CAPTURE DATE",
  "FIELD WORKER",
  "TEAM",
  "ERF",
  "ADDRESS",
  "TRANSACTION TYPE",
  "TRANSACTION NUMBER",
  "REASON",
]);

function addressText(row) {
  const parts = [row?.streetNo, row?.streetName, row?.streetType, row?.suburbName]
    .map((part) => (part === null || part === undefined ? "" : String(part).trim()))
    .filter((part) => part && part !== GMR_NAV);
  return parts.length ? parts.join(" ") : GMR_NAV;
}

export function buildNoAccessSheet(dataset) {
  const period = periodLabel(dataset);
  const rows = Array.isArray(dataset?.noAccessRows) ? dataset.noAccessRows : [];
  const aoa = [];
  if (dataset?.notForPaymentNotice) {
    aoa.push([dataset.notForPaymentNotice]);
    aoa.push([]);
  }
  aoa.push([`${period} - NO ACCESS (ALL TRANSACTIONS)`]);
  aoa.push(["Every visit where the worker could not reach the meter, whatever transaction it was on. Filter Transaction Type to Meter Discovery for the number Field Stats counts."]);
  aoa.push([]);
  aoa.push([...GMR_NO_ACCESS_COLUMNS]);

  if (!rows.length) aoa.push(["", "No no-access visits in this period."]);

  rows.forEach((row, index) =>
    aoa.push([
      index + 1,
      formatJohannesburg(row?.captureDate),
      row?.fieldWorkerName || GMR_NAV,
      row?.team || GMR_NAV,
      row?.erfNo || GMR_NAV,
      addressText(row),
      row?.trnTypeLabel || row?.trnType || GMR_NAV,
      row?.trnId || GMR_NAV,
      row?.noAccessReason || GMR_NAV,
    ]),
  );

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet["!cols"] = [
    { wch: 6 },
    { wch: 18 },
    { wch: 22 },
    { wch: 18 },
    { wch: 12 },
    { wch: 38 },
    { wch: 20 },
    { wch: 26 },
    { wch: 40 },
  ];
  return worksheet;
}

export function buildGmrExcelArtifact({ dataset, fileName }) {
  if (!dataset || typeof dataset !== "object") {
    throw new TypeError("A General Monthly Report dataset is required.");
  }
  if (!Array.isArray(dataset.fieldRows)) {
    throw new TypeError("The General Monthly Report dataset has no Field Data rows.");
  }
  if (typeof fileName !== "string" || !fileName.endsWith(".xlsx")) {
    throw new TypeError("The General Monthly Report file name must end with .xlsx.");
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, buildFieldDataSheet(dataset), GMR_SHEET_NAMES[0]);
  const stats = buildFieldStatsSheet(dataset);
  XLSX.utils.book_append_sheet(workbook, stats.worksheet, GMR_SHEET_NAMES[1]);
  XLSX.utils.book_append_sheet(workbook, buildNoAccessSheet(dataset), GMR_SHEET_NAMES[2]);
  XLSX.utils.book_append_sheet(workbook, buildExceptionsSheet(dataset, stats.model), GMR_SHEET_NAMES[3]);

  const bytes = toUint8Array(
    XLSX.write(workbook, { bookType: "xlsx", type: "array", compression: true }),
  );

  return { format: "XLSX", fileName, bytes, stats: stats.model };
}
