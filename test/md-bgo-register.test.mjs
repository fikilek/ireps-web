import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

test("MD BGO Register navigation is configured in ConsoleLayout", () => {
  const consoleLayoutPath = path.join(repoRoot, "src/layouts/ConsoleLayout.jsx");
  const content = fs.readFileSync(consoleLayoutPath, "utf8");

  assert.match(
    content,
    /label:\s*"MD BGO Register"/,
    "ConsoleLayout must label the menu item as 'MD BGO Register'",
  );
  assert.match(
    content,
    /path:\s*"\/operations\/bgo"/,
    "ConsoleLayout must route MD BGO Register to /operations/bgo",
  );
});

test("MD BGO routes are registered in AppRoutes", () => {
  const appRoutesPath = path.join(repoRoot, "src/routes/AppRoutes.jsx");
  const content = fs.readFileSync(appRoutesPath, "utf8");

  assert.match(
    content,
    /import MdBgoRegisterPage from "\.\.\/pages\/operations\/MdBgoRegisterPage"/,
    "AppRoutes must import MdBgoRegisterPage",
  );
  assert.match(
    content,
    /import MdBgoPlanningPage from "\.\.\/pages\/operations\/MdBgoPlanningPage"/,
    "AppRoutes must import MdBgoPlanningPage",
  );
  assert.match(
    content,
    /import MdBgoAllocationPage from "\.\.\/pages\/operations\/MdBgoAllocationPage"/,
    "AppRoutes must import MdBgoAllocationPage",
  );

  assert.match(
    content,
    /path="\/operations\/bgo"[\s\S]*?<MdBgoRegisterPage \/>/,
    "/operations/bgo must render MdBgoRegisterPage",
  );
  assert.match(
    content,
    /path="\/operations\/bgo\/plan"[\s\S]*?<MdBgoPlanningPage \/>/,
    "/operations/bgo/plan must render MdBgoPlanningPage",
  );
  assert.match(
    content,
    /path="\/operations\/bgo\/allocation"[\s\S]*?<MdBgoAllocationPage \/>/,
    "/operations/bgo/allocation must render MdBgoAllocationPage",
  );
});

test("MD BGO Register table layout conforms to specification", () => {
  const registerPath = path.join(repoRoot, "src/pages/operations/MdBgoRegisterPage.jsx");
  const content = fs.readFileSync(registerPath, "utf8");

  // Verify Batch Type column is NOT present
  assert.doesNotMatch(
    content,
    /<SortableTh[^>]*label="Batch Type"/,
    "Batch Type column must be omitted from MD BGO Register",
  );
  assert.doesNotMatch(
    content,
    /<Th>Batch Type<\/Th>/,
    "Batch Type column header must not exist",
  );

  // Verify mandatory columns
  assert.match(content, /label="Batch ID"/, "Must have Batch ID column");
  assert.match(content, /<Th>BGO Rows<\/Th>/, "Must have BGO Rows column");
  assert.match(content, /label="Allocation"/, "Must have Allocation column");
  assert.match(content, /label="Allocated To"/, "Must have Allocated To column");
  assert.match(content, /label="Total"/, "Must have Total ERFs column");
  assert.match(content, /label="Ward"/, "Must have Ward column");
  assert.match(content, /label="Geofence"/, "Must have Geofence column");
  assert.match(content, /label="Created By"/, "Must have Created By column");
  assert.match(content, /<Th>Delete BGO<\/Th>/, "Must have Delete BGO column");

  // Verify top buttons
  assert.match(
    content,
    /Plan & Create MD BGO/,
    "Must have primary 'Plan & Create MD BGO' action button",
  );
  assert.match(
    content,
    /Allocation Board/,
    "Must have 'Allocation Board' action button",
  );
  assert.match(
    content,
    /Open BGO Dashboard/,
    "Must have 'Open BGO Dashboard' action button",
  );
});

test("MD BGO Planning Map adheres to 30 ERF limit invariant", () => {
  const planningPath = path.join(repoRoot, "src/pages/operations/MdBgoPlanningPage.jsx");
  const content = fs.readFileSync(planningPath, "utf8");

  assert.match(
    content,
    /const BGO_ERF_LIMIT = 30;/,
    "Planning map must define BGO_ERF_LIMIT = 30",
  );
  assert.match(
    content,
    /Inside:\s*\${count}\s*ERFs\.\s*Too many:\s*\${count}\s*— the limit is/,
    "Planning map must display 'Too many: N — the limit is 30' when over capacity",
  );
  assert.match(
    content,
    /Gf W\${wardNumber}/,
    "Geofence naming prefix must adhere to GF-R001 pattern",
  );
});

test("MD BGO Register and Planning resolve active workbase from auth and geo context", () => {
  const registerPath = path.join(repoRoot, "src/pages/operations/MdBgoRegisterPage.jsx");
  const registerContent = fs.readFileSync(registerPath, "utf8");
  const planningPath = path.join(repoRoot, "src/pages/operations/MdBgoPlanningPage.jsx");
  const planningContent = fs.readFileSync(planningPath, "utf8");

  // Verify resolveWorkbase exists and checks auth.activeWorkbase, profile.access.activeWorkbase, workbases, and geoState
  for (const [name, content] of [["Register", registerContent], ["Planning", planningContent]]) {
    assert.match(
      content,
      /function resolveWorkbase/,
      `${name} must define resolveWorkbase helper`,
    );
    assert.match(
      content,
      /auth\?\.activeWorkbase/,
      `${name} must check auth.activeWorkbase`,
    );
    assert.match(
      content,
      /auth\?\.profile\?\.access\?\.activeWorkbase/,
      `${name} must check auth.profile.access.activeWorkbase`,
    );
    assert.match(
      content,
      /geoState\?\.selectedLm/,
      `${name} must check geoState.selectedLm`,
    );
    assert.doesNotMatch(
      content,
      /const\s*\{\s*activeWorkbase\s*,\s*selectedLm\s*\}\s*=\s*useWarehouse\(\)/,
      `${name} must NOT destructure activeWorkbase from useWarehouse()`,
    );
  }
});
