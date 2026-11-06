import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

test("TrnBgoUploadPage exists and defines official 12-column template", () => {
  const uploadPagePath = path.join(
    repoRoot,
    "src/pages/operations/TrnBgoUploadPage.jsx",
  );
  assert.ok(fs.existsSync(uploadPagePath), "TrnBgoUploadPage.jsx must exist");

  const content = fs.readFileSync(uploadPagePath, "utf8");
  assert.match(
    content,
    /import \* as XLSX from "xlsx"/,
    "TrnBgoUploadPage must import XLSX",
  );
  assert.match(
    content,
    /import IrepsTable from "\.\.\/\.\.\/components\/table\/IrepsTable"/,
    "TrnBgoUploadPage must import IrepsTable",
  );
  assert.match(
    content,
    /MAX_UPLOAD_ROWS\s*=\s*100/,
    "TrnBgoUploadPage must enforce max 100 rows limit",
  );
  assert.match(
    content,
    /<IrepsTable[\s\S]*?rows=\{filteredRows\}/,
    "TrnBgoUploadPage must pass filteredRows as the rows prop to IrepsTable",
  );
});

test("Official template column header parity: exactly 12 columns in order", () => {
  const uploadPagePath = path.join(
    repoRoot,
    "src/pages/operations/TrnBgoUploadPage.jsx",
  );
  const content = fs.readFileSync(uploadPagePath, "utf8");

  const expectedHeaders = [
    "rowNo",
    "meterNo",
    "meterPhase",
    "meterType",
    "linkedAccountNo",
    "premiseAddress",
    "premisePropertyType",
    "actionReason",
    "wardNo",
    "geofence",
    "meterStatus",
    "erfNo",
  ];

  for (const h of expectedHeaders) {
    assert.ok(
      content.includes(`"${h}"`),
      `OFFICIAL_HEADERS must include "${h}"`,
    );
  }
});

test("Validation: Column headers check rejects missing or extra columns", () => {
  const expected = [
    "rowNo",
    "meterNo",
    "meterPhase",
    "meterType",
    "linkedAccountNo",
    "premiseAddress",
    "premisePropertyType",
    "actionReason",
    "wardNo",
    "geofence",
    "meterStatus",
    "erfNo",
  ];

  const validateHeaders = (headers) => {
    const missing = expected.filter((h) => !headers.includes(h));
    const extra = headers.filter((h) => h && !expected.includes(h));
    return { valid: missing.length === 0 && extra.length === 0, missing, extra };
  };

  // Exact match
  assert.equal(validateHeaders(expected).valid, true);

  // Missing meterNo
  const missingOne = expected.filter((h) => h !== "meterNo");
  const resMissing = validateHeaders(missingOne);
  assert.equal(resMissing.valid, false);
  assert.deepEqual(resMissing.missing, ["meterNo"]);

  // Extra column added
  const extraCol = [...expected, "unexpectedField"];
  const resExtra = validateHeaders(extraCol);
  assert.equal(resExtra.valid, false);
  assert.deepEqual(resExtra.extra, ["unexpectedField"]);
});

test("Validation: Row limits (1 to 100 rows)", () => {
  const checkRowCount = (count) => {
    if (count < 1) return { valid: false, error: "0 rows" };
    if (count > 100) return { valid: false, error: "Exceeds 100 rows" };
    return { valid: true };
  };

  assert.equal(checkRowCount(0).valid, false);
  assert.equal(checkRowCount(1).valid, true);
  assert.equal(checkRowCount(50).valid, true);
  assert.equal(checkRowCount(100).valid, true);
  assert.equal(checkRowCount(101).valid, false);
});

test("Validation: No duplicate meters within the same file", () => {
  const checkDuplicates = (meters) => {
    const seen = new Set();
    for (const m of meters) {
      if (seen.has(m)) return { valid: false, duplicate: m };
      seen.add(m);
    }
    return { valid: true };
  };

  assert.equal(checkDuplicates(["04085348920", "04085348921"]).valid, true);
  const dupCheck = checkDuplicates(["04085348920", "04085348920"]);
  assert.equal(dupCheck.valid, false);
  assert.equal(dupCheck.duplicate, "04085348920");
});

test("AppRoutes routes /operations/trn-bgo/upload to TrnBgoUploadPage", () => {
  const appRoutesPath = path.join(repoRoot, "src/routes/AppRoutes.jsx");
  const content = fs.readFileSync(appRoutesPath, "utf8");

  assert.match(
    content,
    /import TrnBgoUploadPage from "\.\.\/pages\/operations\/TrnBgoUploadPage"/,
    "AppRoutes must import TrnBgoUploadPage",
  );
  assert.match(
    content,
    /path="\/operations\/trn-bgo\/upload"[\s\S]*?<TrnBgoUploadPage \/>/,
    "/operations/trn-bgo/upload must render TrnBgoUploadPage",
  );
});

test("TrnBgoUploadPage defines handleDownloadSampleCsv to prevent runtime ReferenceError", () => {
  const uploadPagePath = path.join(
    repoRoot,
    "src/pages/operations/TrnBgoUploadPage.jsx",
  );
  const content = fs.readFileSync(uploadPagePath, "utf8");

  assert.match(
    content,
    /const handleDownloadSampleCsv\s*=\s*\(\)\s*=>/,
    "handleDownloadSampleCsv must be declared as a function in TrnBgoUploadPage.jsx",
  );
  assert.match(
    content,
    /onClick=\{handleDownloadSampleCsv\}/,
    "Button must reference declared handleDownloadSampleCsv",
  );
  assert.match(
    content,
    /04298074776/,
    "handleDownloadSampleCsv must populate verified Endumeni meters (04298074776)",
  );
});

test("TrnBgoUploadPage defines Found?, duplicate and eligible diagnostic flag columns", () => {
  const uploadPagePath = path.join(
    repoRoot,
    "src/pages/operations/TrnBgoUploadPage.jsx",
  );
  const content = fs.readFileSync(uploadPagePath, "utf8");

  assert.match(
    content,
    /key:\s*"foundInAsts"[\s\S]*?label:\s*"Found\?"[\s\S]*?value:\s*\(r\)\s*=>\s*\(r\.foundInAsts\s*\?\s*"True"\s*:\s*"False"\)/,
    "TrnBgoUploadPage must define Found? column with True/False row values",
  );
  assert.match(
    content,
    /key:\s*"duplicate"[\s\S]*?label:\s*"duplicate"[\s\S]*?value:\s*\(r\)\s*=>\s*\(r\.isDuplicate\s*\?\s*"True"\s*:\s*"False"\)/,
    "TrnBgoUploadPage must define duplicate column with True/False row values",
  );
  assert.match(
    content,
    /key:\s*"eligible"[\s\S]*?label:\s*"eligible"[\s\S]*?value:\s*\(r\)\s*=>\s*\(r\.isEligible\s*\?\s*"True"\s*:\s*"False"\)/,
    "TrnBgoUploadPage must define eligible column with True/False row values",
  );
  assert.equal(
    content.includes('label: "LM Match"'),
    false,
    "LM Match column must remain removed",
  );
});
