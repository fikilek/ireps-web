import { buildExcelArtifact } from "../reportPlatform/buildExcelArtifact.js";
import { downloadBrowserArtifact } from "../reportPlatform/downloadBrowserArtifact.js";

const NAV = "NAv";

function sanitizeFilePart(value) {
  return String(value || NAV)
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "nav";
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function buildTimestamp(date = new Date()) {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
    pad2(date.getHours()),
    pad2(date.getMinutes()),
  ].join("");
}

export function buildQuickDownloadFileName({ fileBaseName, scope, generatedAt = new Date() }) {
  const baseName = sanitizeFilePart(fileBaseName || "quick_download");
  const lmName = sanitizeFilePart(scope?.lmName || scope?.lmPcode || NAV);
  const wardName = sanitizeFilePart(scope?.wardLabel || scope?.wardPcode || NAV);
  const timestamp = buildTimestamp(generatedAt);

  return `${baseName}_${lmName}_${wardName}_${timestamp}.xlsx`;
}

export function quickDownloadExcel({
  rows = [],
  columns = [],
  fileBaseName = "quick_download",
  registryName = "Quick Download",
  scope = {},
}) {
  const generatedAt = new Date();
  const fileName = buildQuickDownloadFileName({ fileBaseName, scope, generatedAt });
  const artifact = buildExcelArtifact({
    rows,
    columns,
    fileName,
    sheetName: registryName,
  });

  downloadBrowserArtifact(artifact);
}
