import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  useDeleteTcUploadMutation,
  useGetTcUploadsQuery,
  useUploadAndValidateTcMutation,
} from "../../redux/tcApi";

const trnTypeOptions = [
  "METER_DISCONNECTION",
  "METER_RECONNECTION",
  "METER_REMOVAL",
  "METER_READING",
  "METER_INSPECTION",
];

const ROW_NO_HEADER = "rowNo";
const TC_UPLOAD_MIN_ROWS = 1;
const TC_UPLOAD_MAX_ROWS = 1000;

const TC_UPLOAD_COLUMNS = [
  {
    name: "rowNo",
    headerRequired: true,
    valueRequired: true,
    type: "Whole Number",
    example: "1",
    meaning: "Original row number from the uploaded file.",
    rule: "Required. Must be a positive whole number, greater than 0, unique in the file, with no letters, decimals, or blanks.",
  },
  {
    name: "meterNo",
    headerRequired: true,
    valueRequired: true,
    type: "Text",
    example: "04085348920",
    meaning: "Meter number from the billing/LM file.",
    rule: "Required. Treated as text, trimmed, uppercased for matching, and leading zeroes must be preserved.",
  },
  {
    name: "meterPhase",
    headerRequired: true,
    valueRequired: false,
    type: "Text",
    example: "Single Phase",
    meaning: "Upload-side phase, used later for comparison with iREPS data.",
    rule: "Header required, value optional. Preserved as uploaded data for feedback/reporting.",
  },
  {
    name: "meterType",
    headerRequired: true,
    valueRequired: false,
    type: "Text",
    example: "electricity",
    meaning: "Upload-side service/meter type.",
    rule: "Header required, value optional. Preserved as uploaded data for comparison.",
  },
  {
    name: "linkedAccountNo",
    headerRequired: true,
    valueRequired: false,
    type: "Text",
    example: "ACC001",
    meaning: "Billing/account number linked to the meter.",
    rule: "Header required, value optional. Preserved for LM billing/data-cleansing feedback.",
  },
  {
    name: "premiseAddress",
    headerRequired: true,
    valueRequired: false,
    type: "Text",
    example: "192 Kruger Street Mpumelelo",
    meaning: "Billing/LM premise address.",
    rule: "Header required, value optional. Preserved for comparison with iREPS premise address.",
  },
  {
    name: "premisePropertyType",
    headerRequired: true,
    valueRequired: false,
    type: "Text",
    example: "Residential",
    meaning: "Billing/LM property type.",
    rule: "Header required, value optional. Preserved for comparison with iREPS property type.",
  },
  {
    name: "actionReason",
    headerRequired: true,
    valueRequired: false,
    type: "Text",
    example: "Credit control list",
    meaning: "Why this meter is proposed for the selected operation.",
    rule: "Header required, value optional. Preserved as the upload-side action reason.",
  },
  {
    name: "wardNo",
    headerRequired: true,
    valueRequired: false,
    type: "Text",
    example: "13",
    meaning: "Billing/LM ward number.",
    rule: "Header required, value optional. Preserved for comparison with iREPS ward.",
  },
  {
    name: "geofence",
    headerRequired: true,
    valueRequired: false,
    type: "Text",
    example: "Gf Kruger Mpumelelo",
    meaning: "Billing/LM/geographic grouping if known.",
    rule: "Header required, value optional. Preserved for comparison with iREPS geofence result.",
  },
  {
    name: "meterStatus",
    headerRequired: true,
    valueRequired: false,
    type: "Text",
    example: "CONNECTED",
    meaning: "Billing/LM meter status.",
    rule: "Header required, value optional. Preserved for comparison with iREPS AST status.",
  },
  {
    name: "erfNo",
    headerRequired: true,
    valueRequired: false,
    type: "Text",
    example: "5320",
    meaning: "Billing/LM ERF number.",
    rule: "Header required, value optional. Preserved for comparison with iREPS ERF number.",
  },
];

const TC_UPLOAD_FILE_RULES = [
  {
    rule: "File type",
    description: "Only .csv files are accepted in TC Uploads v1.",
  },
  {
    rule: "Header row",
    description: "The first row must contain the official TC Upload headers.",
  },
  {
    rule: "Header order",
    description: "The columns must follow the official template order exactly.",
  },
  {
    rule: "Required headers",
    description: "All 12 official headers must exist in the CSV file.",
  },
  {
    rule: "Required values",
    description: "rowNo and meterNo must have values.",
  },
  {
    rule: "Optional values",
    description:
      "All other columns may be blank, but their headers must still exist.",
  },
  {
    rule: "Blank rows",
    description: "Fully blank rows are ignored before validation.",
  },
  {
    rule: "Minimum rows",
    description: `The file must contain at least ${TC_UPLOAD_MIN_ROWS} valid data row.`,
  },
  {
    rule: "Maximum rows",
    description: `The file may contain up to ${TC_UPLOAD_MAX_ROWS} data rows in v1.`,
  },
  {
    rule: "Duplicate rowNo",
    description:
      "Duplicate rowNo values are not allowed. The file must be fixed before upload.",
  },
  {
    rule: "Duplicate meterNo",
    description:
      "Duplicate meterNo values are allowed at the file-structure stage, but affected rows may be blocked during backend validation.",
  },
  {
    rule: "Leading zeros",
    description:
      "Meter numbers must be preserved as text. Example: 04085348813 must not become 4085348813.",
  },
  {
    rule: "Failed structure check",
    description:
      "If file structure fails, no tc_uploads or tc_rows records are created.",
  },
];

const TC_UPLOAD_DICTIONARY = [
  {
    term: "TC",
    meaning: "TRN Candidate.",
    description:
      "A TC upload is a CSV file submitted so each row can be checked and prepared as a possible candidate for later work creation.",
  },
  {
    term: "TRN",
    meaning: "Transaction.",
    description:
      "The actual iREPS work/transaction document created for operations such as METER_DISCONNECTION, METER_RECONNECTION, METER_READING, METER_REMOVAL, or METER_INSPECTION.",
  },
  {
    term: "BGO",
    meaning: "Bulk Geofence Origin.",
    description:
      "The bulk origin process that consumes clean, ready TC rows and creates work in bulk, usually grouped by geofence.",
  },
  {
    term: "DCN",
    meaning: "Meter Disconnection.",
    description:
      "The operation/work type used when a file lists meters proposed for disconnection.",
  },
  {
    term: "CSV",
    meaning: "Comma-Separated Values.",
    description: "The only accepted file type for TC Uploads v1.",
  },
  {
    term: "TC Upload",
    meaning: "The parent upload record.",
    description:
      "One uploaded CSV file and the matching parent document in tc_uploads. It stores upload metadata and summary counts.",
  },
  {
    term: "TC Row",
    meaning: "The row-level detail record.",
    description:
      "One uploaded CSV row after validation and preparation. It becomes a document in tc_rows.",
  },
  {
    term: "File Structure",
    meaning: "The required shape of the CSV file.",
    description:
      "This includes file type, headers, column order, required values, row count, and duplicate rowNo rules.",
  },
  {
    term: "Header",
    meaning: "The first row of the CSV file.",
    description:
      "The header names the columns. For v1, it must match the official TC Upload template order exactly.",
  },
  {
    term: "rowNo",
    meaning: "Original uploaded row number.",
    description:
      "The row reference used to trace the upload and report back to LM. It must be unique, positive, whole-number text.",
  },
  {
    term: "meterNo",
    meaning: "Uploaded meter number.",
    description:
      "The main matching key used to find the meter/AST in iREPS. It is text and must preserve leading zeroes.",
  },
  {
    term: "Meter Match",
    meaning: "A successful iREPS meter lookup.",
    description:
      "This happens when the uploaded meterNo is matched to an iREPS AST/meter record.",
  },
  {
    term: "AST",
    meaning: "iREPS asset/meter record.",
    description:
      "The operational source of truth for meter existence, meter status, meter type, premise link, ward/ERF context, GPS, and geofence membership.",
  },
  {
    term: "Premise",
    meaning: "Customer/location/property record.",
    description:
      "For TC feedback, the premise mainly provides the address and property type shown to the user and returned in reports.",
  },
  {
    term: "ERF",
    meaning: "Land/property parcel number context.",
    description:
      "Used in TC feedback to compare uploaded billing/LM ERF values with iREPS ERF values.",
  },
  {
    term: "Ward",
    meaning: "Local municipal ward area.",
    description:
      "TC uploads can be LM-scoped and still contain rows from different wards. Each matched AST supplies the row-level ward context.",
  },
  {
    term: "LM",
    meaning: "Local Municipality.",
    description:
      "The municipal scope for the TC upload. Example: Lesedi uses lmPcode ZA7423.",
  },
  {
    term: "Geofence",
    meaning: "Polygon work area.",
    description:
      "A geographic grouping used to prepare and originate bulk work. Rows without geofence usually cannot proceed to BGO.",
  },
  {
    term: "NEEDS_GEOFENCE",
    meaning: "Matched meter has no geofence membership.",
    description:
      "The row is blocked from BGO until the meter is included in a valid geofence.",
  },
  {
    term: "Eligibility",
    meaning: "Whether a meter can be used for the selected operation.",
    description:
      "For DCN, a CONNECTED meter can be eligible, while FIELD, DISCONNECTED, or REMOVED meters are not eligible for disconnection.",
  },
  {
    term: "BGO Ready",
    meaning: "The row is ready to be consumed by BGO.",
    description:
      "A row is BGO ready only after it is valid, matched, eligible, geofenced, not duplicate-blocked, not blocked by active same-operation work, not used, and has no batchId.",
  },
  {
    term: "Frontend Pre-check",
    meaning: "File structure validation before backend upload.",
    description:
      "This checks CSV-only, official headers, rowNo, meterNo, duplicates, row count, and other structure rules before any backend records are created.",
  },
  {
    term: "Backend Validation",
    meaning: "Authoritative row-level validation.",
    description:
      "Backend validation matches meters to iREPS, checks eligibility, geofence membership, duplicates, active work, and prepares TC rows and summaries.",
  },
  {
    term: "Data Cleansing",
    meaning: "Comparing uploaded LM/billing data with iREPS data.",
    description:
      "Each upload can help LM identify billing-system mismatches such as address, property type, ERF, ward, status, account, or meter-type differences.",
  },
  {
    term: "Feedback Report",
    meaning: "Report returned to LM/uploader.",
    description:
      "The report should show uploaded values, iREPS values, comparison results, operational decisions, and required LM actions.",
  },
  {
    term: "Delete Upload",
    meaning: "Controlled delete before BGO.",
    description:
      "Deletes a TC upload and its tc_rows only before BGO batches or TRNs exist. Backend blocks deletion if any row has been consumed by BGO, has a batchId, or has TRN evidence.",
  },
  {
    term: "Source of Truth",
    meaning: "The authoritative place for a value.",
    description:
      "The uploaded file is truth for what LM submitted; AST is truth for meter state; premise is truth for address/property type; geofence membership is truth for BGO grouping.",
  },
];

