import * as XLSX from "xlsx";
import { OFFICIAL_HEADERS, validateSourceRows } from "../../../functions/tcUploads/stage1Validation.js";
export { OFFICIAL_HEADERS, MAX_UPLOAD_ROWS, UPLOAD_TRN_TYPES, duplicateGroups, resolveDuplicates } from "../../../functions/tcUploads/stage1Validation.js";

export function parseUpload(content, filename) {
  const extension = filename.split(".").pop().toLowerCase();
  if (!["csv", "xls", "xlsx"].includes(extension)) throw new Error("Unsupported file. Use CSV or Excel (.xls, .xlsx).");
  if (extension === "csv" && typeof content !== "string") content = new TextDecoder().decode(content);
  const csv = extension === "csv" ? parseCsv(content.replace(/^\uFEFF/, "")) : null;
  const workbook = csv ? null : XLSX.read(content, { type: "array", raw: true, cellText: true, cellNF: true });
  const sheet = workbook?.Sheets[workbook.SheetNames[0]];
  if (!csv && !sheet?.["!ref"]) throw new Error("The file contains no worksheets, headers or data.");
  // Retain physical blank rows and formatted identifiers (e.g. Excel 000000).
  const matrix = csv?.rows || XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: true, raw: false, range: 0 });
  const headers = matrix[0] || [];
  // SheetJS pads rows to worksheet width; empty trailing formatting is not an extra header.
  while (headers.length && headers.at(-1) === "") headers.pop();
  if (headers.length !== OFFICIAL_HEADERS.length || OFFICIAL_HEADERS.some((key, index) => headers[index] !== key)) throw new Error(`Headers must be exactly these 12 columns in order: ${OFFICIAL_HEADERS.join(", ")}.`);
  const warnings = [];
  const rows = matrix.slice(1).flatMap((cells, index) => {
    if (cells.every((value) => !String(value).trim())) return [];
    if (cells.slice(12).some((value) => String(value).trim())) throw new Error(`Source row ${index + 2} has values outside the 12-column template.`);
    const meterCell = sheet?.[XLSX.utils.encode_cell({ r: index + 1, c: 1 })];
    if (extension !== "csv" && meterCell?.t === "n") warnings.push(`Source row ${index + 2}: meterNo was stored as an Excel number. Its displayed identifier is preserved; missing source digits cannot be recovered. Use text cells for meter numbers.`);
    return [{ ...Object.fromEntries(OFFICIAL_HEADERS.map((key, col) => [key, String(cells[col] ?? "")])), sourcePosition: csv?.positions[index + 1] || index + 2 }];
  });
  return { rows: validateSourceRows(rows), warnings };
}

function parseCsv(text) {
  let quoted = false, fieldStart = true, afterQuote = false;
  let field = "", record = [], line = 1, startLine = 1;
  const rows = [], positions = [];
  const endRecord = () => { record.push(field); rows.push(record); positions.push(startLine); record = []; field = ""; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else { field += char; if (char === "\n" || (char === "\r" && text[i + 1] !== "\n")) line++; }
    } else if (char === ",") { record.push(field); field = ""; fieldStart = true; afterQuote = false; }
    else if (char === "\n" || char === "\r") {
      endRecord(); if (char === "\r" && text[i + 1] === "\n") i++;
      line++; startLine = line; fieldStart = true; afterQuote = false;
    }
    else if (char === '"' && fieldStart) { quoted = true; fieldStart = false; }
    else {
      if (char === '"' || afterQuote) throw new Error("Unreadable CSV quoting. Quote whole fields and escape quotes with double quotes.");
      fieldStart = false; field += char;
    }
  }
  if (quoted) throw new Error("Unreadable CSV: an opening quote has no closing quote.");
  if (field || record.length || afterQuote) endRecord();
  return { rows, positions };
}

export function sampleWorkbook() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([OFFICIAL_HEADERS, ...Array.from({ length: 10 }, () => Array(12).fill(""))]);
  sheet["!cols"] = OFFICIAL_HEADERS.map((header) => ({ wch: Math.max(16, header.length + 2) }));
  // Text formatting prevents Excel from discarding meter/account leading zeros on entry.
  for (let row = 1; row <= 10; row++) for (const col of [1, 4]) sheet[XLSX.utils.encode_cell({ r: row, c: col })] = { t: "s", v: "", z: "@" };
  sheet["!ref"] = "A1:L11";
  XLSX.utils.book_append_sheet(workbook, sheet, "TRN BGO Upload");
  return workbook;
}
