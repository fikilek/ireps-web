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

test("TRN BGO Register table layout conforms to specification", () => {
  const registerPath = path.join(repoRoot, "src/pages/operations/TrnBgoRegisterPage.jsx");
  const content = fs.readFileSync(registerPath, "utf8");

  // Verify mandatory columns
  assert.match(content, /label="Batch ID"/, "Must have Batch ID column");
  assert.match(content, /label="TRN Type"/, "Must have TRN Type column");
  assert.match(content, /<Th>BGO Rows<\/Th>/, "Must have BGO Rows column");
  assert.match(content, /label="Allocation"/, "Must have Allocation column");
  assert.match(content, /label="Allocated To"/, "Must have Allocated To column");
  assert.match(content, /label="Total Meters"/, "Must have Total Meters column");
  assert.match(content, /label="Ward"/, "Must have Ward column");
  assert.match(content, /label="Geofence"/, "Must have Geofence column");
  assert.match(content, /label="Created By"/, "Must have Created By column");
  assert.match(content, /<Th>Delete BGO<\/Th>/, "Must have Delete BGO column");

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

test("TRN BGO Register enforces strict category isolation from BMD batches", () => {
  const registerPath = path.join(repoRoot, "src/pages/operations/TrnBgoRegisterPage.jsx");
  const content = fs.readFileSync(registerPath, "utf8");

  assert.match(
    content,
    /function isTrnBatch/,
    "Must define isTrnBatch filter function",
  );
  assert.match(
    content,
    /batchMode !== "BMD" && opType !== "METER_DISCOVERY"/,
    "Must strictly exclude BMD / METER_DISCOVERY batches per MD-BGO-R011 and TRN-BGO-R003",
  );
});
