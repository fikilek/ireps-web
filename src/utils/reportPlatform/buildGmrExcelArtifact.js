// General Monthly Report workbook (GMR 1.1.0, schema 1.0.1): exactly two
// worksheets, Field Data and Field Stats (GMR-R001), written compressed
// (GMR-R002).
import * as XLSX from "xlsx";

import { GMR_NAV, buildGmrFieldStatsModel } from "./gmrFieldStatsModel.js";

export const GMR_SHEET_NAMES = Object.freeze(["Field Data", "Field Stats"]);

const JOHANNESBURG_OFFSET_MS = 2 * 60 * 60 * 1000;

function column(key, header, type = "text") {
  return { key, header, type };
}

// Schema section 4, in order.
export const GMR_FIELD_DATA_COLUMNS = Object.freeze([
  column("captureDate", "Capture Date", "datetime"),
  column("trnId", "Transaction Number"),
  column("trnTypeLabel", "Transaction Type"),
  column("channel", "Channel"),
  column("fieldWorkerName", "Field Worker"),
  column("team", "Team"),
  column("batchId", "Batch ID"),
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
  column("salesCategory", "Sales Category"),
  column("primaryFinding", "Primary Finding"),
  column("findingDetail", "Finding Explanation"),
  column("normalisation", "Normalisation"),
  column("noActionReason", "Reason For Not Acting"),
  column("sealNo", "Seal No"),
  column("fieldComment", "Comment"),
  column("visibility", "Visibility"),
  column("onVendingList", "On Vending List"),
  column("startedFrom", "Started From"),
  column("followUpRequired", "Follow-up Required"),
  column("followUpStatus", "Follow-up Status"),
  column("followUpTrnId", "Follow-up Transaction"),
]);

export function getGmrFieldDataColumns(photoColumnCount = 0) {
  const photos = Array.from({ length: Math.max(0, Number(photoColumnCount) || 0) }, (_, index) =>
    column(`photoUrls.${index}`, `Photo ${index + 1}`, "photo"),
  );
  return [...GMR_FIELD_DATA_COLUMNS, ...photos];
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
  if (item.type === "datetime") return toJohannesburgExcelSerial(value) ?? GMR_NAV;
  if (value === null || value === undefined || value === "") return GMR_NAV;
  return value;
}

function titleLine(dataset, sheetLabel) {
  const lmName = dataset?.municipality?.lmName || "Endumeni";
  const period = dataset?.reportingPeriodLabel || dataset?.reportMonth || GMR_NAV;
  const incomplete = dataset?.isIncompleteMonth ? " (incomplete month)" : "";
  return `${lmName} — ${period}${incomplete} — General Monthly Report: ${sheetLabel}`;
}

function monthStatement(dataset) {
  return `Field transactions counted in the month they reached the server, South African time. Generated ${formatJohannesburg(dataset?.generatedAt)}.`;
}

function buildFieldDataSheet(dataset) {
  const rows = dataset.fieldRows;
  const columns = getGmrFieldDataColumns(dataset.photoColumnCount);
  const aoa = [
    [titleLine(dataset, "Field Data")],
    [monthStatement(dataset)],
    columns.map((item) => item.header),
    ...rows.map((row) => columns.map((item) => cellValue(row, item))),
  ];
  const headerRow = 2;

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet["!autofilter"] = {
    ref: `A${headerRow + 1}:${XLSX.utils.encode_col(columns.length - 1)}${headerRow + 1 + rows.length}`,
  };
  worksheet["!cols"] = columns.map((item) => ({
    wch: item.type === "photo" ? 10 : /Comment|Explanation|Reason|Normalisation|Name/.test(item.header) ? 32 : Math.max(12, item.header.length + 2),
  }));

  rows.forEach((row, rowIndex) => {
    columns.forEach((item, columnIndex) => {
      const cell = worksheet[XLSX.utils.encode_cell({ r: headerRow + 1 + rowIndex, c: columnIndex })];
      if (!cell) return;
      if (item.type === "datetime" && typeof cell.v === "number") cell.z = "yyyy-mm-dd hh:mm";
      if (item.type === "photo") {
        const url = getPath(row, item.key);
        if (url) cell.l = { Target: String(url), Tooltip: `Open ${item.header}` };
      }
    });
  });

  return worksheet;
}

function buildStatsBlock(aoa, title, model, columnsKey, mapKey) {
  const names = model[columnsKey];
  const labels = columnsKey === "workers" ? names.map((key) => model.workerLabels.get(key) || key) : names;
  aoa.push([title, "", ...labels, "TOTAL"]);
  model.groups.forEach((group) => {
    aoa.push([group.name.toUpperCase()]);
    group.rows.forEach((item) => {
      aoa.push(["", item.label, ...names.map((name) => item[mapKey].get(name) || 0), item.total]);
    });
  });
  aoa.push([]);
}

function buildFieldStatsSheet(dataset) {
  const model = buildGmrFieldStatsModel(dataset);
  const aoa = [
    [titleLine(dataset, "Field Stats")],
    [monthStatement(dataset)],
    [`Payable total: ${model.payableTotal}`],
    [],
  ];

  buildStatsBlock(aoa, "PER FIELD WORKER", model, "workers", "byWorker");
  buildStatsBlock(aoa, "PER TEAM", model, "teams", "byTeam");

  aoa.push(["CONTROL LINES", "", "COUNT"]);
  model.controlLines.forEach((line, index) => {
    aoa.push([index + 1, line.label, line.count]);
  });

  if (Array.isArray(dataset.unplaced) && dataset.unplaced.length) {
    aoa.push([]);
    aoa.push(["NOT ON FIELD DATA", "Transaction Number", "Reason"]);
    dataset.unplaced.forEach((item) => aoa.push(["", item.trnId, item.reason]));
  }

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  const width = Math.max(model.workers.length, model.teams.length);
  worksheet["!cols"] = [{ wch: 30 }, { wch: 48 }, ...Array.from({ length: width }, () => ({ wch: 16 })), { wch: 10 }];
  return { worksheet, model };
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
