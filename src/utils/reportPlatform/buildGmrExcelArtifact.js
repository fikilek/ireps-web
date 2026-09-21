// General Monthly Report workbook (GMR 1.2.0, schema 1.1.0): exactly two
// worksheets, Field Data and Field Stats (GMR-R001), written compressed
// (GMR-R002).
import * as XLSX from "xlsx";

import { GMR_NAV, buildGmrFieldStatsModel, buildZamoFieldStats } from "./gmrFieldStatsModel.js";

export const GMR_SHEET_NAMES = Object.freeze(["Field Data", "Field Stats"]);

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
  column("primaryFinding", "Primary Finding"),
  column("findingDetail", "Finding Explanation"),
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

function periodLabel(dataset) {
  const period = String(dataset?.reportingPeriodLabel || dataset?.reportMonth || "GMR").toUpperCase();
  return dataset?.isIncompleteMonth ? `${period} (INCOMPLETE)` : period;
}

// Zamo's column widths.
function zamoWidth(item) {
  const base = Math.max(String(item.header || "").length + 2, 12);
  const wide = /Notes|Address|Finding Detail|Reason|Definition/i.test(item.header || "");
  return { wch: Math.min(wide ? Math.max(base, 28) : base, wide ? 42 : 24) };
}

function buildFieldDataSheet(dataset) {
  const rows = dataset.fieldRows;
  const columns = getGmrFieldDataColumns(dataset.photoColumnCount);
  const aoa = [
    columns.map((item) => item.header),
    ...rows.map((row) => columns.map((item) => cellValue(row, item))),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet["!autofilter"] = {
    ref: `A1:${XLSX.utils.encode_col(columns.length - 1)}${Math.max(1, aoa.length)}`,
  };
  worksheet["!cols"] = columns.map(zamoWidth);

  rows.forEach((row, rowIndex) => {
    columns.forEach((item, columnIndex) => {
      const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex + 1, c: columnIndex })];
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

// Zamo's Field Stats, exactly as before (GMR-R025).
function appendZamoFieldStats(aoa, merges, stats, period) {
  const lastColumnIndex = Math.max(stats.workers.length, stats.teams.length) + 2;
  const row = (index, label, names, counts, total) =>
    [index, label, ...names.map((name) => counts.get(name) || 0), total];

  merges.push({ s: { r: aoa.length, c: 0 }, e: { r: aoa.length, c: lastColumnIndex } });
  aoa.push([`${period} - METER AUDIT`]);
  aoa.push(["ITEM", "METER STATUS", ...stats.workers, "TOTAL"]);
  stats.statuses.forEach((status, index) => {
    const counts = stats.statusByWorker.get(status);
    aoa.push(row(index + 1, status, stats.workers, counts, sumOf(counts)));
  });
  aoa.push(row("", "TOTAL: METER DISCOVERY RECORDS", stats.workers, stats.workerTotals, stats.records));
  const auditEndRow = aoa.length;
  aoa.push([]);

  merges.push({ s: { r: aoa.length, c: 0 }, e: { r: aoa.length, c: lastColumnIndex } });
  aoa.push([`${period} - NORMALISATION`]);
  stats.normalisations.forEach((label, index) => {
    const counts = stats.normalisationByWorker.get(label);
    aoa.push(row(index + 1, label, stats.workers, counts, sumOf(counts)));
  });
  aoa.push(row("", "TOTAL: NORMALISATION", stats.workers, stats.workerTotals, stats.records));

  aoa.push([]);
  aoa.push([]);
  aoa.push(["Teams", "METER STATUS", ...stats.teams, "TOTAL"]);
  stats.statuses.forEach((status, index) => {
    const counts = stats.statusByTeam.get(status);
    aoa.push(row(index + 1, status, stats.teams, counts, sumOf(counts)));
  });
  aoa.push(row("", "TOTAL: METER DISCOVERY RECORDS", stats.teams, stats.teamTotals, stats.records));

  return { auditEndRow };
}

// The counts the rules add, below Zamo's Teams block.
function appendExtraCounts(aoa, model, period) {
  const workerNames = model.workers.map((key) => model.workerLabels.get(key) || key);
  const lineRow = (index, item, keys, map) => [index, item.label, ...keys.map((key) => item[map].get(key) || 0), item.total];

  model.blocks.forEach((block) => {
    aoa.push([]);
    aoa.push([]);
    aoa.push([`${period} - ${block.title}`]);
    aoa.push(["ITEM", block.column, ...workerNames, "TOTAL"]);
    block.lines.forEach((item, index) => aoa.push(lineRow(index + 1, item, model.workers, "byWorker")));
    if (block.total) aoa.push(lineRow("", block.total, model.workers, "byWorker"));
    aoa.push([]);
    aoa.push(["Teams", block.column, ...model.teams, "TOTAL"]);
    block.lines.forEach((item, index) => aoa.push(lineRow(index + 1, item, model.teams, "byTeam")));
    if (block.total) aoa.push(lineRow("", block.total, model.teams, "byTeam"));
  });

  aoa.push([]);
  aoa.push([]);
  aoa.push([`${period} - CONTROL LINES`]);
  aoa.push(["ITEM", "CONTROL LINE", "COUNT"]);
  model.controlLines.forEach((line, index) => aoa.push([index + 1, line.label, line.count]));
}

function buildFieldStatsSheet(dataset) {
  const period = periodLabel(dataset);
  const stats = buildZamoFieldStats(dataset);
  const model = buildGmrFieldStatsModel(dataset);
  const aoa = [];
  const merges = [];

  const { auditEndRow } = appendZamoFieldStats(aoa, merges, stats, period);
  appendExtraCounts(aoa, model, period);

  if (Array.isArray(dataset.unplaced) && dataset.unplaced.length) {
    aoa.push([]);
    aoa.push(["NOT ON FIELD DATA", "Transaction Number", "Reason"]);
    dataset.unplaced.forEach((item) => aoa.push(["", item.trnId, item.reason]));
  }

  aoa.push([]);
  aoa.push([monthStatement(dataset)]);

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet["!merges"] = merges;
  const width = Math.max(stats.workers.length, stats.teams.length, model.workers.length, model.teams.length);
  worksheet["!cols"] = [{ wch: 8 }, { wch: 42 }, ...Array.from({ length: width }, () => ({ wch: 18 })), { wch: 12 }];
  worksheet["!autofilter"] = { ref: `A2:${XLSX.utils.encode_col(stats.workers.length + 2)}${Math.max(2, auditEndRow)}` };
  return { worksheet, model, stats };
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return Uint8Array.from(value || []);
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

  const bytes = toUint8Array(
    XLSX.write(workbook, { bookType: "xlsx", type: "array", compression: true }),
  );

  return { format: "XLSX", fileName, bytes, stats: stats.model };
}
