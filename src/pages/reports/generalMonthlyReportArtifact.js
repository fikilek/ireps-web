import { buildGmrExcelArtifact } from "../../utils/reportPlatform/buildGmrExcelArtifact.js";
import { downloadBrowserArtifact } from "../../utils/reportPlatform/downloadBrowserArtifact.js";
import { persistGeneratedReport } from "../../utils/reportPlatform/persistGeneratedReport.js";

export const GENERAL_MONTHLY_REPORT_TYPE = "GENERAL_MONTHLY_REPORT";
export const GENERAL_MONTHLY_REPORT_NAME = "General Monthly Report";
export const GENERAL_REPORT_TYPE = "GENERAL_REPORT";
export const GENERAL_REPORT_NAME = "General Report";

// GMR-R037: a General Report is told apart from the monthly record wherever it
// is seen, starting with its own file name.
export function isGeneralReport(dataset) {
  return dataset?.reportKind === "GR" || dataset?.reportType === GENERAL_REPORT_TYPE;
}
export const GENERAL_MONTHLY_REPORT_FORMAT = "XLSX";

function timestampForFileName(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("A valid generatedAt date is required.");
  }

  const pad = (item) => String(item).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

function cleanReportMonth(value) {
  const text = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : null;
}

export function buildGeneralMonthlyReportFileName({
  dataset,
  generatedAt = new Date(),
}) {
  const lmName = String(dataset?.municipality?.lmName || "endumeni")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "endumeni";
  const stamp = timestampForFileName(generatedAt);

  if (isGeneralReport(dataset)) {
    const from = String(dataset?.startDate || "");
    const to = String(dataset?.endDate || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new TypeError("A General Report needs a start date and an end date.");
    }
    // The file name says what it is: a range, and not the payment record.
    return `general_report_not_for_payment_${lmName}_${from}_to_${to}_${stamp}.xlsx`;
  }

  const reportMonth = cleanReportMonth(dataset?.reportMonth);
  if (!reportMonth) {
    throw new TypeError("A valid GMR reportMonth is required.");
  }

  return `general_monthly_report_${lmName}_${reportMonth}_${stamp}.xlsx`;
}

function assertDataset(dataset) {
  if (!dataset || typeof dataset !== "object") {
    throw new TypeError("The server returned no report data.");
  }
  if (![GENERAL_MONTHLY_REPORT_TYPE, GENERAL_REPORT_TYPE].includes(dataset.reportType)) {
    throw new TypeError("The server returned a different report.");
  }
  // A month with no field work still produces a report (GMR-R008).
  if (!Array.isArray(dataset.fieldRows)) {
    throw new TypeError("The server returned no Field Data rows.");
  }
  if (!isGeneralReport(dataset) && !cleanReportMonth(dataset.reportMonth)) {
    throw new TypeError("The server returned an invalid reporting month.");
  }
}

export function buildGeneralMonthlyManagedReport({
  dataset,
  generatedAt = new Date(),
  buildArtifact = buildGmrExcelArtifact,
}) {
  assertDataset(dataset);

  if (typeof buildArtifact !== "function") {
    throw new TypeError("A GMR Excel artifact builder is required.");
  }

  const fileName = buildGeneralMonthlyReportFileName({ dataset, generatedAt });
  const artifact = buildArtifact({ dataset, fileName });

  if (
    !artifact ||
    artifact.format !== GENERAL_MONTHLY_REPORT_FORMAT ||
    artifact.fileName !== fileName ||
    !(artifact.bytes instanceof Uint8Array) ||
    artifact.bytes.byteLength <= 0
  ) {
    throw new Error("The workbook could not be built.");
  }

  const summary = dataset.summary || {};
  const general = isGeneralReport(dataset);
  const metadata = {
    reportType: general ? GENERAL_REPORT_TYPE : GENERAL_MONTHLY_REPORT_TYPE,
    reportName: general ? GENERAL_REPORT_NAME : GENERAL_MONTHLY_REPORT_NAME,
    format: GENERAL_MONTHLY_REPORT_FORMAT,
    sourceType: "REPORT",
    sourceId: dataset?.municipality?.lmPcode || null,
    sourceScope: {
      lmPcode: dataset?.municipality?.lmPcode || null,
      lmName: dataset?.municipality?.lmName || null,
      generationMode: dataset?.generationMode || "MONTHLY_GMR",
      reportMonth: dataset.reportMonth || null,
      startDate: dataset?.startDate || null,
      endDate: dataset?.endDate || null,
      reportingPeriodLabel: dataset?.periodLabel || dataset?.reportingPeriodLabel || null,
      isPaymentRecord: dataset?.isPaymentRecord !== false,
      isIncompleteMonth: Boolean(dataset?.isIncompleteMonth),
      payableTotal: summary.payableTotal ?? dataset.fieldRows.length,
      unplacedCount: summary.unplacedCount ?? 0,
      rulesVersion: dataset?.rulesVersion || null,
      reportSchemaVersion: dataset?.reportSchemaVersion || null,
      snapshotGeneratedAt: dataset.generatedAt || null,
      schemaVersion: dataset.schemaVersion ?? null,
    },
    itemCount: dataset.fieldRows.length,
    fileName,
  };

  return { artifact, metadata };
}

// GMR-R028/R029: each step is reported, and the report is saved before it is
// offered to the browser.
export function createGeneralMonthlyReportManagedGenerator({
  persist = persistGeneratedReport,
  download = downloadBrowserArtifact,
  buildArtifact = buildGmrExcelArtifact,
} = {}) {
  if (typeof persist !== "function" || typeof download !== "function") {
    throw new TypeError("GMR managed report dependencies are incomplete.");
  }

  return async function generateGeneralMonthlyReportManaged({
    dataset,
    generatedAt = new Date(),
    onStep = () => {},
  }) {
    onStep("BUILD");
    // Let the page show the step before the workbook is built.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const { artifact, metadata } = buildGeneralMonthlyManagedReport({
      dataset,
      generatedAt,
      buildArtifact,
    });

    onStep("SAVE");
    let persistence;
    try {
      persistence = await persist({ artifact, metadata });
    } catch (error) {
      // The workbook exists even though it was not saved: hand it back so the
      // page can still offer this copy.
      error.gmrArtifact = artifact;
      throw error;
    }

    onStep("DOWNLOAD");
    let downloaded = true;
    try {
      download(artifact);
    } catch {
      downloaded = false;
    }

    return {
      artifact,
      metadata,
      persistence,
      downloaded,
    };
  };
}

export async function generateGeneralMonthlyReportManaged(options) {
  const generate = createGeneralMonthlyReportManagedGenerator();
  return generate(options);
}
