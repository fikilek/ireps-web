import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useGetTcUploadByIdQuery } from "../../redux/tcApi";
import {
  fakeTcReport,
  fakeTcReportRows,
} from "./fakeTcFinalReportData";

const FILTER_OPTIONS = [
  { value: "ALL", label: "All Rows" },
  { value: "SUCCESSFUL", label: "Successful" },
  { value: "NO_ACCESS", label: "No Access" },
  { value: "NO_GEOFENCE", label: "No Geofence" },
  { value: "NOT_FOUND", label: "Meter Not Found" },
  { value: "NOT_ELIGIBLE", label: "Not Eligible" },
  { value: "READY_FOR_BGO", label: "Ready for BGO" },
  { value: "DATA_MISMATCH", label: "Data Mismatch" },
  { value: "PENDING", label: "Pending" },
];

const SECTION_LABELS = [
  "Upload Data",
  "iREPS Data",
  "BGO / TRN",
  "Execution",
  "Flags",
  "Final Decision",
];

function valueOrNav(value) {
  if (value === null || value === undefined || value === "") return "NAv";
  return value;
}

function getReportStatus(upload = {}) {
  return String(
    upload?.report?.status ||
      upload?.finalReport?.status ||
      upload?.reportStatus ||
      fakeTcReport.status ||
      "DRAFT",
  )
    .trim()
    .toUpperCase();
}

function getFlagCodes(row) {
  return Array.isArray(row?.flags?.flagCodes) ? row.flags.flagCodes : [];
}

function hasDataMismatch(row) {
  return [
    row?.flags?.meterNoMatch,
    row?.flags?.meterPhaseMatch,
    row?.flags?.meterTypeMatch,
    row?.flags?.linkedAccountNoMatch,
    row?.flags?.premiseAddressMatch,
    row?.flags?.premisePropertyTypeMatch,
    row?.flags?.wardNoMatch,
    row?.flags?.geofenceMatch,
    row?.flags?.meterStatusMatch,
    row?.flags?.erfNoMatch,
  ].some((value) => value === false);
}

function rowMatchesFilter(row, filter) {
  const flagCodes = getFlagCodes(row);
  const finalCode = String(row?.finalDecision?.code || "").toUpperCase();
  const reasonCode = String(row?.finalDecision?.reasonCode || "").toUpperCase();
  const readinessState = String(row?.tc?.readinessState || "").toUpperCase();
  const executionOutcome = String(row?.execution?.outcome || "").toUpperCase();

  if (filter === "ALL") return true;
  if (filter === "SUCCESSFUL") return finalCode === "SUCCESSFUL";
  if (filter === "NO_ACCESS") return executionOutcome === "NO_ACCESS" || flagCodes.includes("NO_ACCESS");
  if (filter === "NO_GEOFENCE") return readinessState === "NEEDS_GEOFENCE" || flagCodes.includes("NO_GEOFENCE");
  if (filter === "NOT_FOUND") return readinessState === "NOT_FOUND" || flagCodes.includes("METER_NOT_FOUND");
  if (filter === "NOT_ELIGIBLE") return readinessState === "NOT_ELIGIBLE" || reasonCode.includes("NOT_ELIGIBLE");
  if (filter === "READY_FOR_BGO") return Boolean(row?.tc?.readyForBgo) && !row?.bgo?.used;
  if (filter === "DATA_MISMATCH") return hasDataMismatch(row);
  if (filter === "PENDING") return finalCode === "PENDING";

  return true;
}

function getDecisionTone(code) {
  const safeCode = String(code || "").toUpperCase();

  if (safeCode === "SUCCESSFUL") return "success";
  if (safeCode === "UNSUCCESSFUL") return "danger";
  if (safeCode === "BLOCKED") return "warning";
  if (safeCode === "PENDING") return "neutral";

  return "neutral";
}

function getBooleanLabel(value) {
  if (value === true) return "YES";
  if (value === false) return "NO";
  return "NAv";
}

function getGeofenceNames(row) {
  const refs = Array.isArray(row?.ireps?.geofenceRefs)
    ? row.ireps.geofenceRefs
    : [];

  if (refs.length === 0) return "NAv";

  return refs.map((item) => item?.name || item?.id || "NAv").join(", ");
}


function normalizeComparableValue(value) {
  return String(valueOrNav(value)).trim().toUpperCase();
}

function valuesAreDifferent(leftValue, rightValue) {
  return normalizeComparableValue(leftValue) !== normalizeComparableValue(rightValue);
}

