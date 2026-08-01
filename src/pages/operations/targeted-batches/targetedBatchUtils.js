import {
  getTargetedBatchDraftView,
  TARGETED_BATCH_FILE_DECISIONS,
  TARGETED_BATCH_ROW_DECISIONS,
} from "../../../redux/targetedBatchDraftModel";

export const TARGETED_BATCH_MIN_ROWS = 1;
export const TARGETED_BATCH_MAX_ROWS = 1000;

export const TARGETED_BATCH_COLUMNS = [
  "rowNo",
  "meterNo",
  "premiseAddress",
  "town",
  "sgCode",
  "actionReason",
];

export const TARGETED_BATCH_COLUMN_GUIDE = [
  {
    name: "rowNo",
    required: true,
    example: "1",
    meaning: "Positive whole-number row reference from the source file.",
  },
  {
    name: "meterNo",
    required: true,
    example: "04085348920",
    meaning: "Meter number. Keep leading zeroes.",
  },
  {
    name: "premiseAddress",
    required: false,
    example: "455 New Extension",
    meaning: "Premise or billing address, when known.",
  },
  {
    name: "town",
    required: false,
    example: "Dundee",
    meaning: "Town or locality, when known.",
  },
  {
    name: "sgCode",
    required: false,
    example: "N0FT00000000045500000",
    meaning: "Surveyor-General property code, when known.",
  },
  {
    name: "actionReason",
    required: false,
    example: "No prepaid sales for six months",
    meaning: "Why the meter is being selected for a targeted audit.",
  },
];

export function formatNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue)
    ? numberValue.toLocaleString("en-ZA")
    : "0";
}

