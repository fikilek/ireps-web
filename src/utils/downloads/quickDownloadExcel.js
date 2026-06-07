import * as XLSX from "xlsx";

const NAV = "NAv";

function sanitizeSheetName(value) {
  const rawName = String(value || "Quick Download")
    .replace(/[\\/?*\[\]:]/g, " ")
    .trim();

  return (rawName || "Quick Download").slice(0, 31);
}

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

function normalizeCellValue(value) {
  if (value === null || value === undefined || value === "") return NAV;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? NAV : value.toISOString();
  if (Array.isArray(value)) return value.length ? value.join(", ") : NAV;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

export function buildQuickDownloadFileName({ fileBaseName, scope }) {
  const baseName = sanitizeFilePart(fileBaseName || "quick_download");
  const lmName = sanitizeFilePart(scope?.lmName || scope?.lmPcode || NAV);
  const wardName = sanitizeFilePart(scope?.wardLabel || scope?.wardPcode || NAV);
  const timestamp = buildTimestamp();

  return `${baseName}_${lmName}_${wardName}_${timestamp}.xlsx`;
}

export function quickDownloadExcel({
  rows = [],
  columns = [],
  fileBaseName = "quick_download",
  registryName = "Quick Download",
  scope = {},
}) {
  const exportHeaders = columns.map((column) => column.header);
  const exportRows = rows.map((row, rowIndex) => {
    return columns.reduce((accumulator, column) => {
      const value =
        typeof column.value === "function"
          ? column.value(row, rowIndex)
          : row?.[column.key];

      accumulator[column.header] = normalizeCellValue(value);
      return accumulator;
    }, {});
  });

  const worksheet = XLSX.utils.json_to_sheet(exportRows, {
    header: exportHeaders,
    skipHeader: false,
  });

  const columnWidths = exportHeaders.map((header) => {
    const maxContentLength = exportRows.reduce((maxLength, row) => {
      const textLength = String(row?.[header] || "").length;
      return Math.max(maxLength, textLength);
    }, String(header).length);

    return { wch: Math.min(Math.max(maxContentLength + 2, 12), 42) };
  });

  worksheet["!cols"] = columnWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeSheetName(registryName));

  const fileName = buildQuickDownloadFileName({ fileBaseName, scope });
  XLSX.writeFile(workbook, fileName, { bookType: "xlsx" });
}
