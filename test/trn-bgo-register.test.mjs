import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

test("TRN BGO Register navigation is configured in ConsoleLayout", () => {
  const consoleLayoutPath = path.join(repoRoot, "src/layouts/ConsoleLayout.jsx");
  const content = fs.readFileSync(consoleLayoutPath, "utf8");

  assert.match(
    content,
    /label:\s*"TRN BGO Register"/,
    "ConsoleLayout must label the menu item as 'TRN BGO Register'",
  );
  assert.match(
    content,
    /path:\s*"\/operations\/trn-bgo"/,
    "ConsoleLayout must route TRN BGO Register to /operations/trn-bgo",
  );
});

test("TRN BGO routes are registered in AppRoutes", () => {
  const appRoutesPath = path.join(repoRoot, "src/routes/AppRoutes.jsx");
  const content = fs.readFileSync(appRoutesPath, "utf8");

  assert.match(
    content,
    /import TrnBgoRegisterPage from "\.\.\/pages\/operations\/TrnBgoRegisterPage"/,
    "AppRoutes must import TrnBgoRegisterPage",
  );
  assert.match(
    content,
    /import TrnBgoRowsPage from "\.\.\/pages\/operations\/TrnBgoRowsPage"/,
    "AppRoutes must import TrnBgoRowsPage",
  );

  assert.match(
    content,
    /path="\/operations\/trn-bgo"[\s\S]*?<TrnBgoRegisterPage \/>/,
    "/operations/trn-bgo must render TrnBgoRegisterPage",
  );
  assert.match(
    content,
    /path="\/operations\/trn-bgo\/upload"/,
    "/operations/trn-bgo/upload must be registered",
  );
  assert.match(
    content,
    /path="\/operations\/trn-bgo\/allocation"/,
    "/operations/trn-bgo/allocation must be registered",
  );
  assert.match(
    content,
    /path="\/operations\/trn-bgo\/dashboard"/,
    "/operations/trn-bgo/dashboard must be registered",
  );
  assert.match(
    content,
    /path="\/operations\/trn-bgo-rows"/,
    "/operations/trn-bgo-rows must be registered",
  );
});

test("TRN BGO Register streams tc_uploads so all existing TRN batches display", () => {
  const registerPath = path.join(repoRoot, "src/pages/operations/TrnBgoRegisterPage.jsx");
  const content = fs.readFileSync(registerPath, "utf8");

  assert.match(
    content,
    /useGetTcUploadsQuery/,
    "Must stream tc_uploads to display all existing candidate and active TRN batches",
  );
  assert.match(
    content,
    /useDeleteTcUploadMutation/,
    "Must support deleting unaccepted/staged TC uploads",
  );
});

test("TRN BGO Register uses canonical IrepsTable component with specification columns", () => {
  const registerPath = path.join(repoRoot, "src/pages/operations/TrnBgoRegisterPage.jsx");
  const content = fs.readFileSync(registerPath, "utf8");

  // Verify IrepsTable component usage
  assert.match(
    content,
    /import IrepsTable from "\.\.\/\.\.\/components\/table\/IrepsTable"/,
    "TrnBgoRegisterPage must import IrepsTable",
  );
  assert.match(
    content,
    /<IrepsTable[\s\S]*?title="Permanent Transaction Batches"/,
    "TrnBgoRegisterPage must render IrepsTable with Permanent Transaction Batches title",
  );

  // Verify mandatory column keys and labels
  assert.match(content, /key:\s*"select"/, "Must have select checkbox column");
  assert.match(content, /key:\s*"map"/, "Must have Map column");
  assert.match(content, /label:\s*"Batch ID"/, "Must have Batch ID column");
  assert.match(content, /label:\s*"TRN Type"/, "Must have TRN Type column");
  assert.match(content, /label:\s*"File Name"/, "Must have File Name column");
  assert.match(content, /label:\s*"BGO Rows"/, "Must have BGO Rows column");
  assert.match(content, /label:\s*"Allocation"/, "Must have Allocation column");
  assert.match(content, /label:\s*"BGO Status"/, "Must have BGO Status column");
  assert.match(content, /label:\s*"Ready Meters"/, "Must have Ready Meters column");
  assert.match(content, /label:\s*"Total Meters"/, "Must have Total Meters column");
  assert.match(content, /label:\s*"LM"/, "Must have LM column");
  assert.match(content, /label:\s*"Delete BGO"/, "Must have Delete BGO column");

  // Verify top buttons
  assert.match(
    content,
    /Upload & Create TRN BGO/,
    "Must have primary 'Upload & Create TRN BGO' action button",
  );
  assert.match(
    content,
    /Allocation Board/,
    "Must have 'Allocation Board' action button",
  );
  assert.match(
    content,
    /TRN BGO Dashboard/,
    "Must have 'TRN BGO Dashboard' action button",
  );
});
