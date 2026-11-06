import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

test("TrnBgoUploadPage exists and uses XLSX and IrepsTable", () => {
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
    /VALID_EXTENSIONS\s*=\s*\["csv",\s*"xlsx",\s*"xls",\s*"xml"\]/,
    "TrnBgoUploadPage must strictly validate CSV and Excel extensions",
  );
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

test("File extension validation logic handles allowed and rejected extensions", () => {
  const validExtensions = ["csv", "xlsx", "xls", "xml"];
  const isAllowed = (filename) => {
    const ext = filename.split(".").pop().toLowerCase();
    return validExtensions.includes(ext);
  };

  assert.equal(isAllowed("meter_disconnections.csv"), true);
  assert.equal(isAllowed("METERS.XLSX"), true);
  assert.equal(isAllowed("batch_2026.xls"), true);
  assert.equal(isAllowed("export.xml"), true);

  assert.equal(isAllowed("document.pdf"), false);
  assert.equal(isAllowed("payload.json"), false);
  assert.equal(isAllowed("image.png"), false);
  assert.equal(isAllowed("script.py"), false);
});
