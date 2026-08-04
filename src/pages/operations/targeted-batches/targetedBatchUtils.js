import {
  buildTargetedBatchDraftId,
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
    : [
        "proposedTbId",
        "wardPcode",
        "wardNumber",
        "erfId",
        "erfNo",
        ...TARGETED_BATCH_COLUMNS,
      ];
  const csvRows = [
    headers,
    ...currentDraft.displayRows.map((row, index) => {
      const sourceValues = [
        row.rowNo || index + 1,
        row.meterNo || "",
        row.addressLine1 || "",
        row.town || "",
        row.sgCode || "",
        row.actionReason || currentDraft.selection.reason || "",
      ];

      return csvSource
        ? [
            ...sourceValues,
            row.rowDecision || "",
            row.rowDecisionReason || "",
          ]
        : [
            row.proposedTbId || "",
            row.wardPcode || "",
            row.wardNumber || "",
            row.erfId || "",
            row.erfNo || "",
            ...sourceValues,
          ];
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

function normalizeScopeText(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeWardNumber(value) {
  const text = String(value || "")
    .trim()
    .replace(/^WARD\s*/i, "");

  if (!text) return "";
  if (/^\d+$/.test(text)) return String(Number(text));
  return text.toUpperCase();
}

function deriveWardNumberFromPcode(wardPcode, lmPcode) {
  const normalizedWardPcode = normalizeScopeText(wardPcode);
  const normalizedLmPcode = normalizeScopeText(lmPcode);

  if (
    !normalizedWardPcode ||
    !normalizedLmPcode ||
    !normalizedWardPcode.startsWith(normalizedLmPcode)
  ) {
    return "";
  }

  return normalizeWardNumber(
    normalizedWardPcode.slice(normalizedLmPcode.length),
  );
}

function uniqueNonBlank(values = []) {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

function normalizeDraftErfCandidate(candidate = {}) {
  return {
    erfId: String(candidate?.erfId || candidate?.ErfId || "").trim(),
    erfNo: String(
      candidate?.erfNo ||
        candidate?.erfNumber ||
        candidate?.ErfNo ||
        candidate?.ErfNumber ||
        "",
    ).trim(),
    lmPcode: normalizeScopeText(
      candidate?.lmPcode || candidate?.LmPcode,
    ),
    wardPcode: normalizeScopeText(
      candidate?.wardPcode || candidate?.WardPcode,
    ),
    wardNumber: normalizeWardNumber(
      candidate?.wardNumber || candidate?.WardNumber,
    ),
  };
}

function resolveLocalSalesTargetScope(row = {}, expectedLmPcode = "") {
  const salesAllMeterId = getSalesAllMeterId(row);
  const expectedLm = normalizeScopeText(expectedLmPcode);
  const candidates = [
    ...(Array.isArray(row?.erfCandidates) ? row.erfCandidates : []),
    ...(row?.erfId
      ? [
          {
            erfId: row.erfId,
            erfNo: row.erfNo || row.erfNumber,
            lmPcode: row.lmPcode,
            wardPcode: row.wardPcode,
            wardNumber: row.wardNumber,
          },
        ]
      : []),
  ]
    .map(normalizeDraftErfCandidate)
    .filter((candidate) => candidate.erfId);

  const uniqueErfIds = uniqueNonBlank(
    candidates.map((candidate) => candidate.erfId),
  );

  if (uniqueErfIds.length === 0) {
    return {
      ok: false,
      code: "SALES_ERF_REFERENCE_MISSING",
      message: `Meter ${salesAllMeterId || row?.meterNo || "NAv"} has no resolved ERF.`,
    };
  }

  if (uniqueErfIds.length > 1) {
    return {
      ok: false,
      code: "SALES_ERF_REFERENCE_AMBIGUOUS",
      message: `Meter ${salesAllMeterId || row?.meterNo || "NAv"} resolves to ${uniqueErfIds.length} ERFs.`,
    };
  }

  const erfId = uniqueErfIds[0];
  const matchingCandidates = candidates.filter(
    (candidate) => candidate.erfId === erfId,
  );
  const lmPcodes = uniqueNonBlank([
    normalizeScopeText(row?.lmPcode),
    ...matchingCandidates.map((candidate) => candidate.lmPcode),
  ]);

  if (expectedLm && lmPcodes.some((value) => value !== expectedLm)) {
    return {
      ok: false,
      code: "SALES_LM_SCOPE_MISMATCH",
      message: `Meter ${salesAllMeterId || row?.meterNo || "NAv"} does not belong to active LM ${expectedLm}.`,
    };
  }

  const lmPcode = expectedLm || lmPcodes[0] || "";
  if (!lmPcode) {
    return {
      ok: false,
      code: "SALES_LM_SCOPE_MISSING",
      message: `Meter ${salesAllMeterId || row?.meterNo || "NAv"} has no Local Municipality scope.`,
    };
  }

  const wardPcodes = uniqueNonBlank(
    matchingCandidates.map((candidate) => candidate.wardPcode),
  );

  if (wardPcodes.length !== 1) {
    return {
      ok: false,
      code:
        wardPcodes.length === 0
          ? "SALES_WARD_SCOPE_MISSING"
          : "SALES_WARD_SCOPE_AMBIGUOUS",
      message:
        wardPcodes.length === 0
          ? `Meter ${salesAllMeterId || row?.meterNo || "NAv"} has no resolved ward.`
          : `Meter ${salesAllMeterId || row?.meterNo || "NAv"} resolves to ${wardPcodes.length} wards.`,
    };
  }

  const wardPcode = wardPcodes[0];
  if (!wardPcode.startsWith(lmPcode)) {
    return {
      ok: false,
      code: "SALES_WARD_LM_SCOPE_MISMATCH",
      message: `Meter ${salesAllMeterId || row?.meterNo || "NAv"} has ward ${wardPcode}, which is outside LM ${lmPcode}.`,
    };
  }

  const candidateWardNumbers = uniqueNonBlank(
    matchingCandidates
      .map((candidate) => normalizeWardNumber(candidate.wardNumber))
      .filter(Boolean),
  );
  const derivedWardNumber = deriveWardNumberFromPcode(wardPcode, lmPcode);

  if (
    candidateWardNumbers.length > 1 ||
    (candidateWardNumbers.length === 1 &&
      derivedWardNumber &&
      candidateWardNumbers[0] !== derivedWardNumber)
  ) {
    return {
      ok: false,
      code: "SALES_WARD_NUMBER_CONFLICT",
      message: `Meter ${salesAllMeterId || row?.meterNo || "NAv"} has conflicting ward-number information.`,
    };
  }

  const wardNumber = candidateWardNumbers[0] || derivedWardNumber;
  if (!wardNumber) {
    return {
      ok: false,
      code: "SALES_WARD_NUMBER_MISSING",
      message: `Meter ${salesAllMeterId || row?.meterNo || "NAv"} has no resolved ward number.`,
    };
  }

  return {
    ok: true,
    erfId,
    erfNo: String(row?.erfNo || "").trim(),
    lmPcode,
    wardPcode,
    wardNumber,
    wardName: `Ward ${wardNumber}`,
  };
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

function normalizeSalesTargetRow({
  row,
  index,
  selectionReason,
  resolvedScope = {},
  batch = {},
}) {
  const salesAllMeterId = getSalesAllMeterId(row);
  const meterNo = String(
    row?.meterNo || row?.meterNoNormalized || salesAllMeterId || "",
  ).trim();

  return {
    id: salesAllMeterId || row?.id || `SALES_${index + 1}`,
    rowNo: String(batch?.rowNo || index + 1),
    draftRowNo: String(batch?.draftRowNo || index + 1),
    batchRowNo: String(batch?.rowNo || index + 1),
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
    standNumber: String(row?.standNumber || "").trim(),
    sgCode: String(row?.sgCode || "").trim(),
    erfId: String(resolvedScope?.erfId || row?.erfId || "").trim(),
    erfNo: String(resolvedScope?.erfNo || row?.erfNo || "").trim(),
    lmPcode: normalizeScopeText(
      resolvedScope?.lmPcode || row?.lmPcode,
    ),
    wardPcode: normalizeScopeText(
      resolvedScope?.wardPcode || row?.wardPcode,
    ),
    wardNumber: normalizeWardNumber(
      resolvedScope?.wardNumber || row?.wardNumber,
    ),
    wardName: String(
      resolvedScope?.wardName || row?.wardName || "",
    ).trim(),
    wardNumberLabel: String(
      resolvedScope?.wardName ||
        row?.wardNumberLabel ||
        (resolvedScope?.wardNumber
          ? `Ward ${resolvedScope.wardNumber}`
          : ""),
    ).trim(),
    wardNumbers: resolvedScope?.wardNumber
      ? [resolvedScope.wardNumber]
      : Array.isArray(row?.wardNumbers)
        ? [...row.wardNumbers]
        : [],
    draftBatchKey: String(batch?.draftBatchKey || "").trim(),
    proposedTbId: String(batch?.tbId || "").trim(),
    batchSequence: Number(batch?.sequence || 0),
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
    astMatchStatus: String(
      row?.astMatchStatus || "NOT_CHECKED",
    ).toUpperCase(),
    proposedTrnType: row?.proposedTrnType || null,
    masterVisibility:
      row?.masterVisibility || row?.master?.visibility || null,
  };
}

export function normalizeSalesTargetRows(rows = [], selectionReason = "NAv") {
  return rows.map((row, index) => {
    const resolvedScope = resolveLocalSalesTargetScope(row, row?.lmPcode);

    return normalizeSalesTargetRow({
      row,
      index,
      selectionReason,
      resolvedScope: resolvedScope.ok ? resolvedScope : {},
    });
  });
}

export function buildSalesTargetedBatchDraftPlan({
  rows = [],
  selectionReason = "NAv",
  lmPcode = "",
  lmName = "NAv",
} = {}) {
  const normalizedLmPcode = normalizeScopeText(lmPcode);
  const failures = [];
  const resolvedRows = [];
  const seenSalesIds = new Set();

  rows.forEach((row, index) => {
    const salesAllMeterId = getSalesAllMeterId(row);

    if (!salesAllMeterId) {
      failures.push({
        row: index + 1,
        meterNo: String(row?.meterNo || "NAv"),
        code: "SALES_ID_MISSING",
        message: `Selected row ${index + 1} has no Sales All Meters identity.`,
      });
      return;
    }

    if (seenSalesIds.has(salesAllMeterId)) {
      failures.push({
        row: index + 1,
        salesAllMeterId,
        meterNo: String(row?.meterNo || salesAllMeterId),
        code: "DUPLICATE_SALES_ID",
        message: `Sales meter ${salesAllMeterId} is selected more than once.`,
      });
      return;
    }

    seenSalesIds.add(salesAllMeterId);
    const scopeResolution = resolveLocalSalesTargetScope(
      row,
      normalizedLmPcode,
    );

    if (!scopeResolution.ok) {
      failures.push({
        row: index + 1,
        salesAllMeterId,
        meterNo: String(row?.meterNo || salesAllMeterId),
        code: scopeResolution.code,
        message: scopeResolution.message,
      });
      return;
    }

    resolvedRows.push({
      sourceRow: row,
      sourceIndex: index,
      salesAllMeterId,
      scope: scopeResolution,
    });
  });

  if (failures.length > 0) {
    return {
      ok: false,
      code: "TARGETED_BATCH_DRAFT_RULES_FAILED",
      message: `${failures.length} selected meter${
        failures.length === 1 ? "" : "s"
      } cannot be placed into a ward-compliant Targeted Batch Draft.`,
      failures,
    };
  }

  const groupsByWard = new Map();

  resolvedRows.forEach((record) => {
    const key = record.scope.wardPcode;
    if (!groupsByWard.has(key)) groupsByWard.set(key, []);
    groupsByWard.get(key).push(record);
  });

  const sortedGroups = Array.from(groupsByWard.entries()).sort(
    ([leftPcode, leftRows], [rightPcode, rightRows]) => {
      const leftWard = leftRows[0]?.scope?.wardNumber || leftPcode;
      const rightWard = rightRows[0]?.scope?.wardNumber || rightPcode;
      return String(leftWard).localeCompare(String(rightWard), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    },
  );

  const firstTbId = buildTargetedBatchDraftId();
  const creationGroupId = firstTbId.replace(/^TGB_/, "TBCG_");
  let globalRowNo = 0;

  const proposedBatches = sortedGroups.map(
    ([wardPcode, groupRows], groupIndex) => {
      const tbId = groupIndex === 0 ? firstTbId : buildTargetedBatchDraftId();
      const scope = groupRows[0].scope;
      const draftBatchKey = `${wardPcode}::${tbId}`;
      const normalizedRows = groupRows.map((record, rowIndex) => {
        globalRowNo += 1;

        return normalizeSalesTargetRow({
          row: record.sourceRow,
          index: record.sourceIndex,
          selectionReason,
          resolvedScope: record.scope,
          batch: {
            draftBatchKey,
            tbId,
            sequence: groupIndex + 1,
            rowNo: rowIndex + 1,
            draftRowNo: globalRowNo,
          },
        });
      });

      return {
        draftBatchKey,
        sequence: groupIndex + 1,
        tbId,
        scope: {
          lmPcode: normalizedLmPcode,
          lmName: String(lmName || "NAv").trim() || "NAv",
          wardPcode,
          wardNumber: scope.wardNumber,
          wardName: scope.wardName,
        },
        rowCount: normalizedRows.length,
        salesAllMeterIds: normalizedRows.map(
          (row) => row.salesAllMeterId,
        ),
        rows: normalizedRows,
        validation: {
          status: "PASSED",
          oneWardOnly: true,
        },
      };
    },
  );

  const displayRows = proposedBatches.flatMap((batch) => batch.rows);

  return {
    ok: true,
    creationGroup: {
      id: creationGroupId,
      proposedBatchCount: proposedBatches.length,
    },
    proposedBatches,
    displayRows,
    salesAllMeterIds: displayRows.map((row) => row.salesAllMeterId),
    validation: {
      status: "PASSED",
      passed: true,
      totalRows: displayRows.length,
      acceptedRows: displayRows.length,
      rejectedRows: 0,
      proposedBatchCount: proposedBatches.length,
      wardGroupingApplied: true,
      errors: [],
      warnings: [],
    },
  };
}

export function downloadTargetedBatchRows({ batch, rows = [] }) {
  const headers = [
    "tbId",
    "tbRowId",
    "rowNo",
    "sourceType",
    "sourceReference",
    "rowOutcome",
    "rejectionReason",
    "meterNo",
    "accountNumber",
    "customerName",
    "address",
    "town",
    "sgCode",
    "actionReason",
    "astMatchStatus",
    "proposedTrnType",
    "allocationStatus",
    "allocationTargetType",
    "allocationTargetId",
    "allocationTargetName",
    "fieldAcceptanceStatus",
    "premiseStatus",
    "premiseId",
    "meterDiscoveryStatus",
    "meterDiscoveryTrnId",
    "completionStatus",
    "astId",
    "salesAllMeterId",
    "totalSalesC",
  ];

  const csvRows = [
    headers,
    ...rows.map((row) => [
      batch?.id || "",
      row?.tbRowId || "",
      row?.rowNo || "",
      row?.sourceType || batch?.source?.type || "",
      row?.sourceReference || "",
      row?.outcome || "",
      row?.rejectionReason || "",
      row?.meterNo || "",
      row?.accountNumber || "",
      row?.customerName || "",
      row?.address || "",
      row?.town || "",
      row?.sgCode || "",
      row?.actionReason || "",
      row?.astMatchStatus || "",
      row?.proposedTrnType || "",
      row?.allocationStatus || "",
      row?.allocationTarget?.type || "",
      row?.allocationTarget?.id || "",
      row?.allocationTarget?.name || "",
      row?.fieldAcceptanceStatus || "",
      row?.premiseStatus || "",
      row?.premiseId || "",
      row?.meterDiscoveryStatus || "",
      row?.meterDiscoveryTrnId || "",
      row?.completionStatus || "",
      row?.astId || "",
      row?.salesAllMeterId || "",
      row?.totalSalesC ?? "",
    ]),
  ];

  const csv = csvRows
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");

  downloadTextFile({
    content: csv,
    fileName: `${batch?.id || "TARGETED_BATCH"}_TB_ROWS.csv`,
    type: "text/csv;charset=utf-8;",
  });
}
