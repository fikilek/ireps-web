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
  assert.match(content, /label:\s*"Total Meters"/, "Must have Total Meters column");
  assert.match(content, /label:\s*"In Progress"/, "Must have In Progress column");
  assert.match(content, /label:\s*"Completed"/, "Must have Completed column");
  assert.match(content, /label:\s*"Ward"/, "Must have Ward column");
  assert.match(content, /label:\s*"Delete BGO"/, "Must have Delete BGO column");

  // Verify LM column is NOT in table columns, but in header
  assert.doesNotMatch(
    content,
    /key:\s*"lmPcode",\s*label:\s*"LM"/,
    "LM column must be removed from the table",
  );
  assert.match(
    content,
    /style=\{styles\.lmHeaderPill\}/,
    "Local Municipality must be displayed in the page header",
  );

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

test("TRN BGO Register renders 4 lifecycle KPI cards with '?' help button and meter counts", () => {
  const registerPath = path.join(repoRoot, "src/pages/operations/TrnBgoRegisterPage.jsx");
  const content = fs.readFileSync(registerPath, "utf8");

  // Verify 4 required KPI card labels
  assert.match(content, /label="Total Batches"/, "Must render Total Batches KPI card");
  assert.match(content, /label="Unallocated"/, "Must render Unallocated KPI card");
  assert.match(content, /label="Allocated"/, "Must render Allocated KPI card");
  assert.match(content, /label="Completed"/, "Must render Completed KPI card");

  // Verify '?' help button and modal definition
  assert.match(content, /style=\{styles\.helpButton\}/, "Each card must have a top-right '?' help button");
  assert.match(content, /KPI_HELP_DETAILS/, "Must define detailed help metadata for all 4 KPIs");
  assert.match(content, /setActiveHelpKpi/, "Clicking '?' must activate help modal");

  // Verify bottom-right meter pill
  assert.match(content, /style=\{styles\.metersPill\}/, "Each card must display bottom-right meters pill");
  assert.match(content, /metersCount=\{summary\.totalMeters\}/, "Total Batches card must pass totalMeters");
  assert.match(content, /metersCount=\{summary\.unallocatedMeters\}/, "Unallocated card must pass unallocatedMeters");
  assert.match(content, /metersCount=\{summary\.allocatedMeters\}/, "Allocated card must pass allocatedMeters");
  assert.match(content, /metersCount=\{summary\.completedMeters\}/, "Completed card must pass completedMeters");
});

test("getBatchAllocationStatus strictly returns 'Allocated' or 'Unallocated'", () => {
  const registerPath = path.join(repoRoot, "src/pages/operations/TrnBgoRegisterPage.jsx");
  const content = fs.readFileSync(registerPath, "utf8");

  // Verify function definition and logic
  assert.match(
    content,
    /function getBatchAllocationStatus\(batch\)/,
    "TrnBgoRegisterPage must define getBatchAllocationStatus",
  );
  assert.match(
    content,
    /label:\s*"Allocated"/,
    "Must return label 'Allocated' for allocated batches",
  );
  assert.match(
    content,
    /label:\s*"Unallocated"/,
    "Must return label 'Unallocated' for unallocated batches",
  );
  // Verify only Allocated and Unallocated labels exist in the function
  const fnMatch = content.match(/function getBatchAllocationStatus[\s\S]*?return\s*\{[\s\S]*?label:\s*"Unallocated"[\s\S]*?\};[\s\S]*?\}/);
  assert.ok(fnMatch, "Must return only Allocated or Unallocated");
});

test("Batch deletion is guarded: can only delete if inProgress === 0 and completed === 0", () => {
  const registerPath = path.join(repoRoot, "src/pages/operations/TrnBgoRegisterPage.jsx");
  const content = fs.readFileSync(registerPath, "utf8");

  assert.match(
    content,
    /canDelete\s*=\s*inProgress\s*===\s*0\s*&&\s*completed\s*===\s*0/,
    "Batch can only be deleted if zero meters are in progress or completed",
  );
  assert.match(
    content,
    /disabled=\{!canDelete\}/,
    "Delete button must be disabled when execution has started",
  );
  assert.match(
    content,
    /Cannot delete batch: field execution has commenced/,
    "handleConfirmDelete must block deletion if inProgress > 0 or completed > 0",
  );
});
