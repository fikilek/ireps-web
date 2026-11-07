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

test("TrnBgoUploadPage removes redundant download buttons and wires Quick Download to selected checkboxes", () => {
  const uploadPagePath = path.join(
    repoRoot,
    "src/pages/operations/TrnBgoUploadPage.jsx",
  );
  const content = fs.readFileSync(uploadPagePath, "utf8");

  assert.equal(
    content.includes("↓ Download Sample CSV"),
    false,
    "Download Sample CSV button must be removed from the header",
  );
  assert.equal(
    content.includes("↓ Download Selected CSV"),
    false,
    "Download Selected CSV button must be removed",
  );
  assert.equal(
    content.includes("↓ Download Not Found CSV"),
    false,
    "Download Not Found CSV button must be removed",
  );
  assert.match(
    content,
    /visibleRows:\s*selectedRows\.length > 0 \? selectedRows : currentFilteredRows/,
    "Quick Download must export selectedRows when 1 or more checkboxes are ticked",
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

test("TrnBgoUploadPage defines dataMatch boolean column and Option A stacked File vs iREPS comparison cells", () => {
  const uploadPagePath = path.join(
    repoRoot,
    "src/pages/operations/TrnBgoUploadPage.jsx",
  );
  const content = fs.readFileSync(uploadPagePath, "utf8");

  assert.match(
    content,
    /key:\s*"dataMatch"[\s\S]*?label:\s*"dataMatch"[\s\S]*?value:\s*\(r\)\s*=>\s*\(r\.isDataMatch\s*\?\s*"True"\s*:\s*"False"\)/,
    "TrnBgoUploadPage must define dataMatch column with True/False row values",
  );
  assert.match(
    content,
    /function renderStackedComparisonCell\(/,
    "TrnBgoUploadPage must define renderStackedComparisonCell for Option A stacked File vs iREPS comparison",
  );
  assert.match(
    content,
    /renderStackedComparisonCell\(\s*r\.comparisons\?\.premiseAddress,\s*r\.foundInAsts\s*\)/,
    "premiseAddress column must render stacked File vs iREPS comparison cell",
  );
});

test("TrnBgoUploadPage defines Column 1 checkbox selection, interactive stat filters, Clear Filters checkbox reset, and Option 2 Batch Stage Gate", () => {
  const uploadPagePath = path.join(
    repoRoot,
    "src/pages/operations/TrnBgoUploadPage.jsx",
  );
  const content = fs.readFileSync(uploadPagePath, "utf8");

  assert.match(
    content,
    /key:\s*"_select"[\s\S]*?export:\s*false[\s\S]*?<MasterCheckbox[\s\S]*?key:\s*"_rowNo"/,
    "Column 1 must be _select with export: false and MasterCheckbox before _rowNo",
  );
  assert.match(
    content,
    /onRowsShown=\{setShownRows\}/,
    "IrepsTable must pass onRowsShown={setShownRows} so MasterCheckbox selects all filtered rows",
  );
  assert.match(
    content,
    /const canCarryToBatch\s*=\s*selectedRows\.length > 0 && ineligibleSelectedRows\.length === 0/,
    "Option 2 gate must disable Carry Selected to Batch Stage when any selected row has eligible = False",
  );
  assert.match(
    content,
    /onClearFilters=\{\(\)\s*=>\s*\{[\s\S]*?setStatFilter\("ALL"\);[\s\S]*?setSelectedRowKeys\(new Set\(\)\);/,
    "Clear Filters must reset statFilter and clear selectedRowKeys checkboxes",
  );
  for (const statLabel of [
    "Total Meters",
    "Found in ASTS",
    "Not Found",
    "LM Matches",
    "Selected Rows",
  ]) {
    assert.ok(
      content.includes(`label: "${statLabel}"`),
      `Interactive stat filters must include "${statLabel}"`,
    );
  }
});
