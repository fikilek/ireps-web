import { buildGmrExcelArtifact } from "../../utils/reportPlatform/buildGmrExcelArtifact.js";
import { downloadBrowserArtifact } from "../../utils/reportPlatform/downloadBrowserArtifact.js";
import { persistGeneratedReport } from "../../utils/reportPlatform/persistGeneratedReport.js";

export const GENERAL_MONTHLY_REPORT_TYPE = "GENERAL_MONTHLY_REPORT";
export const GENERAL_MONTHLY_REPORT_NAME = "General Monthly Report";
export const GENERAL_MONTHLY_REPORT_FORMAT = "XLSX";

function timestampForFileName(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("A valid generatedAt date is required.");
  }

  const pad = (item) => String(item).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
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
  const populationSize = Number(dataset?.populationSize || dataset?.rows?.length || 0);

  return `general_monthly_report_${lmName}_full_${populationSize}_${timestampForFileName(generatedAt)}.xlsx`;
}

function assertDataset(dataset) {
  if (!dataset || typeof dataset !== "object") {
    throw new TypeError("A canonical GMR dataset is required.");
  }
  if (dataset.reportType !== GENERAL_MONTHLY_REPORT_TYPE) {
    throw new TypeError("The GMR dataset reportType is invalid.");
  }
  if (!Array.isArray(dataset.rows) || dataset.rows.length === 0) {
    throw new RangeError("GMR Builder v0.1 requires at least one meter row.");
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
    throw new Error("General Monthly Report artifact is invalid.");
  }

  const summary = dataset.summary || {};
  const metadata = {
    reportType: GENERAL_MONTHLY_REPORT_TYPE,
    reportName: GENERAL_MONTHLY_REPORT_NAME,
    format: GENERAL_MONTHLY_REPORT_FORMAT,
    sourceType: "REPORT",
    sourceId: dataset?.municipality?.lmPcode || null,
    sourceScope: {
      lmPcode: dataset?.municipality?.lmPcode || null,
      lmName: dataset?.municipality?.lmName || null,
      generationMode: dataset?.generationMode || "FULL_FIELD_POPULATION",
      populationSize: dataset?.populationSize || dataset.rows.length,
      populationTotal: summary.populationTotal ?? null,
      visiblePopulation: summary.visiblePopulation ?? null,
      invisiblePopulation: summary.invisiblePopulation ?? null,
      visibleSelected: summary.visibleSelected ?? null,
      invisibleSelected: summary.invisibleSelected ?? null,
      targetCategorySelected: summary.targetCategorySelected ?? null,
      normalCategorySelected: summary.normalCategorySelected ?? null,
      categoryNotAvailableSelected: summary.categoryNotAvailableSelected ?? null,
      snapshotGeneratedAt: dataset.generatedAt || null,
      schemaVersion: dataset.schemaVersion ?? null,
    },
    itemCount: dataset.rows.length,
    fileName,
  };

  return { artifact, metadata };
}

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
  }) {
    const { artifact, metadata } = buildGeneralMonthlyManagedReport({
      dataset,
      generatedAt,
      buildArtifact,
    });

    const persistence = await persist({ artifact, metadata });

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
