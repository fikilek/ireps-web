import assert from "node:assert/strict";
import test from "node:test";

import * as XLSX from "xlsx";

import {
  buildExcelArtifact,
  buildExcelColumnWidths,
  normalizeExcelCellValue,
  sanitizeExcelSheetName,
} from "../src/utils/reportPlatform/buildExcelArtifact.js";
import { buildQuickDownloadFileName } from "../src/utils/downloads/quickDownloadExcel.js";

function readArtifact(artifact) {
  return XLSX.read(artifact.bytes, { type: "array" });
}

test("buildExcelArtifact preserves header order, row order and normalized values", () => {
  const validDate = new Date("2026-08-18T12:34:56.000Z");
  const invalidDate = new Date("invalid");

  const rows = [
    {
      id: "row-2",
      user: "Beta",
      nullable: null,
      empty: "",
      arrayValue: ["TEAM A", "TEAM B"],
      objectValue: { code: "X1" },
      validDate,
      invalidDate,
    },
    {
      id: "row-1",
      user: "Alpha",
      nullable: undefined,
      empty: "value",
      arrayValue: [],
      objectValue: { code: "X2" },
      validDate: new Date("2026-08-17T00:00:00.000Z"),
      invalidDate,
    },
  ];

  const columns = [
    { header: "User", key: "user" },
    { header: "Row Index", value: (_row, rowIndex) => rowIndex },
    { header: "Nullable", key: "nullable" },
    { header: "Empty", key: "empty" },
    { header: "Array", key: "arrayValue" },
    { header: "Object", key: "objectValue" },
    { header: "Valid Date", key: "validDate" },
    { header: "Invalid Date", key: "invalidDate" },
  ];

  const artifact = buildExcelArtifact({
    rows,
    columns,
    fileName: "artifact.xlsx",
    sheetName: "User Activity Report",
  });

  assert.equal(artifact.format, "XLSX");
  assert.equal(artifact.fileName, "artifact.xlsx");
  assert.ok(artifact.bytes instanceof Uint8Array);
  assert.ok(artifact.bytes.byteLength > 0);

  const workbook = readArtifact(artifact);
  assert.deepEqual(workbook.SheetNames, ["User Activity Report"]);

  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "NAv",
    raw: false,
  });

  assert.deepEqual(matrix[0], columns.map((column) => column.header));
  assert.deepEqual(matrix[1], [
    "Beta",
    "0",
    "NAv",
    "NAv",
    "TEAM A, TEAM B",
    '{"code":"X1"}',
    validDate.toISOString(),
    "NAv",
  ]);
  assert.deepEqual(matrix[2], [
    "Alpha",
    "1",
    "NAv",
    "value",
    "NAv",
    '{"code":"X2"}',
    "2026-08-17T00:00:00.000Z",
    "NAv",
  ]);
});

test("buildExcelColumnWidths preserves the current column width calculation", () => {
  assert.deepEqual(
    buildExcelColumnWidths(
      ["Short", "Long"],
      [{ Short: "abc", Long: "x".repeat(80) }],
    ),
    [{ wch: 12 }, { wch: 42 }],
  );
});

test("normalizeExcelCellValue preserves current Quick Download normalization", () => {
  assert.equal(normalizeExcelCellValue(null), "NAv");
  assert.equal(normalizeExcelCellValue(undefined), "NAv");
  assert.equal(normalizeExcelCellValue(""), "NAv");
  assert.equal(normalizeExcelCellValue([]), "NAv");
  assert.equal(normalizeExcelCellValue(["A", "B"]), "A, B");
  assert.equal(normalizeExcelCellValue({ answer: 42 }), '{"answer":42}');
  assert.equal(
    normalizeExcelCellValue(new Date("2026-08-18T10:00:00.000Z")),
    "2026-08-18T10:00:00.000Z",
  );
  assert.equal(normalizeExcelCellValue(new Date("invalid")), "NAv");
});

test("sanitizeExcelSheetName preserves current sanitization and 31-character limit", () => {
  assert.equal(sanitizeExcelSheetName("A/B?C*D[E]:F"), "A B C D E  F");
  assert.equal(sanitizeExcelSheetName(""), "Quick Download");
  assert.equal(sanitizeExcelSheetName("x".repeat(50)).length, 31);
});

test("buildQuickDownloadFileName preserves naming convention with one supplied generation time", () => {
  const generatedAt = new Date(2026, 7, 18, 16, 11, 45);

  assert.equal(
    buildQuickDownloadFileName({
      fileBaseName: "User Activity Report",
      scope: {
        lmName: "Lesedi Local Municipality",
        wardLabel: "Last 7 Days",
      },
      generatedAt,
    }),
    "user_activity_report_lesedi_local_municipality_last_7_days_202608181611.xlsx",
  );
});