function getComparisonRows(row) {
  const comparisonRows = [
    {
      key: "meterNo",
      label: "Meter No",
      uploadValue: row?.upload?.meterNo,
      resultValue: row?.ireps?.astNo,
      resultLabel: "iREPS AST",
    },
    {
      key: "meterPhase",
      label: "Meter Phase",
      uploadValue: row?.upload?.meterPhase,
      resultValue: row?.ireps?.meterPhase,
      resultLabel: "iREPS AST",
    },
    {
      key: "meterType",
      label: "Meter Type",
      uploadValue: row?.upload?.meterType,
      resultValue: row?.ireps?.meterType,
      resultLabel: "iREPS AST",
    },
    {
      key: "linkedAccountNo",
      label: "Linked Account No",
      uploadValue: row?.upload?.linkedAccountNo,
      resultValue: row?.ireps?.linkedAccountNo,
      resultLabel: "iREPS / account",
    },
    {
      key: "premiseAddress",
      label: "Premise Address",
      uploadValue: row?.upload?.premiseAddress,
      resultValue: row?.ireps?.premiseAddress,
      resultLabel: "iREPS premise",
    },
    {
      key: "premisePropertyType",
      label: "Premise Property Type",
      uploadValue: row?.upload?.premisePropertyType,
      resultValue: row?.ireps?.premisePropertyType,
      resultLabel: "iREPS premise",
    },
    {
      key: "wardNo",
      label: "Ward No",
      uploadValue: row?.upload?.wardNo,
      resultValue: row?.ireps?.wardNo,
      resultLabel: "iREPS AST",
    },
    {
      key: "geofence",
      label: "Geofence",
      uploadValue: row?.upload?.geofence,
      resultValue: getGeofenceNames(row),
      resultLabel: "iREPS geofence",
    },
    {
      key: "meterStatus",
      label: "Meter Status",
      uploadValue: row?.upload?.meterStatus,
      resultValue: row?.execution?.finalMeterStatus || row?.ireps?.meterStatus,
      resultLabel: row?.execution?.finalMeterStatus
        ? "Execution final"
        : "iREPS AST",
    },
    {
      key: "erfNo",
      label: "ERF No",
      uploadValue: row?.upload?.erfNo,
      resultValue: row?.ireps?.erfNo,
      resultLabel: "iREPS AST",
    },
  ];

  return comparisonRows.map((item) => ({
    ...item,
    isDifferent: valuesAreDifferent(item.uploadValue, item.resultValue),
  }));
}

