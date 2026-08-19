import { buildQuickDownloadFileName } from "../../utils/downloads/quickDownloadExcel.js";
import { buildExcelArtifact } from "../../utils/reportPlatform/buildExcelArtifact.js";
import { downloadBrowserArtifact } from "../../utils/reportPlatform/downloadBrowserArtifact.js";
import { persistGeneratedReport } from "../../utils/reportPlatform/persistGeneratedReport.js";

const USER_ACTIVITY_REPORT_TYPE = "USER_ACTIVITY";
const USER_ACTIVITY_REPORT_NAME = "User Activity Report";
const USER_ACTIVITY_REPORT_FORMAT = "XLSX";

function assertRowsAndColumns(rows, columns) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new RangeError("User Activity managed report requires at least one row.");
  }

  if (!Array.isArray(columns) || columns.length === 0) {
    throw new TypeError("User Activity managed report requires report columns.");
  }
}

function normalizeSourceScope(sourceScope, scope) {
  if (sourceScope && typeof sourceScope === "object" && !Array.isArray(sourceScope)) {
    return sourceScope;
  }

  return {
    view: "FILTERED_SORTED_ROWS",
    lmPcode: scope?.lmPcode || null,
    lmName: scope?.lmName || null,
    dateRange: scope?.wardLabel || null,
  };
}

export function buildUserActivityManagedReport({
  rows,
  columns,
  scope = {},
  sourceScope = null,
  generatedAt = new Date(),
  buildArtifact = buildExcelArtifact,
}) {
  assertRowsAndColumns(rows, columns);

  if (typeof buildArtifact !== "function") {
    throw new TypeError("A canonical Excel artifact builder is required.");
  }

  const fileName = buildQuickDownloadFileName({
    fileBaseName: "user_activity_report",
    scope,
    generatedAt,
  });

  const artifact = buildArtifact({
    rows,
    columns,
    fileName,
    sheetName: USER_ACTIVITY_REPORT_NAME,
  });

  if (
    !artifact ||
    artifact.format !== USER_ACTIVITY_REPORT_FORMAT ||
    artifact.fileName !== fileName ||
    !(artifact.bytes instanceof Uint8Array) ||
    artifact.bytes.byteLength <= 0
  ) {
    throw new Error("User Activity report artifact is invalid.");
  }

  const metadata = {
    reportType: USER_ACTIVITY_REPORT_TYPE,
    reportName: USER_ACTIVITY_REPORT_NAME,
    format: USER_ACTIVITY_REPORT_FORMAT,
    sourceType: "REPORT",
    sourceId: null,
    sourceScope: normalizeSourceScope(sourceScope, scope),
    itemCount: rows.length,
    fileName,
  };

  return {
    artifact,
    metadata,
  };
}

export function createUserActivityManagedReportGenerator({
  persist = persistGeneratedReport,
  download = downloadBrowserArtifact,
  buildArtifact = buildExcelArtifact,
} = {}) {
  if (typeof persist !== "function" || typeof download !== "function") {
    throw new TypeError("User Activity managed report dependencies are incomplete.");
  }

  return async function generateUserActivityManagedReport({
    rows,
    columns,
    scope = {},
    sourceScope = null,
    generatedAt = new Date(),
  }) {
    const { artifact, metadata } = buildUserActivityManagedReport({
      rows,
      columns,
      scope,
      sourceScope,
      generatedAt,
      buildArtifact,
    });

    const persistence = await persist({
      artifact,
      metadata,
    });

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

export async function generateUserActivityManagedReport(options) {
  const generate = createUserActivityManagedReportGenerator();
  return generate(options);
}
