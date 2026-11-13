import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

import * as XLSX from "xlsx";
import { parseUpload, sampleWorkbook, OFFICIAL_HEADERS, MAX_UPLOAD_ROWS, duplicateGroups, resolveDuplicates } from "../src/pages/operations/trnBgoUploadParser.js";
const row = (number, meter = `00${number}`, other = {}) => ({ ...Object.fromEntries(OFFICIAL_HEADERS.map((key) => [key, ""])), rowNo: String(number), meterNo: meter, ...other });
const csv = (rows, headers = OFFICIAL_HEADERS) => [headers.join(","), ...rows.map((entry) => headers.map((key) => `"${String(entry[key] ?? "").replaceAll('"', '""')}"`).join(","))].join("\r\n");

test("CSV parser preserves quoted commas, multiline text, escaped quotes and leading zeros", () => {
  const result = parseUpload(csv([row(1, "000123", { premiseAddress: '12, Road\nUnit "A"', linkedAccountNo: "00045" })]), "original name.csv");
  assert.equal(result.rows[0].meterNo, "000123");
  assert.equal(result.rows[0].linkedAccountNo, "00045");
  assert.equal(result.rows[0].premiseAddress, '12, Road\nUnit "A"');
  const multiline = parseUpload(csv([row(1, "0001", { premiseAddress: "A\nB" }), row(2, "0002")]), "meters.csv");
  assert.deepEqual(multiline.rows.map((entry) => entry.sourcePosition), [2, 4]);
});

test("XLS and XLSX use first worksheet and preserve displayed/text meter identifiers", () => {
  for (const bookType of ["xls", "xlsx"]) {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([OFFICIAL_HEADERS, OFFICIAL_HEADERS.map((key) => row(1, "000123")[key]), OFFICIAL_HEADERS.map((key) => row(2, "000045")[key])]);
    sheet.B3 = { t: "n", v: 45, z: "000000" };
    XLSX.utils.book_append_sheet(wb, sheet, "First");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["invalid extra sheet"]]), "Ignored");
    const parsed = parseUpload(XLSX.write(wb, { bookType, type: "buffer" }), `meters.${bookType}`);
    assert.deepEqual(parsed.rows.map((entry) => entry.meterNo), ["000123", "000045"]);
    assert.equal(parsed.warnings.length, 1);
  }
});

test("strict ordered headers reject missing, extra, repeated, renamed and reordered columns", () => {
  for (const headers of [OFFICIAL_HEADERS.slice(1), [...OFFICIAL_HEADERS, "extra"], OFFICIAL_HEADERS.map((key, index) => index === 1 ? "rowNo" : key), OFFICIAL_HEADERS.map((key) => key === "meterNo" ? "MeterNo" : key), [...OFFICIAL_HEADERS].reverse()]) {
    assert.throws(() => parseUpload(csv([row(1)], headers), "meters.csv"), /12 columns in order/);
  }
});

test("nonblank source rows require supplied sequence and retain blank physical positions", () => {
  const parsed = parseUpload(`${OFFICIAL_HEADERS.join(",")}\r\n${csv([row(1)]).split("\r\n")[1]}\r\n,,,,,,,,,,,\r\n${csv([row(2)]).split("\r\n")[1]}`, "meters.csv");
  assert.deepEqual(parsed.rows.map((entry) => entry.sourcePosition), [2, 4]);
  for (const bad of ["", "1.5", "1junk", "2", "-1"]) assert.throws(() => parseUpload(csv([row(bad)]), "meters.csv"), /rowNo/);
  assert.throws(() => parseUpload(csv([row(1), row(3)]), "meters.csv"), /rowNo/);
  assert.throws(() => parseUpload(csv([row(1), row(2, "", { actionReason: "partly filled" })]), "meters.csv"), /meterNo/);
});

test("row cap counts nonblank rows: 200 passes, 201 fails with actual/max/split feedback", () => {
  assert.equal(MAX_UPLOAD_ROWS, 200);
  assert.equal(parseUpload(csv(Array.from({ length: 200 }, (_, index) => row(index + 1))), "meters.csv").rows.length, 200);
  assert.throws(() => parseUpload(csv(Array.from({ length: 201 }, (_, index) => row(index + 1))), "meters.csv"), /201.*200.*Split/);
  assert.throws(() => parseUpload(OFFICIAL_HEADERS.join(","), "meters.csv"), /0 meter rows/);
});

test("all duplicate groups require explicit winners and retain surviving original row numbers", () => {
  const source = parseUpload(csv([row(1, "0001"), row(2, "0002"), row(3, "0001"), row(4, "0002"), row(5, "0005")]), "meters.csv").rows;
  assert.deepEqual(duplicateGroups(source).map(([, entries]) => entries.length), [2, 2]);
  assert.throws(() => resolveDuplicates(source), /Choose/);
  assert.throws(() => resolveDuplicates(source, { "0001": "3" }), /0002/);
  assert.throws(() => resolveDuplicates(source, { "0001": "5", "0002": "2" }), /0001/);
  assert.deepEqual(resolveDuplicates(source, { "0001": "3", "0002": "2" }).map((entry) => entry.rowNo), ["2", "3", "5"]);
  assert.equal(source.length, 5);
});