function formatDateTime(value) {
  if (!value) return "NAv";

  try {
    return new Intl.DateTimeFormat("en-ZA", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch (error) {
    return value;
  }
}


function sanitizeFileName(value) {
  return String(value || "tc-final-report")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "tc-final-report";
}

function getMatchLabel(isDifferent) {
  return isDifferent ? "DIFFERENT" : "MATCH";
}

function getOperationSuccessfulLabel(row) {
  if (row?.finalDecision?.successful === true) return "YES";
  if (String(row?.finalDecision?.code || "").toUpperCase() === "PENDING") return "PENDING";
  return "NO";
}

function getFailureReason(row) {
  if (row?.finalDecision?.successful === true) return "NAv";

  return (
    row?.execution?.reason ||
    row?.finalDecision?.reasonCode ||
    row?.tc?.readinessReason ||
    "NAv"
  );
}

function getActionTakenResult(row) {
  const finalCode = String(row?.finalDecision?.code || "").toUpperCase();
  const readinessState = String(row?.tc?.readinessState || "").toUpperCase();
  const executionOutcome = String(row?.execution?.outcome || "").toUpperCase();

  if (row?.execution?.completed && executionOutcome === "SUCCESS") {
    return "Operation completed successfully";
  }

  if (row?.execution?.completed && executionOutcome === "NO_ACCESS") {
    return "No access recorded during execution";
  }

  if (readinessState === "NOT_FOUND") {
    return "Meter not found in iREPS";
  }

  if (readinessState === "NEEDS_GEOFENCE") {
    return "Blocked before work creation - geofence required";
  }

  if (readinessState === "NOT_ELIGIBLE") {
    return "Blocked before work creation - meter not eligible";
  }

  if (finalCode === "PENDING") {
    return "Pending work creation / execution";
  }

  return row?.finalDecision?.label || "NAv";
}

function getDownloadComment(row) {
  const flags = getFlagCodes(row);

  if (flags.length > 0) {
    return flags.join(", ");
  }

  if (row?.finalDecision?.successful === true) {
    return "No exception recorded";
  }

  return row?.finalDecision?.reasonCode || row?.tc?.readinessReason || "NAv";
}

function buildDraftDownloadColumns() {
  return [
    { key: "rowNo", label: "Row No", type: "static" },
    { key: "actionReasonUpload", label: "Action Reason - Upload", type: "static" },
    { key: "actionTakenResult", label: "Action Taken / Result", type: "static" },
    ...getComparisonRows({}).flatMap((item) => [
      {
        key: `${item.key}Upload`,
        label: `${item.label} - Upload`,
        type: "comparisonUpload",
        comparisonKey: item.key,
      },
      {
        key: `${item.key}Result`,
        label: `${item.label} - iREPS / Result`,
        type: "comparisonResult",
        comparisonKey: item.key,
      },
      {
        key: `${item.key}Match`,
        label: `${item.label} - Match`,
        type: "comparisonMatch",
        comparisonKey: item.key,
      },
    ]),
    { key: "operationSuccessful", label: "Operation Successful", type: "final" },
    { key: "failureReason", label: "Failure Reason", type: "final" },
    { key: "comment", label: "Comment", type: "final" },
    { key: "recommendedAction", label: "Recommended Action", type: "final" },
    { key: "finalDecision", label: "Final Decision", type: "final" },
    { key: "flags", label: "Flags", type: "final" },
  ];
}

function buildDraftDownloadRow(row) {
  const comparisonRows = getComparisonRows(row);
  const comparisonByKey = comparisonRows.reduce((accumulator, item) => {
    accumulator[item.key] = item;
    return accumulator;
  }, {});

  const output = {
    rowNo: row?.rowNo,
    actionReasonUpload: row?.upload?.actionReason,
    actionTakenResult: getActionTakenResult(row),
    operationSuccessful: getOperationSuccessfulLabel(row),
    failureReason: getFailureReason(row),
    comment: getDownloadComment(row),
    recommendedAction: row?.finalDecision?.requiredAction,
    finalDecision: row?.finalDecision?.label,
    flags: getFlagCodes(row).join(", ") || "NAv",
  };

  comparisonRows.forEach((item) => {
    output[`${item.key}Upload`] = valueOrNav(item.uploadValue);
    output[`${item.key}Result`] = valueOrNav(item.resultValue);
    output[`${item.key}Match`] = getMatchLabel(item.isDifferent);
  });

  return {
    values: output,
    comparisonByKey,
  };
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getExcelColumnName(index) {
  let columnNumber = index + 1;
  let name = "";

  while (columnNumber > 0) {
    const remainder = (columnNumber - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    columnNumber = Math.floor((columnNumber - 1) / 26);
  }

  return name;
}

function buildExcelCell(rowIndex, columnIndex, value, styleId = 0) {
  const ref = `${getExcelColumnName(columnIndex)}${rowIndex + 1}`;
  const safeValue = value === null || value === undefined ? "" : String(value);

  return `<c r="${ref}" t="inlineStr" s="${styleId}"><is><t>${escapeXml(safeValue)}</t></is></c>`;
}

function buildWorksheetXml(rows, styleRows, columnCount) {
  const columnXml = Array.from({ length: columnCount }).map((_, index) => {
    const columnNumber = index + 1;
    let width = 18;

    if (index === 0) width = 10;
    if (index === 1 || index === 2) width = 28;
    if (index >= columnCount - 6) width = 26;

    return `<col min="${columnNumber}" max="${columnNumber}" width="${width}" customWidth="1"/>`;
  }).join("");

  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) =>
      buildExcelCell(rowIndex, columnIndex, value, styleRows?.[rowIndex]?.[columnIndex] || 0),
    ).join("");

    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");

  const autoFilterEndColumn = getExcelColumnName(columnCount - 1);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${columnXml}</cols>
  <sheetData>${sheetRows}</sheetData>
  <autoFilter ref="A5:${autoFilterEndColumn}${rows.length}"/>
</worksheet>`;
}

function buildWorkbookXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Final Report" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

function buildWorkbookRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function buildRootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function buildContentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="5">
    <font><sz val="11"/><color rgb="FF334155"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF78350F"/><name val="Calibri"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1D4ED8"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF7ED"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFE2E8F0"/></left><right style="thin"><color rgb="FFE2E8F0"/></right><top style="thin"><color rgb="FFE2E8F0"/></top><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="8">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment wrapText="1" vertical="top"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment wrapText="1" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1"><alignment wrapText="1" vertical="top"/></xf>
    <xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1"><alignment wrapText="1" vertical="top"/></xf>
    <xf numFmtId="0" fontId="3" fillId="6" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1"><alignment wrapText="1" vertical="top"/></xf>
    <xf numFmtId="0" fontId="3" fillId="7" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1"><alignment wrapText="1" vertical="top"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function stringToUint8Array(text) {
  return new TextEncoder().encode(text);
}

function getCrcTable() {
  const table = [];

  for (let index = 0; index < 256; index += 1) {
    let crc = index;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }

    table[index] = crc >>> 0;
  }

  return table;
}

const CRC_TABLE = getCrcTable();

function crc32(bytes) {
  let crc = 0xffffffff;

  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(output, value) {
  output.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(output, value) {
  output.push(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

function appendBytes(output, bytes) {
  bytes.forEach((byte) => output.push(byte));
}

function createZipBlob(files) {
  const output = [];
  const centralDirectory = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = stringToUint8Array(file.name);
    const dataBytes = stringToUint8Array(file.content);
    const crc = crc32(dataBytes);
    const localHeaderOffset = offset;

    writeUint32(output, 0x04034b50);
    writeUint16(output, 20);
    writeUint16(output, 0x0800);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint32(output, crc);
    writeUint32(output, dataBytes.length);
    writeUint32(output, dataBytes.length);
    writeUint16(output, nameBytes.length);
    writeUint16(output, 0);
    appendBytes(output, nameBytes);
    appendBytes(output, dataBytes);

    offset = output.length;

    writeUint32(centralDirectory, 0x02014b50);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 0x0800);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint32(centralDirectory, crc);
    writeUint32(centralDirectory, dataBytes.length);
    writeUint32(centralDirectory, dataBytes.length);
    writeUint16(centralDirectory, nameBytes.length);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint32(centralDirectory, 0);
    writeUint32(centralDirectory, localHeaderOffset);
    appendBytes(centralDirectory, nameBytes);
  });

  const centralDirectoryOffset = output.length;
  appendBytes(output, centralDirectory);

  writeUint32(output, 0x06054b50);
  writeUint16(output, 0);
  writeUint16(output, 0);
  writeUint16(output, files.length);
  writeUint16(output, files.length);
  writeUint32(output, centralDirectory.length);
  writeUint32(output, centralDirectoryOffset);
  writeUint16(output, 0);

  return new Blob([new Uint8Array(output)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function buildDraftReportWorkbookBlob({ report, rows }) {
  const columns = buildDraftDownloadColumns();
  const downloadRows = rows.map(buildDraftDownloadRow);
  const rowValues = [];
  const styleRows = [];

  rowValues.push([`TC Final Report (${report.status})`, ...Array(columns.length - 1).fill("")]);
  styleRows.push(Array(columns.length).fill(2));

  rowValues.push(["TC ID", report.tcId, "File", report.fileName, "TRN Type", report.trnType, "LM", report.lmPcode, ...Array(Math.max(columns.length - 8, 0)).fill("")]);
  styleRows.push(Array(columns.length).fill(0));

  rowValues.push(["Report note", "LM-facing draft report. Internal BGO batch IDs and BGO row IDs are intentionally excluded.", ...Array(columns.length - 2).fill("")]);
  styleRows.push(Array(columns.length).fill(0));

  rowValues.push(Array(columns.length).fill(""));
  styleRows.push(Array(columns.length).fill(0));

  rowValues.push(columns.map((column) => column.label));
  styleRows.push(Array(columns.length).fill(1));

  downloadRows.forEach((downloadRow) => {
    rowValues.push(columns.map((column) => valueOrNav(downloadRow.values[column.key])));

    const rowStyles = columns.map((column) => {
      if (column.type === "comparisonResult") {
        const comparison = downloadRow.comparisonByKey[column.comparisonKey];
        return comparison?.isDifferent ? 4 : 0;
      }

      if (column.type === "comparisonMatch") {
        const comparison = downloadRow.comparisonByKey[column.comparisonKey];
        return comparison?.isDifferent ? 4 : 5;
      }

      if (column.key === "operationSuccessful") {
        const value = String(downloadRow.values[column.key] || "").toUpperCase();
        if (value === "YES") return 5;
        if (value === "NO") return 6;
        return 7;
      }

      if (column.key === "finalDecision") {
        const value = String(downloadRow.values[column.key] || "").toUpperCase();
        if (value === "SUCCESSFUL") return 5;
        if (value === "UNSUCCESSFUL") return 6;
        if (value === "BLOCKED") return 7;
        return 0;
      }

      return 0;
    });

    styleRows.push(rowStyles);
  });

  const worksheetXml = buildWorksheetXml(rowValues, styleRows, columns.length);

  return createZipBlob([
    { name: "[Content_Types].xml", content: buildContentTypesXml() },
    { name: "_rels/.rels", content: buildRootRelsXml() },
    { name: "xl/workbook.xml", content: buildWorkbookXml() },
    { name: "xl/_rels/workbook.xml.rels", content: buildWorkbookRelsXml() },
    { name: "xl/styles.xml", content: buildStylesXml() },
    { name: "xl/worksheets/sheet1.xml", content: worksheetXml },
  ]);
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

export default function TcFinalReportPage() {
  const { tcId } = useParams();
  const [activeFilter, setActiveFilter] = useState("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const {
    data: upload,
    isLoading,
    isError,
    error,
  } = useGetTcUploadByIdQuery(tcId);

  const reportStatus = getReportStatus(upload);
  const errorMessage =
    error?.message || error?.data?.message || "Failed to load TC upload.";

  const report = useMemo(
    () => ({
      ...fakeTcReport,
      id: tcId || fakeTcReport.id,
      tcId: tcId || fakeTcReport.tcId,
      fileName: upload?.fileName || fakeTcReport.fileName,
      trnType: upload?.trnType || fakeTcReport.trnType,
      lmPcode: upload?.lmPcode || fakeTcReport.lmPcode,
      status: reportStatus,
    }),
    [reportStatus, tcId, upload?.fileName, upload?.lmPcode, upload?.trnType],
  );

  const filterCounts = useMemo(() => {
    const counts = {};

    FILTER_OPTIONS.forEach((option) => {
      counts[option.value] = fakeTcReportRows.filter((row) =>
        rowMatchesFilter(row, option.value),
      ).length;
    });

    return counts;
  }, []);

  const filteredRows = useMemo(
    () => fakeTcReportRows.filter((row) => rowMatchesFilter(row, activeFilter)),
    [activeFilter],
  );

  const totalFilteredRows = filteredRows.length;
  const totalPages = Math.max(Math.ceil(totalFilteredRows / rowsPerPage), 1);
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = (safeCurrentPage - 1) * rowsPerPage;
  const pageEndIndex = Math.min(pageStartIndex + rowsPerPage, totalFilteredRows);

  const paginatedRows = useMemo(
    () => filteredRows.slice(pageStartIndex, pageEndIndex),
    [filteredRows, pageEndIndex, pageStartIndex],
  );

  const rowDemoStats = useMemo(() => {
    const total = fakeTcReportRows.length;
    const successful = fakeTcReportRows.filter(
      (row) => row.finalDecision?.code === "SUCCESSFUL",
    ).length;
    const unsuccessful = fakeTcReportRows.filter(
      (row) => row.finalDecision?.code === "UNSUCCESSFUL",
    ).length;
    const blocked = fakeTcReportRows.filter(
      (row) => row.finalDecision?.code === "BLOCKED",
    ).length;
    const pending = fakeTcReportRows.filter(
      (row) => row.finalDecision?.code === "PENDING",
    ).length;

    return { total, successful, unsuccessful, blocked, pending };
  }, []);

  return (
    <section style={styles.page}>
      <div style={styles.backRow}>
        <Link to="/operations/tc-uploads" style={styles.backLink}>
          ← Back to TC Uploads
        </Link>
        <Link to={`/operations/tc-uploads/${tcId}`} style={styles.backLink}>
          Open TC Rows
        </Link>
        <Link to={`/operations/tc-uploads/${tcId}/bgo`} style={styles.backLink}>
          Open BGO
        </Link>
      </div>

      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Operations / TC Uploads / Final Report</p>
          <h2 style={styles.title}>Final Report ({reportStatus})</h2>
          <p style={styles.subtitle}>
            This page is now using a fake tc_report / tc_report_rows projection.
            It shows the same reporting shape that TC Rows, BGO Rows, TRNs, and
            execution updates will later feed into Firestore.
          </p>
        </div>

        <div style={styles.headerActions}>
          <span style={styles.statusBadge}>{reportStatus}</span>
          <button
            type="button"
            style={styles.primaryExportButton}
            onClick={() => {
              const blob = buildDraftReportWorkbookBlob({
                report,
                rows: fakeTcReportRows,
              });
              const fileName = `${sanitizeFileName(report.tcId)}_FINAL_REPORT_${sanitizeFileName(report.status)}.xlsx`;
              downloadBlob(blob, fileName);
            }}
          >
            Download Draft Report
          </button>
        </div>
      </div>

      {isLoading ? <div style={styles.notice}>Loading upload context...</div> : null}
      {isError ? <div style={styles.errorNotice}>{errorMessage}</div> : null}

      <div style={styles.summaryGrid}>
        <InfoCard label="TC ID" value={report.tcId} />
        <InfoCard label="File" value={valueOrNav(report.fileName)} />
        <InfoCard label="TRN Type" value={valueOrNav(report.trnType)} />
        <InfoCard label="LM" value={valueOrNav(report.lmPcode)} />
        <InfoCard label="Report Status" value={report.status} />
        <InfoCard label="Updated" value={formatDateTime(report.updated?.at)} />
      </div>

      <div style={styles.panel}>
        <div style={styles.panelHeader}>
          <div>
            <h3 style={styles.panelTitle}>Report reconciliation</h3>
            <p style={styles.panelSubtitle}>
              The report must always account for every original upload row, even
              where a row never reaches BGO or execution.
            </p>
          </div>
        </div>

        <div style={styles.reconciliationBox}>
          <strong style={styles.reconciliationFormula}>
            {report.summary.uploadedRows} uploaded rows ={" "}
            {report.summary.bgoNotReadyRows} not BGO ready +{" "}
            {report.summary.executionAccessRows} successful execution +{" "}
            {report.summary.executionNoAccessRows} no access
          </strong>
          <span style={styles.reconciliationNote}>
            Demo table below shows {rowDemoStats.total} sample rows covering the
            same scenarios. Summary cards show the 300-row business scenario.
          </span>
        </div>

        <div style={styles.metricGrid}>
          <MetricCard label="Uploaded Rows" value={report.summary.uploadedRows} />
          <MetricCard label="TC Rows" value={report.summary.tcRows} />
          <MetricCard label="BGO Ready" value={report.summary.bgoReadyRows} />
          <MetricCard label="BGO Not Ready" value={report.summary.bgoNotReadyRows} />
          <MetricCard label="TRNs Created" value={report.summary.trnsCreated} />
          <MetricCard label="Access Success" value={report.summary.executionAccessRows} />
          <MetricCard label="No Access" value={report.summary.executionNoAccessRows} />
          <MetricCard label="Final Successful" value={report.summary.finalSuccessfulRows} />
          <MetricCard label="Final Unsuccessful" value={report.summary.finalUnsuccessfulRows} />
        </div>
      </div>

      <div style={styles.panel}>
        <h3 style={styles.panelTitle}>Final report sections</h3>
        <p style={styles.panelSubtitle}>
          These are the agreed report sections. Each row in tc_report_rows carries
          values for all sections, plus references back to TC Row, BGO Row, and TRN.
        </p>

        <div style={styles.sectionGrid}>
          {SECTION_LABELS.map((section) => (
            <div key={section} style={styles.sectionCard}>
              {section}
            </div>
          ))}
        </div>
      </div>

      <div style={styles.panel}>
        <div style={styles.panelHeader}>
          <div>
            <h3 style={styles.panelTitle}>Final report rows</h3>
            <p style={styles.panelSubtitle}>
              Source: fake tc_report_rows. Later this page should stream real
              tc_reports / tc_report_rows for the selected tcId.
            </p>
          </div>
        </div>

        <div style={styles.filterRow}>
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              style={{
                ...styles.filterButton,
                ...(activeFilter === option.value ? styles.filterButtonActive : null),
              }}
              onClick={() => {
                setActiveFilter(option.value);
                setCurrentPage(1);
              }}
            >
              {option.label} ({filterCounts[option.value] || 0})
            </button>
          ))}
        </div>

        <ReportPagination
          currentPage={safeCurrentPage}
          endRow={pageEndIndex}
          rowsPerPage={rowsPerPage}
          setCurrentPage={setCurrentPage}
          setRowsPerPage={setRowsPerPage}
          startRow={totalFilteredRows === 0 ? 0 : pageStartIndex + 1}
          totalPages={totalPages}
          totalRows={totalFilteredRows}
        />

        <div style={styles.reportRowsList}>
          {totalFilteredRows === 0 ? (
            <div style={styles.emptyRowsNotice}>
              No fake report rows match this filter.
            </div>
          ) : null}

          {paginatedRows.map((row) => (
            <ReportRowCard key={row.id} row={row} />
          ))}
        </div>

        <ReportPagination
          currentPage={safeCurrentPage}
          endRow={pageEndIndex}
          rowsPerPage={rowsPerPage}
          setCurrentPage={setCurrentPage}
          setRowsPerPage={setRowsPerPage}
          startRow={totalFilteredRows === 0 ? 0 : pageStartIndex + 1}
          totalPages={totalPages}
          totalRows={totalFilteredRows}
        />
      </div>

      <div style={styles.panel}>
        <h3 style={styles.panelTitle}>Storage target</h3>
        <div style={styles.storageGrid}>
          <StorageCard
            title="tc_reports"
            text="One parent report document per TC Upload. Holds report status, summary counts, finalisation, export metadata, and reconciliation totals."
          />
          <StorageCard
            title="tc_report_rows"
            text="One report-ready row per original upload rowNo. Stores upload, iREPS, TC, BGO, TRN, execution, flags, finalDecision, and refs."
          />
          <StorageCard
            title="Report updates"
            text="TC validation creates draft rows. BGO creation updates BGO/TRN references. TRN workflow and execution updates refresh the same report rows."
          />
        </div>
      </div>
    </section>
  );
}

function ReportPagination({
  currentPage,
  endRow,
  rowsPerPage,
  setCurrentPage,
  setRowsPerPage,
  startRow,
  totalPages,
  totalRows,
}) {
  return (
    <div style={styles.paginationBar}>
      <div style={styles.paginationSummary}>
        Showing {startRow}-{endRow} of {totalRows} row(s)
      </div>

      <div style={styles.paginationControls}>
        <label style={styles.rowsPerPageLabel}>
          Rows per page
          <select
            style={styles.rowsPerPageSelect}
            value={rowsPerPage}
            onChange={(event) => {
              setRowsPerPage(Number(event.target.value));
              setCurrentPage(1);
            }}
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </label>

        <button
          type="button"
          style={{
            ...styles.paginationButton,
            ...(currentPage <= 1 ? styles.paginationButtonDisabled : null),
          }}
          disabled={currentPage <= 1}
          onClick={() => setCurrentPage((page) => Math.max(page - 1, 1))}
        >
          Previous
        </button>

        <span style={styles.paginationPageLabel}>
          Page {currentPage} of {totalPages}
        </span>

        <button
          type="button"
          style={{
            ...styles.paginationButton,
            ...(currentPage >= totalPages ? styles.paginationButtonDisabled : null),
          }}
          disabled={currentPage >= totalPages}
          onClick={() =>
            setCurrentPage((page) => Math.min(page + 1, totalPages))
          }
        >
          Next
        </button>
      </div>
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <div style={styles.infoCard}>
      <span style={styles.infoLabel}>{label}</span>
      <strong style={styles.infoValue}>{value}</strong>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div style={styles.metricCard}>
      <span style={styles.metricLabel}>{label}</span>
      <strong style={styles.metricValue}>{value}</strong>
    </div>
  );
}


function ReportRowCard({ row }) {
  const comparisonRows = getComparisonRows(row);
  const flagCodes = getFlagCodes(row);
  const differentCount = comparisonRows.filter((item) => item.isDifferent).length;

  return (
    <div style={styles.reportRowCard}>
      <div style={styles.reportRowTop}>
        <div>
          <div style={styles.reportRowTitle}>
            Row {row.rowNo} • Meter {valueOrNav(row.upload?.meterNo)}
          </div>
          <div style={styles.reportRowSubTitle}>{row.id}</div>
        </div>

        <div style={styles.reportRowBadges}>
          <Badge tone={getDecisionTone(row.finalDecision?.code)}>
            {row.finalDecision?.label || "NAv"}
          </Badge>
          <Badge tone={row.tc?.readyForBgo ? "success" : "warning"}>
            {row.tc?.readinessState || "NAv"}
          </Badge>
          {differentCount > 0 ? (
            <Badge tone="warning">{differentCount} DIFFERENCE(S)</Badge>
          ) : (
            <Badge tone="success">VALUES MATCH</Badge>
          )}
        </div>
      </div>

      <div style={styles.comparisonWrap}>
        <table style={styles.comparisonTable}>
          <thead>
            <tr>
              <th style={styles.comparisonTh}>Field</th>
              <th style={styles.comparisonTh}>Upload / instruction value</th>
              <th style={styles.comparisonTh}>iREPS / result value</th>
              <th style={styles.comparisonTh}>Check</th>
            </tr>
          </thead>

          <tbody>
            {comparisonRows.map((item) => (
              <tr key={`${row.id}-${item.key}`}>
                <td style={styles.comparisonTd}>
                  <strong>{item.label}</strong>
                </td>
                <td style={styles.comparisonTd}>{valueOrNav(item.uploadValue)}</td>
                <td
                  style={{
                    ...styles.comparisonTd,
                    ...(item.isDifferent ? styles.resultCellDifferent : null),
                  }}
                >
                  {valueOrNav(item.resultValue)}
                </td>
                <td style={styles.comparisonTdCompact}>
                  <Badge tone={item.isDifferent ? "warning" : "success"}>
                    {item.isDifferent ? "DIFFERENT" : "MATCH"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={styles.reportRowDetailGrid}>
        <ReportMiniPanel title="BGO / TRN">
          <StackedValue label="bgo ready" value={getBooleanLabel(row.bgo?.ready)} />
          <StackedValue label="bgo used" value={getBooleanLabel(row.bgo?.used)} />
          <StackedValue label="bgo row" value={row.bgo?.bgoRowId} />
          <StackedValue label="batch" value={row.bgo?.batchId} />
          <StackedValue label="trn" value={row.trn?.trnId} />
          <StackedValue label="workflow" value={row.trn?.workflowState} />
        </ReportMiniPanel>

        <ReportMiniPanel title="Execution">
          <StackedValue label="completed" value={getBooleanLabel(row.execution?.completed)} />
          <StackedValue label="access" value={getBooleanLabel(row.execution?.hasAccess)} />
          <StackedValue label="outcome" value={row.execution?.outcome} />
          <StackedValue label="reason" value={row.execution?.reason} />
          <StackedValue label="executed by" value={row.execution?.executedBy} />
          <StackedValue label="executed at" value={formatDateTime(row.execution?.executedAt)} />
        </ReportMiniPanel>

        <ReportMiniPanel title="Flags / Final Decision">
          <div style={styles.flagListWide}>
            {flagCodes.length === 0 ? (
              <Badge tone="success">NO FLAGS</Badge>
            ) : (
              flagCodes.map((flagCode) => (
                <Badge key={`${row.id}-${flagCode}`} tone="warning">
                  {flagCode}
                </Badge>
              ))
            )}
            {hasDataMismatch(row) ? <Badge tone="danger">DATA MISMATCH</Badge> : null}
          </div>
          <StackedValue label="decision reason" value={row.finalDecision?.reasonCode} />
          <StackedValue label="required action" value={row.finalDecision?.requiredAction} />
        </ReportMiniPanel>
      </div>
    </div>
  );
}

function ReportMiniPanel({ title, children }) {
  return (
    <div style={styles.reportMiniPanel}>
      <h4 style={styles.reportMiniTitle}>{title}</h4>
      {children}
    </div>
  );
}

function StorageCard({ title, text }) {
  return (
    <div style={styles.storageCard}>
      <strong style={styles.storageTitle}>{title}</strong>
      <p style={styles.storageText}>{text}</p>
    </div>
  );
}

function StackedValue({ label, value }) {
  return (
    <div style={styles.stackedValue}>
      <span style={styles.stackedLabel}>{label}</span>
      <span style={styles.stackedText}>{valueOrNav(value)}</span>
    </div>
  );
}

function Badge({ children, tone = "neutral" }) {
  const toneStyle =
    tone === "success"
      ? styles.successBadge
      : tone === "warning"
        ? styles.warningBadge
        : tone === "danger"
          ? styles.dangerBadge
          : styles.neutralBadge;

  return <span style={{ ...styles.badge, ...toneStyle }}>{children}</span>;
}

function Th({ children }) {
  return <th style={styles.th}>{children}</th>;
}

function Td({ children, strong = false, colSpan = undefined }) {
  return (
    <td
      colSpan={colSpan}
      style={{
        ...styles.td,
        ...(strong ? styles.strongCell : null),
      }}
    >
      {children}
    </td>
  );
}

const styles = {
  page: { padding: 24 },
  backRow: { display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 },
  backLink: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid #bfdbfe",
    borderRadius: 999,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 900,
    textDecoration: "none",
  },
  header: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 24,
    padding: 24,
    marginBottom: 16,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  headerActions: {
    display: "flex",
    alignItems: "flex-end",
    gap: 10,
    flexDirection: "column",
  },
  eyebrow: {
    margin: 0,
    fontSize: 12,
    fontWeight: 900,
    color: "#2563eb",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  title: { margin: "8px 0", fontSize: 28, color: "#0f172a" },
  subtitle: { margin: 0, maxWidth: 900, color: "#64748b", lineHeight: 1.6 },
  statusBadge: {
    borderRadius: 999,
    padding: "7px 10px",
    background: "#fef3c7",
    color: "#92400e",
    fontSize: 11,
    fontWeight: 900,
  },
  primaryExportButton: {
    border: "none",
    borderRadius: 14,
    background: "#2563eb",
    color: "#ffffff",
    padding: "11px 14px",
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  disabledButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 14,
    background: "#f8fafc",
    color: "#94a3b8",
    padding: "11px 14px",
    fontWeight: 900,
    cursor: "not-allowed",
    whiteSpace: "nowrap",
  },
  notice: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    fontWeight: 800,
  },
  errorNotice: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    fontWeight: 800,
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 12,
    marginBottom: 16,
  },
  infoCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 16,
  },
  infoLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 900,
    marginBottom: 8,
  },
  infoValue: { color: "#0f172a", fontSize: 18, wordBreak: "break-word" },
  panel: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 24,
    padding: 18,
    marginBottom: 16,
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 14,
  },
  panelTitle: { margin: 0, color: "#0f172a", fontSize: 18 },
  panelSubtitle: { margin: "6px 0 0", color: "#64748b", lineHeight: 1.5 },
  reconciliationBox: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 16,
    display: "grid",
    gap: 6,
    marginBottom: 14,
  },
  reconciliationFormula: {
    color: "#0f172a",
    fontSize: 16,
    lineHeight: 1.5,
  },
  reconciliationNote: {
    color: "#64748b",
    fontSize: 13,
    lineHeight: 1.5,
  },
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: 10,
  },
  metricCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    background: "#ffffff",
    padding: 14,
  },
  metricLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 11,
    fontWeight: 900,
    marginBottom: 7,
  },
  metricValue: {
    display: "block",
    color: "#0f172a",
    fontSize: 24,
  },
  sectionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: 10,
    marginTop: 14,
  },
  sectionCard: {
    border: "1px solid #dbeafe",
    borderRadius: 16,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: 14,
    fontWeight: 900,
    textAlign: "center",
  },
  filterRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
  },
  filterButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    background: "#ffffff",
    color: "#334155",
    padding: "8px 11px",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
  },
  filterButtonActive: {
    borderColor: "#bfdbfe",
    background: "#eff6ff",
    color: "#1d4ed8",
  },
  paginationBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    background: "#f8fafc",
    padding: "10px 12px",
    marginBottom: 14,
  },
  paginationSummary: {
    color: "#475569",
    fontSize: 12,
    fontWeight: 900,
  },
  paginationControls: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  rowsPerPageLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    color: "#64748b",
    fontSize: 12,
    fontWeight: 900,
  },
  rowsPerPageSelect: {
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    background: "#ffffff",
    color: "#334155",
    padding: "7px 9px",
    fontSize: 12,
    fontWeight: 900,
  },
  paginationButton: {
    border: "1px solid #bfdbfe",
    borderRadius: 999,
    background: "#ffffff",
    color: "#1d4ed8",
    padding: "7px 11px",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
  },
  paginationButtonDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
  },
  paginationPageLabel: {
    color: "#334155",
    fontSize: 12,
    fontWeight: 900,
  },
  reportRowsList: {
    display: "grid",
    gap: 14,
    marginTop: 14,
  },
  emptyRowsNotice: {
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    background: "#f8fafc",
    color: "#64748b",
    padding: 16,
    fontSize: 13,
    fontWeight: 900,
  },
  reportRowCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 20,
    background: "#ffffff",
    overflow: "hidden",
  },
  reportRowTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    padding: 16,
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
  },
  reportRowTitle: {
    color: "#0f172a",
    fontSize: 15,
    fontWeight: 900,
    marginBottom: 4,
  },
  reportRowSubTitle: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: 800,
    wordBreak: "break-word",
  },
  reportRowBadges: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 6,
  },
  comparisonWrap: {
    overflowX: "auto",
    padding: 16,
  },
  comparisonTable: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: 760,
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    overflow: "hidden",
  },
  comparisonTh: {
    textAlign: "left",
    background: "#f1f5f9",
    color: "#475569",
    borderBottom: "1px solid #e2e8f0",
    padding: "10px 12px",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  comparisonTd: {
    color: "#334155",
    borderBottom: "1px solid #f1f5f9",
    padding: "10px 12px",
    fontSize: 12,
    lineHeight: 1.45,
    verticalAlign: "top",
    wordBreak: "break-word",
  },
  comparisonTdCompact: {
    color: "#334155",
    borderBottom: "1px solid #f1f5f9",
    padding: "10px 12px",
    fontSize: 12,
    lineHeight: 1.45,
    verticalAlign: "top",
    whiteSpace: "nowrap",
  },
  resultCellDifferent: {
    background: "#fef3c7",
    color: "#78350f",
    fontWeight: 900,
  },
  reportRowDetailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
    gap: 12,
    padding: "0 16px 16px",
  },
  reportMiniPanel: {
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    background: "#f8fafc",
    padding: 14,
  },
  reportMiniTitle: {
    margin: "0 0 10px",
    color: "#0f172a",
    fontSize: 13,
    fontWeight: 900,
  },
  flagListWide: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 10,
  },
  tableWrap: { overflowX: "auto", marginTop: 14 },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 1500 },
  th: {
    textAlign: "left",
    background: "#f8fafc",
    color: "#475569",
    borderBottom: "1px solid #e2e8f0",
    padding: "12px 10px",
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  td: {
    color: "#334155",
    borderBottom: "1px solid #f1f5f9",
    padding: "12px 10px",
    fontSize: 12,
    lineHeight: 1.5,
    verticalAlign: "top",
    minWidth: 160,
  },
  strongCell: {
    color: "#0f172a",
    fontWeight: 900,
  },
  rowNo: {
    color: "#0f172a",
    fontWeight: 900,
    marginBottom: 4,
  },
  miniText: {
    color: "#94a3b8",
    fontSize: 10,
    lineHeight: 1.4,
    wordBreak: "break-word",
    maxWidth: 180,
  },
  stackedValue: {
    display: "grid",
    gap: 2,
    marginBottom: 7,
  },
  stackedLabel: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  stackedText: {
    color: "#334155",
    fontSize: 12,
    lineHeight: 1.35,
    wordBreak: "break-word",
  },
  flagList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    maxWidth: 210,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "5px 9px",
    fontSize: 10,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  successBadge: { background: "#dcfce7", color: "#166534" },
  warningBadge: { background: "#fef3c7", color: "#92400e" },
  dangerBadge: { background: "#fee2e2", color: "#991b1b" },
  neutralBadge: { background: "#f1f5f9", color: "#475569" },
  reasonText: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: 900,
    marginTop: 6,
    wordBreak: "break-word",
  },
  storageGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 12,
  },
  storageCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    background: "#f8fafc",
    padding: 16,
  },
  storageTitle: { display: "block", color: "#0f172a", marginBottom: 6 },
  storageText: { margin: 0, color: "#64748b", lineHeight: 1.5, fontSize: 13 },
};