const TC_UPLOAD_DATA_FLOW_STEPS = [
  {
    step: "1",
    title: "Upload CSV file",
    description: "The user selects the official TC Upload CSV file.",
  },
  {
    step: "2",
    title: "Frontend file-structure pre-check",
    description:
      "iREPS checks the file type, header row, official columns, required values, duplicate rowNo, and row count.",
  },
  {
    step: "3A",
    title: "If file structure fails",
    description:
      "The upload stops. No tc_uploads or tc_rows records are created. The user must fix the CSV and upload again.",
  },
  {
    step: "3B",
    title: "If file structure passes",
    description:
      "The file is allowed to proceed to backend upload and validation.",
  },
  {
    step: "4",
    title: "Create tc_uploads parent record",
    description:
      "Backend creates the parent upload/header document with metadata and summary fields.",
  },
  {
    step: "5",
    title: "Create tc_rows detail records",
    description: "Each uploaded data row becomes a row-level candidate record.",
  },
  {
    step: "6",
    title: "Match uploaded meterNo to iREPS AST",
    description:
      "Backend tries to find the live iREPS meter/AST for each uploaded meter number.",
  },
  {
    step: "7",
    title: "Compare upload values to iREPS values",
    description:
      "Uploaded values are compared against AST, premise, geofence, and future account/data-cleansing context.",
  },
  {
    step: "8",
    title: "Check operation eligibility",
    description:
      "Backend checks whether the matched meter is eligible for the selected operation such as DCN.",
  },
  {
    step: "9",
    title: "Check geofence readiness",
    description:
      "Backend checks whether the matched meter has geofence membership needed for BGO.",
  },
  {
    step: "10",
    title: "Set BGO Ready TRUE/FALSE",
    description:
      "Backend stores the row-level BGO readiness decision in tc_rows.bgo.",
  },
  {
    step: "11",
    title: "Prepare LM feedback/report",
    description:
      "The final output can show uploaded values, iREPS values, mismatches, decision codes, and required LM action.",
  },
];

const TC_UPLOAD_PURPOSES = {
  METER_DISCONNECTION:
    "Upload a CSV list of meters proposed for disconnection. iREPS checks file structure first, then backend validation will compare upload data with iREPS data and prepare eligible rows for BGO.",
  METER_RECONNECTION:
    "Upload a CSV list of meters proposed for reconnection. iREPS checks file structure first, then backend validation will compare upload data with iREPS data and prepare eligible rows for BGO.",
  METER_REMOVAL:
    "Upload a CSV list of meters proposed for removal. iREPS checks file structure first, then backend validation will compare upload data with iREPS data and prepare eligible rows for BGO.",
  METER_READING:
    "Upload a CSV list of meters proposed for meter reading. iREPS checks file structure first, then backend validation will compare upload data with iREPS data and prepare eligible rows for BGO.",
  METER_INSPECTION:
    "Upload a CSV list of meters proposed for inspection. iREPS checks file structure first, then backend validation will compare upload data with iREPS data and prepare eligible rows for BGO.",
};

function getGuide(trnType) {
  return {
    title: `${trnType} CSV Upload`,
    purpose:
      TC_UPLOAD_PURPOSES[trnType] || TC_UPLOAD_PURPOSES.METER_DISCONNECTION,
    maxRows: TC_UPLOAD_MAX_ROWS,
    minRows: TC_UPLOAD_MIN_ROWS,
    columns: TC_UPLOAD_COLUMNS,
  };
}

function normalizeHeader(value) {
  return String(value || "").trim();
}

function normalizeMeterNo(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getRowNo(row) {
  return String(row?.raw?.[ROW_NO_HEADER] || "").trim();
}

function getRowReference(row) {
  const rowNo = getRowNo(row);

  if (rowNo) {
    return `Row ${rowNo}`;
  }

  return `CSV line ${row?.rowNumber || "NAv"}`;
}

function isPositiveInteger(value) {
  const text = String(value || "").trim();

  if (!/^\d+$/.test(text)) return false;

  return Number(text) > 0;
}

function addInvalidRow(invalidRows, row, reason) {
  invalidRows.push({
    rowNumber: row.rowNumber,
    rowNo: getRowNo(row),
    rowRef: getRowReference(row),
    reason,
  });
}

function escapeCsvValue(value) {
  const text = String(value ?? "");
  const escaped = text.replaceAll('"', '""');
  return `"${escaped}"`;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);

  return values.map((value) => value.trim());
}

function parseCsvText(csvText) {
  const cleanedText = String(csvText || "").replace(/^\uFEFF/, "");
  const lines = cleanedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return {
      headers: [],
      rows: [],
    };
  }

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);

  const rows = lines
    .slice(1)
    .map((line, index) => {
      const values = parseCsvLine(line);

      if (isBlankCsvRow(values)) {
        return null;
      }

      const raw = {};

      headers.forEach((header, headerIndex) => {
        raw[header] = values[headerIndex] ?? "";
      });

      return {
        rowNumber: index + 2,
        raw,
      };
    })
    .filter(Boolean);

  return {
    headers,
    rows,
  };
}

function isCsvFile(fileName) {
  return String(fileName || "")
    .toLowerCase()
    .endsWith(".csv");
}

function isBlankCsvRow(values = []) {
  return values.every((value) => !String(value || "").trim());
}

function parseTcFileContent({ fileContent }) {
  return parseCsvText(String(fileContent || ""));
}