test("sample Excel has exact headers and ten wholly empty data rows", () => {
  const wb = XLSX.read(XLSX.write(sampleWorkbook(), { type: "buffer", bookType: "xlsx" }));
  const matrix = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", blankrows: true });
  assert.deepEqual(matrix[0], OFFICIAL_HEADERS);
  assert.equal(matrix.length, 11);
  assert.ok(matrix.slice(1).every((entry) => entry.every((cell) => cell === "")));
});

test("unsupported, corrupt and malformed CSV inputs fail clearly", () => {
  assert.throws(() => parseUpload("anything", "meters.xml"), /Unsupported/);
  assert.throws(() => parseUpload(new Uint8Array([0, 1, 2]), "meters.xlsx"));
  assert.throws(() => parseUpload(`${OFFICIAL_HEADERS.join(",")}\n1,"unclosed`, "meters.csv"), /closing quote/);
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

test("TRN-BGO-R014: Ward-Grouped Batch Creation and TRN_BGO_YYYYMMDD_HHMMSS_<WARDPCODE>_<TRNCODE> Batch ID format", async () => {
  const uploadPagePath = path.join(
    repoRoot,
    "src/pages/operations/TrnBgoUploadPage.jsx",
  );
  const helpersPath = path.join(
    repoRoot,
    "functions/tcUploads/helpers.js",
  );
  const uploadContent = fs.readFileSync(uploadPagePath, "utf8");
  const helpersContent = fs.readFileSync(helpersPath, "utf8");

  assert.ok(
    uploadContent.includes("const wardBatchGroups = useMemo("),
    "TrnBgoUploadPage must compute wardBatchGroups to split carried rows into 1 batch per ward",
  );
  assert.ok(
    uploadContent.includes("const handleCreateWardBatches = async () =>"),
    "TrnBgoUploadPage must define handleCreateWardBatches to create 1 batch per ward",
  );
  assert.ok(
    helpersContent.includes("TRN_BGO_${yyyymmdd}_${hhmmss}_${geoToken}_"),
    "buildTcUploadId must generate TRN_BGO_YYYYMMDD_HHMMSS_<WARDPCODE>_<TRNCODE>",
  );

  const { buildTcUploadId } = await import("../functions/tcUploads/helpers.js");
  const fixedDate = new Date("2026-11-07T08:05:00Z"); // 10:05:00 SAST
  const batchIdWard6 = buildTcUploadId({
    date: fixedDate,
    lmPcode: "ZA5241",
    wardPcode: "ZA5241006",
    trnCode: "MDCN",
  });
  assert.equal(batchIdWard6, "TRN_BGO_20261107_100500_ZA5241006_MDCN");
});


test("TRN-BGO-R015: Batch Draft Page, Atomic All-or-Nothing Creation Callable, and Pass/Fail Allocation Modal", () => {
  const uploadPagePath = path.join(
    repoRoot,
    "src/pages/operations/TrnBgoUploadPage.jsx",
  );
  const callablesPath = path.join(
    repoRoot,
    "functions/tcUploads/callables.js",
  );
  const tcApiPath = path.join(repoRoot, "src/redux/tcApi.js");
  const uploadContent = fs.readFileSync(uploadPagePath, "utf8");
  const callablesContent = fs.readFileSync(callablesPath, "utf8");
  const tcApiContent = fs.readFileSync(tcApiPath, "utf8");

  assert.ok(
    uploadContent.includes('viewMode === "DRAFT"'),
    'TrnBgoUploadPage must render a dedicated Batch Draft Page when viewMode === "DRAFT"',
  );
  assert.ok(
    uploadContent.includes("← Back to File Inspection"),
    "Batch Draft Page must include a Back to File Inspection button",
  );
  assert.ok(
    uploadContent.includes("creationModalState ? ("),
    "TrnBgoUploadPage must render a Feedback Modal after batch creation attempt",
  );
  assert.ok(
    uploadContent.includes("handleConfirmPassModalAndNavigate"),
    "Pass modal must allow allocating created batches to a TEAM or SP or leaving unallocated and navigating to TRN BGO Register",
  );
  assert.ok(
    uploadContent.includes('navigate("/operations/trn-bgo")'),
    "Pass modal must navigate to /operations/trn-bgo where created batches are listed",
  );
  assert.ok(
    callablesContent.includes("export const onCreateTrnBgoWardBatchesCallable"),
    "functions/tcUploads/callables.js must export onCreateTrnBgoWardBatchesCallable for atomic all-or-nothing creation",
  );
  assert.ok(
    callablesContent.includes("export const onAllocateTrnBgoWardBatchesCallable"),
    "functions/tcUploads/callables.js must export onAllocateTrnBgoWardBatchesCallable for post-creation TEAM/SP allocation",
  );
  assert.ok(
    tcApiContent.includes("useCreateTrnBgoWardBatchesMutation") &&
      tcApiContent.includes("useAllocateTrnBgoWardBatchesMutation"),
    "tcApi.js must export useCreateTrnBgoWardBatchesMutation and useAllocateTrnBgoWardBatchesMutation",
  );
});
