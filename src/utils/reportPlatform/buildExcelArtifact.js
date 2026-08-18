import * as XLSX from "xlsx";

const NAV = "NAv";

export function sanitizeExcelSheetName(value) {
  const rawName = String(value || "Quick Download")
    .replace(/[\\/?*[\]:]/g, " ")
    .trim();

  return (rawName || "Quick Download").slice(0, 31);
}

export function normalizeExcelCellValue(value) {
  if (value === null || value === undefined || value === "") return NAV;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? NAV : value.toISOString();
  if (Array.isArray(value)) return value.length ? value.join(", ") : NAV;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

export function buildExcelColumnWidths(exportHeaders, exportRows) {
  return exportHeaders.map((header) => {
    const maxContentLength = exportRows.reduce((maxLength, row) => {
      const textLength = String(row?.[header] || "").length;
      return Math.max(maxLength, textLength);
    }, String(header).length);

    return { wch: Math.min(Math.max(maxContentLength + 2, 12), 42) };
  });
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return Uint8Array.from(value || []);
}

export function buildExcelArtifact({
  rows = [],
  columns = [],
  fileName,
  sheetName = "Quick Download",
}) {
  const exportHeaders = columns.map((column) => column.header);
  const exportRows = rows.map((row, rowIndex) => {
    return columns.reduce((accumulator, column) => {
      const value =
        typeof column.value === "function"
          ? column.value(row, rowIndex)
          : row?.[column.key];

      accumulator[column.header] = normalizeExcelCellValue(value);
      return accumulator;
    }, {});
  });

  const worksheet = XLSX.utils.json_to_sheet(exportRows, {
    header: exportHeaders,
    skipHeader: false,
  });

  worksheet["!cols"] = buildExcelColumnWidths(exportHeaders, exportRows);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeExcelSheetName(sheetName));

  const bytes = toUint8Array(
    XLSX.write(workbook, {
      bookType: "xlsx",
      type: "array",
    }),
  );

  return {
    format: "XLSX",
    fileName,
    bytes,
  };
}