function dedupeInvalidRows(invalidRows) {
  const seen = new Set();

  return invalidRows.filter((row) => {
    const key = `${row.rowNumber}-${row.reason}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function runFrontendPrecheck({ fileContent, fileName, guide }) {
  const errors = [];
  const warnings = [];

  const supportedFile = Boolean(fileName) && isCsvFile(fileName);

  if (!supportedFile) {
    errors.push(
      "Only CSV files are allowed for TC Uploads v1. Please use the official .csv template.",
    );

    return {
      passed: false,
      fileName,
      headers: [],
      rows: [],
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      invalidRowDetails: [],
      duplicateMeterNos: [],
      duplicateRowNos: [],
      missingRowNos: [],
      unknownColumns: [],
      missingRequiredColumns: [],
      errors,
      warnings,
    };
  }

  const parsed = parseTcFileContent({ fileContent });

  const headers = parsed.headers;
  const rows = parsed.rows;

  if (headers.length === 0) {
    errors.push("The file has no header row.");
  }

  if (headers.length > 0 && headers[0] !== ROW_NO_HEADER) {
    errors.push(
      `The first column must be ${ROW_NO_HEADER}. Current first column is ${
        headers[0] || "blank"
      }.`,
    );
  }

  const allowedColumns = guide.columns.map((column) => column.name);
  const requiredColumns = guide.columns
    .filter((column) => column.headerRequired !== false)
    .map((column) => column.name);

  const headerCounts = new Map();
  headers.forEach((headerName) => {
    headerCounts.set(headerName, (headerCounts.get(headerName) || 0) + 1);
  });

  const duplicateHeaders = Array.from(headerCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([headerName]) => headerName);

  if (duplicateHeaders.length > 0) {
    errors.push(
      `Duplicate header(s) detected: ${duplicateHeaders.join(", ")}. Each column header may appear once only.`,
    );
  }

  if (headers.length > 0) {
    if (headers.length !== allowedColumns.length) {
      errors.push(
        `The CSV must contain exactly ${allowedColumns.length} columns in the official template order. Found ${headers.length}.`,
      );
    }

    const headerOrderMismatch = allowedColumns.some(
      (columnName, index) => headers[index] !== columnName,
    );

    if (headerOrderMismatch) {
      errors.push(
        `CSV headers must match this exact order: ${allowedColumns.join(", ")}.`,
      );
    }
  }

  const missingRequiredColumns = requiredColumns.filter(
    (columnName) => !headers.includes(columnName),
  );

  if (missingRequiredColumns.length > 0) {
    errors.push(
      `Missing required column(s): ${missingRequiredColumns.join(", ")}.`,
    );
  }

  const unknownColumns = headers.filter(
    (headerName) => !allowedColumns.includes(headerName),
  );

  if (unknownColumns.length > 0) {
    errors.push(
      `Unknown column(s) are not allowed in TC Uploads v1: ${unknownColumns.join(", ")}. Use the official CSV template.`,
    );
  }

  if (rows.length < guide.minRows) {
    errors.push(`The file must contain at least ${guide.minRows} data row.`);
  }

  if (rows.length > guide.maxRows) {
    errors.push(
      `The file has ${rows.length} rows. Maximum allowed is ${guide.maxRows}.`,
    );
  }

  const rowNoCounts = new Map();
  const meterNoRows = new Map();
  const invalidRows = [];

  rows.forEach((row) => {
    const rowNo = getRowNo(row);
    const meterNo = normalizeMeterNo(row.raw.meterNo);

    if (!rowNo) {
      addInvalidRow(invalidRows, row, "rowNo is required.");
    } else if (!isPositiveInteger(rowNo)) {
      addInvalidRow(invalidRows, row, "rowNo must be a positive number.");
    } else {
      rowNoCounts.set(rowNo, (rowNoCounts.get(rowNo) || 0) + 1);
    }

    if (!meterNo) {
      addInvalidRow(invalidRows, row, "meterNo is required.");
    } else {
      if (!meterNoRows.has(meterNo)) {
        meterNoRows.set(meterNo, []);
      }

      meterNoRows.get(meterNo).push({
        rowNumber: row.rowNumber,
        rowNo,
        rowRef: getRowReference(row),
        meterNo,
      });
    }
  });

  const duplicateRowNos = Array.from(rowNoCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([rowNo, count]) => ({ rowNo, count }));

  if (duplicateRowNos.length > 0) {
    errors.push(
      `${duplicateRowNos.length} duplicate rowNo value(s) detected. rowNo must be unique.`,
    );
  }

  duplicateRowNos.forEach((duplicate) => {
    rows
      .filter((row) => getRowNo(row) === duplicate.rowNo)
      .forEach((row) => {
        addInvalidRow(
          invalidRows,
          row,
          `Duplicate rowNo ${duplicate.rowNo}. rowNo must be unique.`,
        );
      });
  });

  const rowNoValues = Array.from(rowNoCounts.keys())
    .map((rowNo) => Number(rowNo))
    .filter((rowNo) => Number.isFinite(rowNo))
    .sort((left, right) => left - right);

  const missingRowNos = [];

  if (rowNoValues.length > 0) {
    const maxRowNo = rowNoValues[rowNoValues.length - 1];

    for (let expectedRowNo = 1; expectedRowNo <= maxRowNo; expectedRowNo += 1) {
      if (!rowNoCounts.has(String(expectedRowNo))) {
        missingRowNos.push(String(expectedRowNo));
      }
    }
  }

  if (missingRowNos.length > 0) {
    const shownMissing = missingRowNos.slice(0, 20).join(", ");
    const extraText =
      missingRowNos.length > 20 ? ` and ${missingRowNos.length - 20} more` : "";

    warnings.push(
      `rowNo has sequence gap(s): ${shownMissing}${extraText}. This is allowed, but rowNo must still be unique and numeric.`,
    );
  }

  const duplicateMeterNos = Array.from(meterNoRows.entries())
    .filter(([, rowRefs]) => rowRefs.length > 1)
    .map(([meterNo, rowRefs]) => ({
      meterNo,
      count: rowRefs.length,
      rows: rowRefs,
    }));

  if (duplicateMeterNos.length > 0) {
    warnings.push(
      `${duplicateMeterNos.length} duplicate meter number(s) detected. Backend validation will decide final duplicate handling.`,
    );
  }

  const invalidRowCountByRowNumber = new Set(
    invalidRows.map((row) => row.rowNumber),
  );

  const validRows = Math.max(rows.length - invalidRowCountByRowNumber.size, 0);

  return {
    passed: errors.length === 0,
    fileName,
    headers,
    rows,
    totalRows: rows.length,
    validRows,
    invalidRows: invalidRowCountByRowNumber.size,
    invalidRowDetails: dedupeInvalidRows(invalidRows).slice(0, 30),
    duplicateMeterNos: duplicateMeterNos.slice(0, 20),
    duplicateRowNos: duplicateRowNos.slice(0, 20),
    missingRowNos: missingRowNos.slice(0, 50),
    unknownColumns,
    missingRequiredColumns,
    errors,
    warnings,
  };
}

function getTcReportStatus(upload = {}) {
  const status = String(
    upload?.report?.status ||
      upload?.finalReport?.status ||
      upload?.reportStatus ||
      "DRAFT",
  )
    .trim()
    .toUpperCase();

  return status || "DRAFT";
}

function hasMeaningfulValue(value) {
  const text = String(value || "").trim();

  if (!text) return false;

  return !["NAV", "NAV", "N/AV", "N/A", "NA", "NULL", "UNDEFINED"].includes(
    text.toUpperCase(),
  );
}

function canDeleteTcUploadFromUi(upload = {}) {
  const bgoStatus = String(upload?.bgoStatus || "")
    .trim()
    .toUpperCase();

  if (["USED", "PARTIALLY_USED"].includes(bgoStatus)) return false;
  if (Number(upload?.usedRows || 0) > 0) return false;
  if (hasMeaningfulValue(upload?.bgo?.batchId)) return false;
  if (hasMeaningfulValue(upload?.batchId)) return false;

  return true;
}

function getDeleteDisabledReason(upload = {}) {
  if (canDeleteTcUploadFromUi(upload)) {
    return "Delete is allowed before BGO/TRN work has been created.";
  }

  return "Delete is blocked because this upload appears to have BGO/TRN usage. Backend will enforce the final safety check.";
}

function buildFrontendFeedback(precheckResult) {
  if (!precheckResult) return null;

  return {
    source: "FRONTEND_PRECHECK",
    status: precheckResult.passed ? "PRECHECK_PASSED" : "PRECHECK_FAILED",

    totalMeters: precheckResult.totalRows,
    validatedMeters: precheckResult.validRows,
    invalidatedMeters: precheckResult.invalidRows,

    foundMeters: 0,
    notFoundMeters: 0,

    withGeofenceMeters: 0,
    withoutGeofenceMeters: 0,
    geofenceBreakdown: [],

    readyForBgo: 0,
    needsGeofence: 0,

    backendPending: true,
  };
}

function downloadCsvTemplate(trnType) {
  const guide = getGuide(trnType);
  const headers = guide.columns.map((column) => column.name);
  const exampleRow = guide.columns.map((column) => column.example || "");

  const csv = [headers, exampleRow]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `TC_TEMPLATE_${trnType}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

export default function TcUploadsPage() {
  const navigate = useNavigate();
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [activeHelpModal, setActiveHelpModal] = useState(null);
  const [deleteModalUpload, setDeleteModalUpload] = useState(null);
  const [deleteSuccessModalData, setDeleteSuccessModalData] = useState(null);
  const [deleteStatusMessage, setDeleteStatusMessage] = useState("");
  const [deleteTcUpload, { isLoading: isDeletingUpload }] =
    useDeleteTcUploadMutation();

  const {
    data: uploads = [],
    isLoading: isLoadingUploads,
    isFetching: isFetchingUploads,
    error: uploadsError,
  } = useGetTcUploadsQuery({ limit: 50 });

  const summary = useMemo(() => {
    const totalUploads = uploads.length;
    const readyForBgo = uploads.filter(
      (upload) => upload.bgoStatus === "READY_FOR_BGO",
    ).length;
    const needsAttention = uploads.filter(
      (upload) => upload.invalidRows > 0 || upload.withoutGeofenceRows > 0,
    ).length;
    const validated = uploads.filter((upload) =>
      String(upload.validationState).startsWith("VALIDATED"),
    ).length;

    return {
      totalUploads,
      validated,
      readyForBgo,
      needsAttention,
    };
  }, [uploads]);

  async function confirmDeleteUpload() {
    const tcId = deleteModalUpload?.id || deleteModalUpload?.tcId;

    if (!tcId) {
      setDeleteStatusMessage(
        "TC upload id is missing. Delete cannot continue.",
      );
      return;
    }

    setDeleteStatusMessage(`Deleting ${tcId}...`);

    try {
      const response = await deleteTcUpload({ tcId }).unwrap();

      setDeleteStatusMessage("");
      setDeleteSuccessModalData({
        tcId,
        fileName: deleteModalUpload?.fileName || "NAv",
        trnType: deleteModalUpload?.trnType || "NAv",
        deletedDocuments: response?.deletedDocuments || 0,
        deletedRows: response?.deletedRows || 0,
        deletedReportRows: response?.deletedReportRows || 0,
        dedupeDeleted: response?.dedupeDeleted === true,
        message: response?.message || `TC upload ${tcId} deleted successfully.`,
      });
      setDeleteModalUpload(null);
    } catch (error) {
      setDeleteStatusMessage(
        error?.message ||
          error?.data?.message ||
          error?.details?.message ||
          `Delete failed for ${tcId}. Check function logs.`,
      );
    }
  }

  return (
    <section style={styles.page}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Operations / TC Uploads</p>
          <div style={styles.titleHelpRow}>
            <h2 style={styles.title}>TC Uploads</h2>
            <div style={styles.titleHelpButtons}>
              <button
                type="button"
                style={styles.headerHelpButton}
                onClick={() => setActiveHelpModal("columns")}
              >
                ? Help Columns
              </button>
              <button
                type="button"
                style={styles.headerHelpButton}
                onClick={() => setActiveHelpModal("fileRules")}
              >
                ? Help File Rules
              </button>
              <button
                type="button"
                style={styles.headerHelpButton}
                onClick={() => setActiveHelpModal("columnRules")}
              >
                ? Help Column Rules
              </button>
              <button
                type="button"
                style={styles.headerHelpButton}
                onClick={() => setActiveHelpModal("dictionary")}
              >
                ? Help Dictionary
              </button>
              <button
                type="button"
                style={styles.headerHelpButton}
                onClick={() => setActiveHelpModal("dataFlow")}
              >
                ? Help Data Flow
              </button>
            </div>
          </div>
          <p style={styles.subtitle}>
            Upload, pre-check, validate, and prepare TRN candidate rows for BGO.
            TC v1 accepts CSV files only and uses the official upload template.
          </p>
        </div>

        <button
          type="button"
          style={styles.primaryButton}
          onClick={() => setIsUploadModalOpen(true)}
        >
          Upload TC File
        </button>
      </div>

      <div style={styles.summaryGrid}>
        <SummaryCard label="Total Uploads" value={summary.totalUploads} />
        <SummaryCard label="Validated" value={summary.validated} />
        <SummaryCard label="Ready for BGO" value={summary.readyForBgo} />
        <SummaryCard label="Needs Attention" value={summary.needsAttention} />
      </div>

      <div style={styles.panel}>
        <div style={styles.panelHeader}>
          <div>
            <h3 style={styles.panelTitle}>Upload Register</h3>
            <p style={styles.panelSubtitle}>
              Live stream from Firestore collection tc_uploads. New uploads
              should appear automatically without refreshing the page.
              {isFetchingUploads ? " Connecting..." : ""}
            </p>
            {uploadsError ? (
              <p style={styles.errorText}>
                Could not load tc_uploads. Check console/network logs.
              </p>
            ) : null}
            {deleteStatusMessage ? (
              <p style={styles.deleteStatusText}>{deleteStatusMessage}</p>
            ) : null}
          </div>

          <div style={styles.liveStreamBadge}>
            {isFetchingUploads ? "Connecting stream..." : "Live stream"}
          </div>
        </div>

        <div style={styles.filterRow}>
          <select style={styles.filterInput} defaultValue="">
            <option value="">All TRN Types</option>
            {trnTypeOptions.map((trnType) => (
              <option key={trnType} value={trnType}>
                {trnType}
              </option>
            ))}
          </select>

          <select style={styles.filterInput} defaultValue="">
            <option value="">All Validation States</option>
            <option value="UPLOADED">UPLOADED</option>
            <option value="VALIDATING">VALIDATING</option>
            <option value="VALIDATED">VALIDATED</option>
            <option value="VALIDATED_WITH_EXCEPTIONS">
              VALIDATED_WITH_EXCEPTIONS
            </option>
            <option value="FAILED">FAILED</option>
          </select>

          <select style={styles.filterInput} defaultValue="">
            <option value="">All BGO States</option>
            <option value="READY_FOR_BGO">READY_FOR_BGO</option>
            <option value="PARTIALLY_USED">PARTIALLY_USED</option>
            <option value="USED">USED</option>
            <option value="NOT_READY">NOT_READY</option>
          </select>
        </div>

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <Th>Actions</Th>
                <Th>File</Th>
                <Th>TRN Type</Th>
                <Th>LM</Th>
                <Th>Total</Th>
                <Th>Validated</Th>
                <Th>Invalidated</Th>
                <Th>Found</Th>
                <Th>Not Found</Th>
                <Th>With GF</Th>
                <Th>No GF</Th>
                <Th>Ready</Th>
                <Th>State</Th>
                <Th>BGO</Th>
                <Th>TC ID</Th>
              </tr>
            </thead>

            <tbody>
              {isLoadingUploads ? (
                <tr>
                  <Td colSpan={15}>Loading TC uploads...</Td>
                </tr>
              ) : null}

              {!isLoadingUploads && uploads.length === 0 ? (
                <tr>
                  <Td colSpan={15}>No TC uploads found yet.</Td>
                </tr>
              ) : null}

              {!isLoadingUploads
                ? uploads.map((upload) => (
                    <tr key={upload.id}>
                      <Td>
                        <div style={styles.actionCell}>
                          <Link
                            to={`/operations/tc-uploads/${upload.id}`}
                            style={styles.rowLinkButton}
                          >
                            TC Rows
                          </Link>

                          <Link
                            to={`/operations/tc-uploads/${upload.id}/final-report`}
                            style={styles.rowLinkButton}
                          >
                            Final Report ({getTcReportStatus(upload)})
                          </Link>

                          <button
                            type="button"
                            style={{
                              ...styles.deleteUploadButton,
                              ...(!canDeleteTcUploadFromUi(upload)
                                ? styles.disabledButton
                                : null),
                            }}
                            disabled={!canDeleteTcUploadFromUi(upload)}
                            onClick={() => {
                              setDeleteStatusMessage("");
                              setDeleteModalUpload(upload);
                            }}
                            title={getDeleteDisabledReason(upload)}
                          >
                            Delete Upload
                          </button>
                        </div>
                      </Td>

                      <Td>{upload.fileName}</Td>
                      <Td>{upload.trnType}</Td>
                      <Td>{upload.lmPcode}</Td>
                      <Td>{upload.totalRows}</Td>
                      <Td>{upload.validRows}</Td>
                      <Td>{upload.invalidRows}</Td>
                      <Td>{upload.foundRows}</Td>
                      <Td>{upload.notFoundRows}</Td>
                      <Td>{upload.withGeofenceRows}</Td>
                      <Td>{upload.withoutGeofenceRows}</Td>
                      <Td>{upload.readyRows}</Td>
                      <Td>
                        <Badge
                          tone={
                            upload.validationState === "VALIDATED"
                              ? "success"
                              : "warning"
                          }
                        >
                          {upload.validationState}
                        </Badge>
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            upload.bgoStatus === "READY_FOR_BGO"
                              ? "success"
                              : "neutral"
                          }
                        >
                          {upload.bgoStatus}
                        </Badge>
                      </Td>
                      <Td strong>{upload.id}</Td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        </div>
      </div>

      {isUploadModalOpen ? (
        <UploadTcFileModal
          onClose={() => setIsUploadModalOpen(false)}
          onUploadCreated={(upload, tcId) => {
            const nextTcId = tcId || upload?.id || upload?.tcId;

            setIsUploadModalOpen(false);

            if (nextTcId) {
              navigate(`/operations/tc-uploads/${nextTcId}`);
            }
          }}
          onDuplicateUpload={(tcId) => {
            setIsUploadModalOpen(false);

            if (tcId) {
              navigate(`/operations/tc-uploads/${tcId}`);
            }
          }}
        />
      ) : null}

      {deleteModalUpload ? (
        <DeleteTcUploadModal
          upload={deleteModalUpload}
          isDeleting={isDeletingUpload}
          onCancel={() => setDeleteModalUpload(null)}
          onConfirm={confirmDeleteUpload}
        />
      ) : null}

      {deleteSuccessModalData ? (
        <DeleteTcUploadSuccessModal
          result={deleteSuccessModalData}
          onClose={() => setDeleteSuccessModalData(null)}
        />
      ) : null}

      {activeHelpModal ? (
        <TcUploadsHelpModal
          type={activeHelpModal}
          onClose={() => setActiveHelpModal(null)}
        />
      ) : null}
    </section>
  );
}

function DeleteTcUploadModal({ upload, isDeleting, onCancel, onConfirm }) {
  const tcId = upload?.id || upload?.tcId || "NAv";

  return (
    <div style={styles.modalBackdrop}>
      <div style={styles.deleteModalCard}>
        <div style={styles.modalHeader}>
          <div>
            <p style={styles.eyebrow}>TC Upload Delete</p>
            <h3 style={styles.modalTitle}>Delete Upload?</h3>
            <p style={styles.modalSubtitle}>
              This will delete the TC upload and its TC rows only if no BGO
              batches and no TRNs have been created from this upload. The
              backend will run the final safety check before deleting anything.
            </p>
          </div>

          <button
            type="button"
            style={styles.closeButton}
            onClick={onCancel}
            disabled={isDeleting}
          >
            ×
          </button>
        </div>

        <div style={styles.deleteWarningBox}>
          <strong>Delete allowed only before BGO.</strong>
          <p style={styles.deleteWarningText}>
            If any TC row has been consumed by BGO, if a batchId exists, if a
            BGO batch exists, or if TRNs exist for this upload, deletion will be
            blocked.
          </p>
        </div>

        <div style={styles.deleteFactsGrid}>
          <InfoMini label="TC ID" value={tcId} />
          <InfoMini label="File" value={upload?.fileName || "NAv"} />
          <InfoMini label="TRN Type" value={upload?.trnType || "NAv"} />
          <InfoMini label="Rows" value={upload?.totalRows || 0} />
          <InfoMini label="Ready" value={upload?.readyRows || 0} />
          <InfoMini label="Used" value={upload?.usedRows || 0} />
        </div>

        <div style={styles.modalActions}>
          <button
            type="button"
            style={{
              ...styles.secondaryButton,
              ...(isDeleting ? styles.disabledButton : null),
            }}
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </button>

          <button
            type="button"
            style={{
              ...styles.dangerButton,
              ...(isDeleting ? styles.disabledButton : null),
            }}
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteTcUploadSuccessModal({ result, onClose }) {
  const tcId = result?.tcId || "NAv";

  return (
    <div style={styles.modalBackdrop}>
      <div style={styles.deleteSuccessModalCard}>
        <div style={styles.modalHeader}>
          <div>
            <p style={styles.eyebrow}>TC Upload Delete</p>
            <h3 style={styles.modalTitle}>Upload Deleted</h3>
            <p style={styles.modalSubtitle}>
              {result?.message || "TC upload and TC rows deleted successfully."}
            </p>
          </div>

          <button type="button" style={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </div>

        <div style={styles.deleteSuccessBox}>
          <strong>Delete completed.</strong>
          <p style={styles.deleteSuccessText}>
            The upload was removed before BGO/TRN creation. The upload register
            will update from the live stream.
          </p>
        </div>

        <div style={styles.deleteFactsGrid}>
          <InfoMini label="TC ID" value={tcId} />
          <InfoMini label="File" value={result?.fileName || "NAv"} />
          <InfoMini label="TRN Type" value={result?.trnType || "NAv"} />
          <InfoMini
            label="Deleted Docs"
            value={result?.deletedDocuments || 0}
          />
          <InfoMini label="Deleted Rows" value={result?.deletedRows || 0} />
          <InfoMini
            label="Report Rows"
            value={result?.deletedReportRows || 0}
          />
          <InfoMini
            label="Dedupe Lock"
            value={result?.dedupeDeleted ? "Deleted" : "NAv"}
          />
        </div>

        <div style={styles.modalActions}>
          <button type="button" style={styles.primaryButton} onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoMini({ label, value }) {
  return (
    <div style={styles.infoMiniCard}>
      <span style={styles.infoMiniLabel}>{label}</span>
      <strong style={styles.infoMiniValue}>{value}</strong>
    </div>
  );
}

function TcUploadsHelpModal({ type, onClose }) {
  const expectedHeaders = TC_UPLOAD_COLUMNS.map((column) => column.name).join(
    ",",
  );

  const titleByType = {
    columns: "TC Upload Columns Help",
    fileRules: "TC Upload File Rules Help",
    columnRules: "TC Upload Column Rules Help",
    dictionary: "TC Upload Dictionary Help",
    dataFlow: "TC Upload Data Flow Help",
  };

  return (
    <div style={styles.modalBackdrop}>
      <div style={styles.helpModalCard}>
        <div style={styles.helpModalFixedHeader}>
          <div style={styles.modalHeader}>
            <div>
              <p style={styles.eyebrow}>TC Uploads v1</p>
              <h3 style={styles.modalTitle}>{titleByType[type]}</h3>
              <p style={styles.modalSubtitle}>
                TC Uploads v1 accepts CSV files only. The uploaded file is
                checked before backend validation and before tc_uploads /
                tc_rows records are created.
              </p>
            </div>

            <button type="button" style={styles.closeButton} onClick={onClose}>
              ×
            </button>
          </div>

          <div style={styles.expectedHeaderBox}>
            <strong>Official CSV header</strong>
            <code style={styles.expectedHeaderCode}>{expectedHeaders}</code>
          </div>
        </div>

        <div style={styles.helpModalScrollBody}>
          {type === "columns" ? <HelpColumnsContent /> : null}
          {type === "fileRules" ? <HelpFileRulesContent /> : null}
          {type === "columnRules" ? <HelpColumnRulesContent /> : null}
          {type === "dictionary" ? <HelpDictionaryContent /> : null}
          {type === "dataFlow" ? <HelpDataFlowContent /> : null}
        </div>
      </div>
    </div>
  );
}

function HelpDictionaryContent() {
  return (
    <div style={styles.helpPanelFlat}>
      <h4 style={styles.helpTitle}>TC Upload vocabulary and acronyms</h4>
      <p style={styles.helpText}>
        These terms define the language used in TC Uploads, TC Rows, BGO
        readiness, and LM feedback reports. The same vocabulary should be reused
        in future TC design documents and the iREPS Dictionary.
      </p>

      <div style={styles.helpTableWrap}>
        <table style={styles.helpTable}>
          <thead>
            <tr>
              <Th help>Term</Th>
              <Th help>Meaning</Th>
              <Th help>Definition</Th>
            </tr>
          </thead>

          <tbody>
            {TC_UPLOAD_DICTIONARY.map((item) => (
              <tr key={item.term}>
                <Td help strong>
                  {item.term}
                </Td>
                <Td help>{item.meaning}</Td>
                <Td help>{item.description}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HelpDataFlowContent() {
  return (
    <div style={styles.helpPanelFlat}>
      <h4 style={styles.helpTitle}>TC Upload data flow</h4>
      <p style={styles.helpText}>
        TC Uploads starts with a CSV file. If the file structure is wrong, the
        upload stops and the user must fix the file. If the structure is
        correct, the backend can create tc_uploads and tc_rows, validate the
        rows, prepare BGO readiness, and produce LM feedback.
      </p>

      <div style={styles.flowDiagram}>
        <div style={styles.flowNodeStart}>Start</div>
        <div style={styles.flowArrow}>↓</div>
        <div style={styles.flowNode}>Upload CSV file</div>
        <div style={styles.flowArrow}>↓</div>
        <div style={styles.flowDecision}>Is the file structure correct?</div>
        <div style={styles.flowSplit}>
          <div style={styles.flowBranch}>
            <div style={styles.flowBranchLabel}>No</div>
            <div style={styles.flowNodeWarning}>Return errors</div>
            <div style={styles.flowArrow}>↓</div>
            <div style={styles.flowNodeWarning}>Fix file structure</div>
            <div style={styles.flowBackArrow}>↺ upload again</div>
          </div>

          <div style={styles.flowBranch}>
            <div style={styles.flowBranchLabel}>Yes</div>
            <div style={styles.flowNodeSuccess}>Send to backend</div>
            <div style={styles.flowArrow}>↓</div>
            <div style={styles.flowNodeSuccess}>
              Create tc_uploads + tc_rows
            </div>
            <div style={styles.flowArrow}>↓</div>
            <div style={styles.flowNodeSuccess}>
              Validate, compare, and prepare BGO readiness
            </div>
          </div>
        </div>
      </div>

      <div style={styles.helpTableWrap}>
        <table style={styles.helpTable}>
          <thead>
            <tr>
              <Th help>Step</Th>
              <Th help>Stage</Th>
              <Th help>What happens</Th>
            </tr>
          </thead>

          <tbody>
            {TC_UPLOAD_DATA_FLOW_STEPS.map((item) => (
              <tr key={item.step}>
                <Td help strong>
                  {item.step}
                </Td>
                <Td help>{item.title}</Td>
                <Td help>{item.description}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HelpColumnsContent() {
  return (
    <div style={styles.helpPanelFlat}>
      <h4 style={styles.helpTitle}>Columns required in the CSV file</h4>
      <p style={styles.helpText}>
        All 12 headers must exist. Only rowNo and meterNo require values. The
        optional upload-side columns support comparison, LM feedback, and future
        data-cleansing reports.
      </p>

      <div style={styles.helpTableWrap}>
        <table style={styles.helpTable}>
          <thead>
            <tr>
              <Th help>Column</Th>
              <Th help>Header Required?</Th>
              <Th help>Value Required?</Th>
              <Th help>Meaning</Th>
            </tr>
          </thead>

          <tbody>
            {TC_UPLOAD_COLUMNS.map((column) => (
              <tr key={column.name}>
                <Td help strong>
                  {column.name}
                </Td>
                <Td help>
                  <Badge tone={column.headerRequired ? "danger" : "neutral"}>
                    {column.headerRequired ? "YES" : "NO"}
                  </Badge>
                </Td>
                <Td help>
                  <Badge tone={column.valueRequired ? "danger" : "neutral"}>
                    {column.valueRequired ? "YES" : "NO"}
                  </Badge>
                </Td>
                <Td help>{column.meaning}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HelpFileRulesContent() {
  return (
    <div style={styles.helpPanelFlat}>
      <h4 style={styles.helpTitle}>File structure rules</h4>
      <p style={styles.helpText}>
        The file-structure gate protects iREPS from creating bad TC Upload and
        TC Row records. If the CSV structure is wrong, the user must fix the
        file and upload again.
      </p>

      <div style={styles.helpTableWrap}>
        <table style={styles.helpTable}>
          <thead>
            <tr>
              <Th help>Rule</Th>
              <Th help>Description</Th>
            </tr>
          </thead>

          <tbody>
            {TC_UPLOAD_FILE_RULES.map((item) => (
              <tr key={item.rule}>
                <Td help strong>
                  {item.rule}
                </Td>
                <Td help>{item.description}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HelpColumnRulesContent() {
  return (
    <div style={styles.helpPanelFlat}>
      <h4 style={styles.helpTitle}>Rules for each column</h4>
      <p style={styles.helpText}>
        Uploaded values are not treated as operational truth. iREPS preserves
        them for comparison with iREPS AST, premise, geofence, and future
        billing/data cleansing records.
      </p>

      <div style={styles.helpTableWrap}>
        <table style={styles.helpTable}>
          <thead>
            <tr>
              <Th help>Column</Th>
              <Th help>Data Type</Th>
              <Th help>Rules</Th>
            </tr>
          </thead>

          <tbody>
            {TC_UPLOAD_COLUMNS.map((column) => (
              <tr key={column.name}>
                <Td help strong>
                  {column.name}
                </Td>
                <Td help>{column.type}</Td>
                <Td help>{column.rule}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={styles.rulesBoxCompact}>
        <strong>Important meter number rule:</strong>
        <p style={styles.helpText}>
          Meter numbers are text. Leading zeroes must be preserved. Correct:
          04085348813. Wrong: 4085348813.
        </p>
      </div>
    </div>
  );
}

function UploadTcFileModal({ onClose, onUploadCreated, onDuplicateUpload }) {
  const [uploadAndValidateTc, { isLoading: isUploading }] =
    useUploadAndValidateTcMutation();

  const [form, setForm] = useState({
    trnType: "METER_DISCONNECTION",
    lmPcode: "ZA7423",
    wardPcode: "NAv",
    notes: "",
  });

  const [fileName, setFileName] = useState("");
  const [fileContent, setFileContent] = useState(null);
  const [precheckResult, setPrecheckResult] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [showHelp, setShowHelp] = useState(false);

  const guide = getGuide(form.trnType);
  const frontendFeedback = buildFrontendFeedback(precheckResult);

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));

    setPrecheckResult(null);
    setStatusMessage("");
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];

    setStatusMessage("");
    setPrecheckResult(null);
    setFileContent(null);

    if (!file) {
      setFileName("");
      return;
    }

    setFileName(file.name);

    const reader = new FileReader();

    reader.onload = () => {
      const content = reader.result;
      setFileContent(content);

      const nextPrecheckResult = runFrontendPrecheck({
        fileContent: content,
        fileName: file.name,
        guide,
      });

      setPrecheckResult(nextPrecheckResult);
    };

    reader.onerror = () => {
      setStatusMessage("Could not read the selected CSV file.");
    };

    reader.readAsText(file);
  }

  function rerunPrecheck() {
    const nextPrecheckResult = runFrontendPrecheck({
      fileContent,
      fileName,
      guide,
    });

    setPrecheckResult(nextPrecheckResult);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!precheckResult) {
      setStatusMessage(
        "Select a CSV file first so the frontend can pre-check it.",
      );
      return;
    }

    if (!precheckResult.passed) {
      setStatusMessage(
        "Frontend pre-check failed. Fix the file before uploading for backend validation.",
      );
      return;
    }

    const rows = (precheckResult.rows || []).map((row) => ({
      rowNumber: row.rowNumber,
      raw: row.raw,
    }));

    if (rows.length === 0) {
      setStatusMessage("No rows found to upload.");
      return;
    }

    setStatusMessage("Uploading and validating TC rows in backend...");

    try {
      const response = await uploadAndValidateTc({
        fileName,
        trnType: form.trnType,
        lmPcode: form.lmPcode,
        wardPcode: form.wardPcode,
        notes: form.notes,
        rows,
      }).unwrap();

      if (!response?.success) {
        setStatusMessage(
          response?.message || "Backend validation did not complete.",
        );
        return;
      }

      const returnedTcId =
        response?.tcId || response?.existingTcId || response?.upload?.id;

      if (response?.duplicate || response?.code === "TC_UPLOAD_DUPLICATE") {
        setStatusMessage(
          response?.message ||
            "This file was already uploaded. Opening existing TC upload.",
        );

        window.setTimeout(() => {
          if (typeof onDuplicateUpload === "function") {
            onDuplicateUpload(returnedTcId);
          }
        }, 900);

        return;
      }

      setStatusMessage(
        `Backend validation complete. TC upload created: ${returnedTcId}`,
      );

      window.setTimeout(() => {
        if (typeof onUploadCreated === "function") {
          onUploadCreated(response?.upload || null, returnedTcId);
        }
      }, 700);
    } catch (error) {
      setStatusMessage(
        error?.message ||
          error?.data?.message ||
          error?.details?.message ||
          "Backend upload/validation failed.",
      );
    }
  }

  return (
    <div style={styles.modalBackdrop}>
      <div style={styles.modalCard}>
        <div style={styles.uploadModalFixedHeader}>
          <div style={{ ...styles.modalHeader, marginBottom: 0 }}>
            <div>
              <p style={styles.eyebrow}>TC Upload</p>
              <h3 style={styles.modalTitle}>Upload TC File</h3>
              <p style={styles.modalSubtitle}>
                TC Uploads v1 accepts CSV files only. The CSV must use the
                official 12-column template. Frontend pre-check validates file
                structure; backend validation remains authoritative.
              </p>
            </div>

            <button type="button" style={styles.closeButton} onClick={onClose}>
              ×
            </button>
          </div>
        </div>

        <div style={styles.uploadModalScrollBody}>
          <div style={styles.modalToolbar}>
            <button
              type="button"
              style={styles.helpButton}
              onClick={() => setShowHelp((current) => !current)}
            >
              ? Help
            </button>

            <button
              type="button"
              style={styles.secondaryButton}
              onClick={() => downloadCsvTemplate(form.trnType)}
            >
              Download Template
            </button>

            {fileContent ? (
              <button
                type="button"
                style={styles.secondaryButton}
                onClick={rerunPrecheck}
              >
                Re-run Pre-check
              </button>
            ) : null}
          </div>

          {showHelp ? <UploadHelpPanel guide={guide} /> : null}

          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.formGrid}>
              <label style={styles.label}>
                TRN Type
                <select
                  style={styles.input}
                  value={form.trnType}
                  onChange={(event) =>
                    updateField("trnType", event.target.value)
                  }
                >
                  {trnTypeOptions.map((trnType) => (
                    <option key={trnType} value={trnType}>
                      {trnType}
                    </option>
                  ))}
                </select>
              </label>

              <label style={styles.label}>
                LM
                <input
                  style={styles.input}
                  value={form.lmPcode}
                  onChange={(event) =>
                    updateField("lmPcode", event.target.value)
                  }
                />
              </label>
            </div>

            <label style={styles.label}>
              CSV File
              <input
                style={styles.input}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
              />
            </label>

            {fileName ? (
              <div style={styles.fileNotice}>Selected file: {fileName}</div>
            ) : null}

            {precheckResult ? (
              <FrontendPrecheckPanel precheckResult={precheckResult} />
            ) : null}

            {frontendFeedback ? (
              <ValidationFeedbackPanel
                title="Validation Feedback Preview"
                subtitle="Frontend pre-check can only validate file structure and obvious row issues. Backend will fill found/not found and geofence results."
                result={frontendFeedback}
              />
            ) : null}

            <label style={styles.label}>
              Notes
              <textarea
                style={{ ...styles.input, minHeight: 90, resize: "vertical" }}
                value={form.notes}
                onChange={(event) => updateField("notes", event.target.value)}
                placeholder="Optional upload notes"
              />
            </label>

            {statusMessage ? (
              <div style={styles.modalStatus}>{statusMessage}</div>
            ) : null}

            <div style={styles.modalActions}>
              <button
                type="button"
                style={{
                  ...styles.secondaryButton,
                  ...(isUploading ? styles.disabledButton : null),
                }}
                onClick={onClose}
                disabled={isUploading}
              >
                Cancel
              </button>

              <button
                type="submit"
                style={{
                  ...styles.primaryButton,
                  ...(!precheckResult?.passed || isUploading
                    ? styles.disabledButton
                    : null),
                }}
                disabled={!precheckResult?.passed || isUploading}
              >
                {isUploading
                  ? "Uploading & Validating..."
                  : "Upload & Validate"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function UploadHelpPanel({ guide }) {
  const expectedHeaders = guide.columns.map((column) => column.name).join(",");

  return (
    <div style={styles.helpPanel}>
      <div style={styles.helpHeader}>
        <div>
          <h4 style={styles.helpTitle}>{guide.title}</h4>
          <p style={styles.helpText}>{guide.purpose}</p>
        </div>

        <div style={styles.maxRowsBadge}>Max rows: {guide.maxRows}</div>
      </div>

      <div style={styles.rulesBox}>
        <strong>CSV file structure rules:</strong>
        <ul style={styles.rulesList}>
          <li>Only .csv files are allowed for this version.</li>
          <li>The first row must be the header row.</li>
          <li>
            The CSV must contain exactly the 12 official columns shown below.
          </li>
          <li>The column order must match the official template exactly.</li>
          <li>
            rowNo and meterNo are the only columns whose values are required.
          </li>
          <li>
            All other column values may be blank, but their headers must exist.
          </li>
          <li>
            rowNo must be a positive whole number, greater than 0, and unique.
          </li>
          <li>meterNo is treated as text; leading zeroes must be preserved.</li>
          <li>Duplicate rowNo fails the file structure gate.</li>
          <li>
            Duplicate meterNo does not fail this gate; backend validation will
            classify those rows.
          </li>
          <li>Fully blank rows are ignored.</li>
          <li>
            If the file structure gate fails, fix the CSV before backend
            validation.
          </li>
        </ul>
      </div>

      <div style={styles.expectedHeaderBox}>
        <strong>Official CSV header:</strong>
        <code style={styles.expectedHeaderCode}>{expectedHeaders}</code>
      </div>

      <div style={styles.helpTableWrap}>
        <table style={styles.helpTable}>
          <thead>
            <tr>
              <Th>Column</Th>
              <Th>Header Required?</Th>
              <Th>Value Required?</Th>
              <Th>Meaning</Th>
            </tr>
          </thead>

          <tbody>
            {guide.columns.map((column) => (
              <tr key={column.name}>
                <Td strong>{column.name}</Td>
                <Td>
                  <Badge tone={column.headerRequired ? "danger" : "neutral"}>
                    {column.headerRequired ? "YES" : "NO"}
                  </Badge>
                </Td>
                <Td>
                  <Badge tone={column.valueRequired ? "danger" : "neutral"}>
                    {column.valueRequired ? "YES" : "NO"}
                  </Badge>
                </Td>
                <Td>{column.meaning}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FrontendPrecheckPanel({ precheckResult }) {
  return (
    <div
      style={{
        ...styles.precheckPanel,
        ...(precheckResult.passed
          ? styles.precheckPanelSuccess
          : styles.precheckPanelDanger),
      }}
    >
      <div style={styles.precheckTopRow}>
        <div>
          <h4 style={styles.precheckTitle}>
            Frontend Pre-check: {precheckResult.passed ? "Passed" : "Failed"}
          </h4>
          <p style={styles.precheckText}>
            Total rows: {precheckResult.totalRows} • Valid rows:{" "}
            {precheckResult.validRows} • Invalid rows:{" "}
            {precheckResult.invalidRows}
          </p>
        </div>

        <Badge tone={precheckResult.passed ? "success" : "danger"}>
          {precheckResult.passed ? "PRECHECK_PASSED" : "PRECHECK_FAILED"}
        </Badge>
      </div>

      {precheckResult.errors.length > 0 ? (
        <MessageList
          title="Errors"
          messages={precheckResult.errors}
          tone="danger"
        />
      ) : null}

      {precheckResult.warnings.length > 0 ? (
        <MessageList
          title="Warnings"
          messages={precheckResult.warnings}
          tone="warning"
        />
      ) : null}

      {precheckResult.invalidRowDetails.length > 0 ? (
        <div style={styles.smallListBox}>
          <strong>Invalid row examples</strong>
          <ul style={styles.rulesList}>
            {precheckResult.invalidRowDetails.map((row) => (
              <li key={`${row.rowNumber}-${row.reason}`}>
                {row.rowRef}: {row.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {precheckResult.duplicateMeterNos.length > 0 ? (
        <div style={styles.smallListBox}>
          <strong>Duplicate meter numbers</strong>

          <div style={styles.duplicateMeterList}>
            {precheckResult.duplicateMeterNos.map((item) => (
              <div key={item.meterNo} style={styles.duplicateMeterGroup}>
                <div style={styles.duplicateMeterTitle}>
                  {item.meterNo} • {item.count} rows
                </div>

                <ul style={styles.rulesList}>
                  {item.rows.map((row) => (
                    <li key={`${item.meterNo}-${row.rowNumber}`}>
                      {row.rowRef} - {item.meterNo}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MessageList({ title, messages, tone }) {
  return (
    <div style={tone === "danger" ? styles.errorBox : styles.warningBox}>
      <strong>{title}</strong>
      <ul style={styles.rulesList}>
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}

function ValidationFeedbackPanel({ title, subtitle, result }) {
  return (
    <div style={styles.feedbackPanel}>
      <div style={styles.feedbackHeader}>
        <div>
          <h4 style={styles.feedbackTitle}>{title}</h4>
          <p style={styles.feedbackSubtitle}>{subtitle}</p>
        </div>

        {result.backendPending ? (
          <Badge tone="warning">BACKEND_PENDING</Badge>
        ) : (
          <Badge tone="success">BACKEND_VALIDATED</Badge>
        )}
      </div>

      <div style={styles.feedbackGrid}>
        <FeedbackCard
          label="0. Total Meters"
          value={result.totalMeters}
          detail={`${result.validatedMeters} validated + ${result.invalidatedMeters} invalidated`}
        />

        <FeedbackCard
          label="1. Validated Meters"
          value={result.validatedMeters}
          detail={`${result.foundMeters} found + ${result.notFoundMeters} not found`}
        />

        <FeedbackCard
          label="2. Found / Matched"
          value={result.foundMeters}
          detail={`${result.withGeofenceMeters} with geofence + ${result.withoutGeofenceMeters} without geofence`}
        />

        <FeedbackCard
          label="3. With Geofence"
          value={result.withGeofenceMeters}
          detail={
            result.geofenceBreakdown.length > 0
              ? result.geofenceBreakdown
                  .map((item) => `${item.name} (${item.count})`)
                  .join(" + ")
              : "Backend geofence breakdown pending"
          }
        />

        <FeedbackCard
          label="4. Without Geofence"
          value={result.withoutGeofenceMeters}
          detail="Must be geofenced before BGO"
        />

        <FeedbackCard
          label="Ready for BGO"
          value={result.readyForBgo}
          detail="Only matched meters with geofence"
        />
      </div>
    </div>
  );
}

function FeedbackCard({ label, value, detail }) {
  return (
    <div style={styles.feedbackCard}>
      <span style={styles.feedbackLabel}>{label}</span>
      <strong style={styles.feedbackValue}>{value}</strong>
      <span style={styles.feedbackDetail}>{detail}</span>
    </div>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div style={styles.summaryCard}>
      <span style={styles.summaryLabel}>{label}</span>
      <strong style={styles.summaryValue}>{value}</strong>
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

function Th({ children, help = false }) {
  return <th style={help ? styles.helpTh : styles.th}>{children}</th>;
}

function Td({ children, strong = false, colSpan = undefined, help = false }) {
  return (
    <td
      colSpan={colSpan}
      style={{
        ...(help ? styles.helpTd : styles.td),
        ...(strong ? styles.strongCell : null),
      }}
    >
      {children}
    </td>
  );
}

const styles = {
  page: {
    padding: 24,
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
  eyebrow: {
    margin: 0,
    fontSize: 12,
    fontWeight: 900,
    color: "#2563eb",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  titleHelpRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    margin: "8px 0 8px",
  },
  titleHelpButtons: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  title: {
    margin: 0,
    fontSize: 28,
    color: "#0f172a",
  },
  headerHelpButton: {
    border: "1px solid #bfdbfe",
    borderRadius: 999,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "7px 10px",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  subtitle: {
    margin: 0,
    maxWidth: 760,
    color: "#64748b",
    lineHeight: 1.6,
  },
  primaryButton: {
    border: "none",
    borderRadius: 14,
    background: "#2563eb",
    color: "#ffffff",
    padding: "12px 16px",
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  disabledButton: {
    opacity: 0.55,
    cursor: "not-allowed",
  },
  secondaryButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 14,
    background: "#ffffff",
    color: "#334155",
    padding: "12px 16px",
    fontWeight: 900,
    cursor: "pointer",
  },
  dangerButton: {
    border: "1px solid #fecaca",
    borderRadius: 14,
    background: "#dc2626",
    color: "#ffffff",
    padding: "12px 16px",
    fontWeight: 900,
    cursor: "pointer",
  },
  liveStreamBadge: {
    border: "1px solid #bbf7d0",
    background: "#f0fdf4",
    color: "#166534",
    borderRadius: 999,
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  deleteStatusText: {
    margin: "8px 0 0",
    color: "#1d4ed8",
    fontSize: 13,
    fontWeight: 900,
    lineHeight: 1.5,
  },
  actionCell: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    whiteSpace: "normal",
    minWidth: 360,
  },
  rowLinkButton: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid #bfdbfe",
    borderRadius: 999,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "7px 10px",
    fontSize: 12,
    fontWeight: 900,
    textDecoration: "none",
  },
  deleteUploadButton: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid #fecaca",
    borderRadius: 999,
    background: "#fef2f2",
    color: "#991b1b",
    padding: "7px 10px",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  helpButton: {
    border: "1px solid #bfdbfe",
    borderRadius: 14,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "12px 16px",
    fontWeight: 900,
    cursor: "pointer",
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 12,
    marginBottom: 16,
  },
  summaryCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 16,
  },
  summaryLabel: {
    display: "block",
    fontSize: 12,
    fontWeight: 800,
    color: "#64748b",
    marginBottom: 8,
  },
  summaryValue: {
    fontSize: 28,
    color: "#0f172a",
  },
  panel: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 24,
    padding: 18,
  },
  panelHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  },
  panelTitle: {
    margin: 0,
    fontSize: 18,
    color: "#0f172a",
  },
  panelSubtitle: {
    margin: "6px 0 0",
    color: "#64748b",
    fontSize: 13,
  },
  errorText: {
    margin: "8px 0 0",
    color: "#991b1b",
    fontSize: 13,
    fontWeight: 800,
  },
  filterRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 14,
  },
  filterInput: {
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    padding: "10px 12px",
    minWidth: 180,
    background: "#ffffff",
  },
  tableWrap: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: 1360,
  },
  th: {
    textAlign: "left",
    fontSize: 11,
    color: "#475569",
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    padding: "12px 10px",
    whiteSpace: "nowrap",
  },
  td: {
    fontSize: 12,
    color: "#334155",
    borderBottom: "1px solid #f1f5f9",
    padding: "12px 10px",
    whiteSpace: "nowrap",
  },
  strongCell: {
    color: "#0f172a",
    fontWeight: 900,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "5px 9px",
    fontSize: 10,
    fontWeight: 900,
  },
  successBadge: {
    background: "#dcfce7",
    color: "#166534",
  },
  warningBadge: {
    background: "#fef3c7",
    color: "#92400e",
  },
  dangerBadge: {
    background: "#fee2e2",
    color: "#991b1b",
  },
  neutralBadge: {
    background: "#f1f5f9",
    color: "#475569",
  },
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    zIndex: 1000,
  },
  modalCard: {
    width: "min(960px, 100%)",
    maxHeight: "90vh",
    overflow: "hidden",
    background: "#ffffff",
    borderRadius: 24,
    border: "1px solid #e2e8f0",
    boxShadow: "0 30px 80px rgba(15, 23, 42, 0.35)",
    display: "flex",
    flexDirection: "column",
  },
  deleteModalCard: {
    width: "min(720px, 100%)",
    maxHeight: "90vh",
    overflowY: "auto",
    background: "#ffffff",
    borderRadius: 24,
    border: "1px solid #fecaca",
    boxShadow: "0 30px 80px rgba(15, 23, 42, 0.35)",
    padding: 24,
  },
  deleteSuccessModalCard: {
    width: "min(720px, 100%)",
    maxHeight: "90vh",
    overflowY: "auto",
    background: "#ffffff",
    borderRadius: 24,
    border: "1px solid #bbf7d0",
    boxShadow: "0 30px 80px rgba(15, 23, 42, 0.35)",
    padding: 24,
  },
  deleteWarningBox: {
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#991b1b",
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
  },
  deleteWarningText: {
    margin: "6px 0 0",
    color: "#7f1d1d",
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1.5,
  },
  deleteSuccessBox: {
    border: "1px solid #bbf7d0",
    background: "#f0fdf4",
    color: "#166534",
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
  },
  deleteSuccessText: {
    margin: "6px 0 0",
    color: "#166534",
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1.5,
  },
  deleteFactsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: 10,
    marginBottom: 16,
  },
  infoMiniCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    background: "#f8fafc",
    padding: 12,
  },
  infoMiniLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 5,
  },
  infoMiniValue: {
    display: "block",
    color: "#0f172a",
    fontSize: 13,
    lineHeight: 1.4,
    wordBreak: "break-word",
  },
  uploadModalFixedHeader: {
    flex: "0 0 auto",
    background: "#ffffff",
    borderBottom: "1px solid #e2e8f0",
    padding: "24px 24px 14px",
    zIndex: 2,
  },
  uploadModalScrollBody: {
    flex: "1 1 auto",
    overflowY: "auto",
    padding: "14px 24px 24px",
  },
  helpModalCard: {
    width: "min(1040px, 100%)",
    maxHeight: "90vh",
    overflow: "hidden",
    background: "#ffffff",
    borderRadius: 24,
    border: "1px solid #e2e8f0",
    boxShadow: "0 30px 80px rgba(15, 23, 42, 0.35)",
    display: "flex",
    flexDirection: "column",
  },
  helpModalFixedHeader: {
    flex: "0 0 auto",
    background: "#ffffff",
    borderBottom: "1px solid #e2e8f0",
    padding: "24px 24px 10px",
    zIndex: 2,
  },
  helpModalScrollBody: {
    flex: "1 1 auto",
    overflowY: "auto",
    padding: "14px 24px 24px",
  },
  modalHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 14,
  },
  modalToolbar: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 14,
  },
  modalTitle: {
    margin: "8px 0 6px",
    fontSize: 22,
    color: "#0f172a",
  },
  modalSubtitle: {
    margin: 0,
    color: "#64748b",
    lineHeight: 1.5,
    fontSize: 13,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    cursor: "pointer",
    fontSize: 24,
    lineHeight: 1,
  },
  helpPanel: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  helpPanelFlat: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 16,
  },
  helpHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
    marginBottom: 12,
  },
  helpTitle: {
    margin: "0 0 6px",
    color: "#0f172a",
    fontSize: 16,
  },
  helpText: {
    margin: 0,
    color: "#64748b",
    lineHeight: 1.5,
    fontSize: 13,
  },
  maxRowsBadge: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    padding: "7px 10px",
    color: "#475569",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  rulesBox: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    color: "#334155",
    fontSize: 13,
  },
  rulesBoxCompact: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 14,
    marginTop: 14,
    color: "#334155",
    fontSize: 13,
  },
  rulesList: {
    margin: "8px 0 0",
    paddingLeft: 18,
    lineHeight: 1.6,
  },
  expectedHeaderBox: {
    marginBottom: 14,
    padding: 12,
    borderRadius: 12,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    display: "grid",
    gap: 8,
    fontSize: 13,
    color: "#334155",
  },
  expectedHeaderCode: {
    display: "block",
    whiteSpace: "normal",
    wordBreak: "break-word",
    color: "#0f172a",
    fontSize: 12,
  },
  helpTableWrap: {
    width: "100%",
    overflowX: "hidden",
  },
  helpTable: {
    width: "100%",
    tableLayout: "fixed",
    borderCollapse: "collapse",
    background: "#ffffff",
    borderRadius: 12,
    overflow: "hidden",
  },
  helpTh: {
    textAlign: "left",
    fontSize: 11,
    color: "#475569",
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    padding: "12px 10px",
    whiteSpace: "normal",
    wordBreak: "break-word",
    overflowWrap: "anywhere",
    verticalAlign: "top",
  },
  helpTd: {
    fontSize: 12,
    color: "#334155",
    borderBottom: "1px solid #f1f5f9",
    padding: "12px 10px",
    whiteSpace: "normal",
    wordBreak: "break-word",
    overflowWrap: "anywhere",
    verticalAlign: "top",
    lineHeight: 1.5,
  },
  form: {
    display: "grid",
    gap: 14,
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  },
  label: {
    display: "grid",
    gap: 7,
    color: "#334155",
    fontSize: 13,
    fontWeight: 900,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    padding: "11px 12px",
    fontSize: 14,
  },
  fileNotice: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 12,
    color: "#334155",
    fontSize: 13,
  },
  precheckPanel: {
    borderRadius: 18,
    padding: 16,
    border: "1px solid #e2e8f0",
  },
  precheckPanelSuccess: {
    background: "#f0fdf4",
    borderColor: "#bbf7d0",
  },
  precheckPanelDanger: {
    background: "#fef2f2",
    borderColor: "#fecaca",
  },
  precheckTopRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 12,
  },
  precheckTitle: {
    margin: "0 0 4px",
    color: "#0f172a",
  },
  precheckText: {
    margin: 0,
    color: "#475569",
    fontSize: 13,
  },
  errorBox: {
    background: "#ffffff",
    border: "1px solid #fecaca",
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
    color: "#991b1b",
    fontSize: 13,
  },
  warningBox: {
    background: "#ffffff",
    border: "1px solid #fde68a",
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
    color: "#92400e",
    fontSize: 13,
  },
  smallListBox: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
    color: "#334155",
    fontSize: 13,
  },
  duplicateMeterList: {
    display: "grid",
    gap: 10,
    marginTop: 10,
  },
  duplicateMeterGroup: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: 10,
  },
  duplicateMeterTitle: {
    fontWeight: 900,
    color: "#0f172a",
    fontSize: 13,
  },
  feedbackPanel: {
    background: "#ffffff",
    border: "1px solid #dbeafe",
    borderRadius: 18,
    padding: 16,
  },
  feedbackHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 14,
  },
  feedbackTitle: {
    margin: "0 0 4px",
    color: "#0f172a",
  },
  feedbackSubtitle: {
    margin: 0,
    color: "#64748b",
    fontSize: 13,
    lineHeight: 1.5,
  },
  feedbackGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 10,
  },
  feedbackCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 12,
    background: "#f8fafc",
  },
  feedbackLabel: {
    display: "block",
    fontSize: 11,
    fontWeight: 900,
    color: "#64748b",
    marginBottom: 6,
  },
  feedbackValue: {
    display: "block",
    fontSize: 24,
    color: "#0f172a",
    marginBottom: 6,
  },
  feedbackDetail: {
    display: "block",
    fontSize: 12,
    color: "#475569",
    lineHeight: 1.4,
  },
  modalStatus: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    borderRadius: 14,
    padding: 12,
    fontSize: 13,
    fontWeight: 800,
  },
  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 6,
  },
  flowDiagram: {
    border: "1px solid #dbeafe",
    borderRadius: 18,
    background: "#f8fafc",
    padding: 18,
    margin: "14px 0",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  },
  flowNodeStart: {
    border: "1px solid #94a3b8",
    borderRadius: 999,
    background: "#ffffff",
    color: "#0f172a",
    padding: "10px 22px",
    fontWeight: 900,
    minWidth: 120,
    textAlign: "center",
  },
  flowNode: {
    border: "1px solid #94a3b8",
    borderRadius: 12,
    background: "#ffffff",
    color: "#0f172a",
    padding: "10px 18px",
    fontWeight: 900,
    minWidth: 180,
    textAlign: "center",
  },
  flowDecision: {
    border: "1px solid #94a3b8",
    borderRadius: 18,
    background: "#ffffff",
    color: "#0f172a",
    padding: "12px 22px",
    fontWeight: 900,
    minWidth: 240,
    textAlign: "center",
  },
  flowArrow: {
    color: "#334155",
    fontWeight: 900,
    fontSize: 18,
    lineHeight: 1,
  },
  flowSplit: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 14,
    width: "100%",
    marginTop: 4,
  },
  flowBranch: {
    border: "1px dashed #cbd5e1",
    borderRadius: 16,
    background: "#ffffff",
    padding: 14,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  },
  flowBranchLabel: {
    fontSize: 12,
    fontWeight: 900,
    color: "#475569",
    textTransform: "uppercase",
  },
  flowNodeWarning: {
    border: "1px solid #fed7aa",
    borderRadius: 12,
    background: "#fff7ed",
    color: "#9a3412",
    padding: "10px 14px",
    fontWeight: 900,
    width: "100%",
    textAlign: "center",
  },
  flowNodeSuccess: {
    border: "1px solid #bbf7d0",
    borderRadius: 12,
    background: "#f0fdf4",
    color: "#166534",
    padding: "10px 14px",
    fontWeight: 900,
    width: "100%",
    textAlign: "center",
  },
  flowBackArrow: {
    color: "#9a3412",
    fontSize: 12,
    fontWeight: 900,
  },
};