export function formatCurrencyFromCents(value) {
  const cents = Number(value);
  const rands = Number.isFinite(cents) ? cents / 100 : 0;

  return rands.toLocaleString("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDateTime(value) {
  if (!value) return "NAv";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "NAv";

  return date.toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeCsvValue(value) {
  const text = String(value ?? "");

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function downloadTextFile({ content, fileName, type }) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadTargetedBatchTemplate() {
  const exampleRow = TARGETED_BATCH_COLUMN_GUIDE.map(
    (column) => column.example || "",
  );
  const csv = [TARGETED_BATCH_COLUMNS, exampleRow]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");

  downloadTextFile({
    content: csv,
    fileName: "TARGETED_BATCH_TEMPLATE.csv",
    type: "text/csv;charset=utf-8;",
  });
}

export function downloadTargetedBatchDraft(draft) {
  const currentDraft = getTargetedBatchDraftView(draft);
  if (!currentDraft) return;

  const csvSource = currentDraft.source?.type === "CSV_UPLOAD";
  const headers = csvSource
    ? [...TARGETED_BATCH_COLUMNS, "rowDecision", "rejectionReason"]
    : TARGETED_BATCH_COLUMNS;
  const csvRows = [
    headers,
    ...currentDraft.displayRows.map((row, index) => {
      const sourceValues = [
        row.rowNo || index + 1,
        row.meterNo || "",
        row.addressLine1 || "",
        row.town || "",
        row.standNumber || "",
        row.actionReason || currentDraft.selection.reason || "",
      ];

      return csvSource
        ? [
            ...sourceValues,
            row.rowDecision || "",
            row.rowDecisionReason || "",
          ]
        : sourceValues;
    }),
  ];

  const csv = csvRows
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");

  downloadTextFile({
    content: csv,
    fileName: `${currentDraft.id || "TARGETED_BATCH_DRAFT"}.csv`,
    type: "text/csv;charset=utf-8;",
  });
}

function parseCsvDocument(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  const errors = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const nextChar = source[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(value);
      value = "";

      if (row.some((cell) => String(cell).trim() !== "")) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    value += char;
  }

  if (inQuotes) {
    errors.push("The CSV contains an unclosed quoted value.");
  }

  row.push(value);
  if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);

  return { rows, errors };
}

export function parseCsvRows(text) {
  return parseCsvDocument(text).rows;
}

function normalizeMeterNo(value) {
  return String(value || "").trim().toUpperCase();
}

function isPositiveWholeNumber(value) {
  return /^[1-9]\d*$/.test(String(value || "").trim());
}

function buildParsedRows(csvRows, headers) {
  return csvRows.slice(1).map((cells, index) => {
    const raw = headers.reduce((accumulator, header, headerIndex) => {
      accumulator[header] = String(cells[headerIndex] ?? "").trim();
      return accumulator;
    }, {});

    return {
      sourceLine: index + 2,
      sourceColumnCount: cells.length,
      raw,
    };
  });
}

function createRejectedFileResult({ fileName, errors, totalRows = 0 }) {
  return {
    passed: false,
    status: "FAILED",
    fileDecision: TARGETED_BATCH_FILE_DECISIONS.REJECTED,
    fileName,
    headers: [],
    totalRows,
    acceptedRows: 0,
    rejectedRows: 0,
    validRows: 0,
    invalidRows: 0,
    rowAssessmentCompleted: false,
    invalidRowDetails: [],
    duplicateRowNos: [],
    duplicateMeterNos: [],
    errors: Array.isArray(errors) ? errors : [String(errors || "Unknown error")],
    warnings: [],
    rows: [],
  };
}

export function buildTargetedBatchReadFailure({ fileName, message }) {
  return createRejectedFileResult({
    fileName,
    errors: [message || "The selected file could not be read."],
  });
}

export function validateTargetedBatchCsv({ fileName, text }) {
  const fileErrors = [];
  const warnings = [];
  const parsedDocument = parseCsvDocument(text);
  const csvRows = parsedDocument.rows;
  const headers = (csvRows[0] || []).map((header) => String(header).trim());
  const parsedRows = buildParsedRows(csvRows, headers);

  if (!String(fileName || "").toLowerCase().endsWith(".csv")) {
    fileErrors.push("Only CSV files are accepted for Targeted Batch uploads.");
  }

  fileErrors.push(...parsedDocument.errors);

  const exactHeaders = TARGETED_BATCH_COLUMNS.every(
    (column, index) => headers[index] === column,
  );

  if (headers.length === 0) {
    fileErrors.push("The file has no header row.");
  } else if (
    headers.length !== TARGETED_BATCH_COLUMNS.length ||
    !exactHeaders
  ) {
    fileErrors.push(
      `CSV headers must match this exact order: ${TARGETED_BATCH_COLUMNS.join(", ")}.`,
    );
  }

  if (parsedRows.length < TARGETED_BATCH_MIN_ROWS) {
    fileErrors.push("The file must contain at least one data row.");
  }

  if (parsedRows.length > TARGETED_BATCH_MAX_ROWS) {
    fileErrors.push(
      `The file contains ${parsedRows.length} rows. The maximum is ${TARGETED_BATCH_MAX_ROWS}.`,
    );
  }

  if (fileErrors.length > 0) {
    return {
      ...createRejectedFileResult({
        fileName,
        errors: fileErrors,
        totalRows: parsedRows.length,
      }),
      headers,
    };
  }

  const rowNoCounts = new Map();
  const meterNoCounts = new Map();

  parsedRows.forEach((row) => {
    const rowNo = String(row.raw.rowNo || "").trim();
    const meterNo = normalizeMeterNo(row.raw.meterNo);

    if (isPositiveWholeNumber(rowNo)) {
      rowNoCounts.set(rowNo, (rowNoCounts.get(rowNo) || 0) + 1);
    }

    if (meterNo) {
      meterNoCounts.set(meterNo, (meterNoCounts.get(meterNo) || 0) + 1);
    }
  });

  const duplicateRowNos = Array.from(rowNoCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([rowNo]) => rowNo);
  const duplicateMeterNos = Array.from(meterNoCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([meterNo]) => meterNo);
  const duplicateRowNoSet = new Set(duplicateRowNos);
  const duplicateMeterNoSet = new Set(duplicateMeterNos);
  const invalidRowDetails = [];

  const normalizedRows = parsedRows.map((row) => {
    const rowNo = String(row.raw.rowNo || "").trim();
    const meterNo = normalizeMeterNo(row.raw.meterNo);
    const rejectionReasons = [];

    if (row.sourceColumnCount !== TARGETED_BATCH_COLUMNS.length) {
      rejectionReasons.push(
        `Expected ${TARGETED_BATCH_COLUMNS.length} columns but found ${row.sourceColumnCount}.`,
      );
    }

    if (!isPositiveWholeNumber(rowNo)) {
      rejectionReasons.push("rowNo must be a positive whole number.");
    } else if (duplicateRowNoSet.has(rowNo)) {
      rejectionReasons.push(`Duplicate rowNo ${rowNo}.`);
    }

    if (!meterNo) {
      rejectionReasons.push("meterNo is required.");
    } else if (duplicateMeterNoSet.has(meterNo)) {
      rejectionReasons.push(`Duplicate meterNo ${meterNo}.`);
    }

    const rowDecision =
      rejectionReasons.length === 0
        ? TARGETED_BATCH_ROW_DECISIONS.ACCEPT
        : TARGETED_BATCH_ROW_DECISIONS.REJECT;
    const rowDecisionReason = rejectionReasons.join(" ");

    if (rowDecision === TARGETED_BATCH_ROW_DECISIONS.REJECT) {
      invalidRowDetails.push({
        sourceLine: row.sourceLine,
        rowNo: rowNo || "NAv",
        meterNo: meterNo || "NAv",
        rowDecision,
        reasons: rejectionReasons,
      });
    }

    return {
      id: `CSV_${row.sourceLine}_${rowNo || "NO_ROW"}_${meterNo || "NO_METER"}`,
      rowNo,
      sourceLine: row.sourceLine,
      sourceColumnCount: row.sourceColumnCount,
      meterNo,
      addressLine1: String(row.raw.premiseAddress || "").trim(),
      town: String(row.raw.town || "").trim(),
      standNumber: String(row.raw.sgCode || "").trim(),
      actionReason: String(row.raw.actionReason || "").trim(),
      totalSalesC: null,
      astId: null,
      astMatchStatus: "NOT_CHECKED",
      proposedTrnType: null,
      uploadRowId: null,
      rowDecision,
      rowDecisionReason: rowDecisionReason || null,
      rowDecisionReasons: rejectionReasons,
      assessmentDecision: rowDecision,
      assessmentStatus: rowDecision,
    };
  });

  const acceptedRows = normalizedRows.filter(
    (row) => row.rowDecision === TARGETED_BATCH_ROW_DECISIONS.ACCEPT,
  ).length;
  const rejectedRows = normalizedRows.length - acceptedRows;

  if (rejectedRows > 0) {
    warnings.push(
      `${rejectedRows} row(s) were REJECTED during row assessment. Each rejected row includes a reason.`,
    );
  }

  return {
    passed: true,
    status: "PASSED",
    fileDecision: TARGETED_BATCH_FILE_DECISIONS.ACCEPTED,
    fileName,
    headers,
    totalRows: normalizedRows.length,
    acceptedRows,
    rejectedRows,
    validRows: acceptedRows,
    invalidRows: rejectedRows,
    rowAssessmentCompleted: true,
    invalidRowDetails,
    duplicateRowNos,
    duplicateMeterNos,
    errors: [],
    warnings,
    rows: normalizedRows,
  };
}

function normalizeSalesAllMeterId(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function getSalesAllMeterId(row = {}) {
  return normalizeSalesAllMeterId(
    row?.salesAllMeterId ||
      row?.sourceSalesAllMeterId ||
      row?.master?.id ||
      row?.meterNoNormalized ||
      row?.meterNo ||
      row?.id,
  );
}

export function normalizeSalesTargetRows(rows = [], selectionReason = "NAv") {
  return rows.map((row, index) => {
    const salesAllMeterId = getSalesAllMeterId(row);
    const meterNo = String(
      row?.meterNo || row?.meterNoNormalized || salesAllMeterId || "",
    ).trim();

    return {
      id: salesAllMeterId || row?.id || `SALES_${index + 1}`,
      rowNo: String(index + 1),
      sourceLine: null,
      salesAllMeterId: salesAllMeterId || null,
      sourceSalesAllMeterId: salesAllMeterId || null,
      meterNo,
      meterNoNormalized: salesAllMeterId || meterNo,
      accountNumber: String(
        row?.accountNumber || row?.accountNo || row?.customerNo || "",
      ).trim(),
      customerName: String(row?.customerName || "").trim(),
      addressLine1: String(row?.addressLine1 || "").trim(),
      town: String(row?.town || "").trim(),
      standNumber: String(row?.standNumber || row?.sgCode || "").trim(),
      wardNumberLabel: String(row?.wardNumberLabel || "").trim(),
      wardNumbers: Array.isArray(row?.wardNumbers) ? [...row.wardNumbers] : [],
      actionReason: selectionReason,
      totalSalesC: Number(row?.totalSalesC || row?.totalAmountC || 0),
      latestMonthSalesC: Number(row?.latestMonthSalesC || 0),
      latest12MonthsSalesC: Number(
        row?.latest12MonthsSalesC || row?.sales12MonthsC || 0,
      ),
      sales3MonthsC: Number(row?.sales3MonthsC || 0),
      sales6MonthsC: Number(row?.sales6MonthsC || 0),
      sales12MonthsC: Number(row?.sales12MonthsC || 0),
      sales2024C: Number(row?.sales2024C || 0),
      sales2025C: Number(row?.sales2025C || 0),
      sales2026C: Number(row?.sales2026C || 0),
      monthlySalesC: { ...(row?.monthlySalesC || row?.monthlyTotalsC || {}) },
      monthlyUnits: { ...(row?.monthlyUnits || {}) },
      monthsWithoutSales: Number(row?.monthsWithoutSales || 0),
      lastPositiveSalesMonth: row?.lastPositiveSalesMonth || null,
      sourceFileName: String(row?.sourceFileName || "").trim(),
      sourceRow: Number(row?.sourceRow || 0),
      astId: row?.astId || null,
      astMatchStatus: String(row?.astMatchStatus || "NOT_CHECKED").toUpperCase(),
      proposedTrnType: row?.proposedTrnType || null,
      masterVisibility:
        row?.masterVisibility || row?.master?.visibility || null,
    };
  });
}
