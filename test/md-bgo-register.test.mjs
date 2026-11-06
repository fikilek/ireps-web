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
    /import MdBgoDashboardPage from "\.\.\/pages\/operations\/MdBgoDashboardPage"/,
    "AppRoutes must import MdBgoDashboardPage",
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
    /path="\/operations\/bgo\/dashboard"[\s\S]*?<MdBgoDashboardPage \/>/,
    "/operations/bgo/dashboard must render MdBgoDashboardPage",
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
    /MD BGO Dashboard/,
    "Must have 'MD BGO Dashboard' action button",
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

    // Extract and test execution of resolveWorkbase function
    const fnMatch = content.match(/function resolveWorkbase\([^)]*\)\s*\{[\s\S]*?\n\}/);
    assert.ok(fnMatch, `${name} must contain resolveWorkbase implementation`);
    const resolveFn = new Function(`${fnMatch[0]}; return resolveWorkbase;`)();

    // Test 1: auth.activeWorkbase
    const res1 = resolveFn({ activeWorkbase: { pcode: "ZA5241", name: "eEndumeni" } }, {});
    assert.equal(res1.lmPcode, "ZA5241");
    assert.equal(res1.lmName, "eEndumeni");

    // Test 2: auth.profile.access.activeWorkbase
    const res2 = resolveFn({ profile: { access: { activeWorkbase: { id: "ZA5241", lmName: "eEndumeni" } } } }, {});
    assert.equal(res2.lmPcode, "ZA5241");
    assert.equal(res2.lmName, "eEndumeni");

    // Test 3: fallback to geoState.selectedLm
    const res3 = resolveFn({}, { selectedLm: { pcode: "ZA5241", name: "eEndumeni" } });
    assert.equal(res3.lmPcode, "ZA5241");
    assert.equal(res3.lmName, "eEndumeni");
  }
});

test("MD BGO Dashboard strictly isolates Meter Discovery from Transaction BGO (MD-BGO-R011)", () => {
  const dashboardPath = path.join(repoRoot, "src/pages/operations/MdBgoDashboardPage.jsx");
  const content = fs.readFileSync(dashboardPath, "utf8");

  // Must query bgo_batches
  assert.match(content, /useGetBgoBatchesByLmQuery/, "Must query bgo_batches via useGetBgoBatchesByLmQuery");

  // Must filter strictly to MD BGO batches
  assert.match(content, /function isMdBgoBatch/, "Must define isMdBgoBatch filter");
  assert.match(content, /batchMode === "BMD" \|\| opType === "METER_DISCOVERY"/, "Must filter to BMD / METER_DISCOVERY");

  // Must NOT query tc_uploads (disconnections, reconnections, etc.)
  assert.doesNotMatch(content, /useGetTcUploadsQuery/, "MD BGO Dashboard must not query or display tc_uploads");
  assert.doesNotMatch(content, /METER_DISCONNECTION/, "Must not contain hardcoded disconnection transaction references");
});

test("MD BGO Planning Map satisfies whole-municipality overview, ward zoom, and collapsible layers (MD-BGO-R010)", () => {
  const planningPath = path.join(repoRoot, "src/pages/operations/MdBgoPlanningPage.jsx");
  const content = fs.readFileSync(planningPath, "utf8");

  // Municipality and Ward Boundary streaming queries
  assert.match(content, /useGetLmBoundaryByIdQuery/, "Must query municipality boundary via useGetLmBoundaryByIdQuery");
  assert.match(content, /useGetWardBoundariesByLmQuery/, "Must query ward boundaries via useGetWardBoundariesByLmQuery");
  assert.match(content, /useGetPremisesByWardQuery/, "Must query ward premises via useGetPremisesByWardQuery");
  assert.match(content, /useGetAstsByLmPcodeWardPcodeQuery/, "Must query ward meters via useGetAstsByLmPcodeWardPcodeQuery");

  // Initial landing view without ward selected
  assert.match(content, /Whole Municipality/, "Must provide Whole Municipality option/view on initial landing");
  assert.match(content, /fitMapToBounds\(map, lmPaths\)/, "Must fit map to municipality bounds when no ward selected");

  // Collapsible Map Layers Panel matching Sales GPS pattern
  assert.match(content, /layersOpen/, "Must manage layersOpen state");
  assert.match(content, /layersOpenButton/, "Must render layers open toggle button");
  assert.match(content, /layersCloseButton/, "Must render layers close button");
  assert.match(content, /MAP LAYERS/, "Must display MAP LAYERS panel header");

  // Layer checkboxes: ERFs, Premises, Meters, Geofences, Ward boundaries
  assert.match(content, /showWardBoundariesLayer/, "Must toggle Ward boundaries layer");
  assert.match(content, /showErfsLayer/, "Must toggle ERFs layer");
  assert.match(content, /showPremisesLayer/, "Must toggle Premises layer");
  assert.match(content, /showMetersLayer/, "Must toggle Meters layer");
  assert.match(content, /showGeofencesLayer/, "Must toggle Geofences layer");

  // Gated activation when no ward is selected
  assert.match(content, /disabled=\{!selectedWardPcode\}/, "ERFs, premises, meters & geofences must be gated to selected ward");

  // Performance defaults (MD-BGO-R010 v1.3.0): ERFs, premises, and meters OFF by default
  assert.match(content, /const \[showErfsLayer, setShowErfsLayer\] = useState\(false\);/, "showErfsLayer must default to false");
  assert.match(content, /const \[showPremisesLayer, setShowPremisesLayer\] = useState\(false\);/, "showPremisesLayer must default to false");
  assert.match(content, /const \[showMetersLayer, setShowMetersLayer\] = useState\(false\);/, "showMetersLayer must default to false");
  assert.match(content, /const \[showWardBoundariesLayer, setShowWardBoundariesLayer\] = useState\(true\);/, "showWardBoundariesLayer must default to true");
  assert.match(content, /const \[showGeofencesLayer, setShowGeofencesLayer\] = useState\(true\);/, "showGeofencesLayer must default to true");

  // Query lazy-loading
  assert.match(content, /skip: !shouldLoadErfs/, "ERF query must be skipped when layer is inactive and not drawing");
  assert.match(content, /skip: !shouldLoadPremises/, "Premises query must be skipped when layer is inactive");
  assert.match(content, /skip: !shouldLoadMeters/, "Meters query must be skipped when layer is inactive");
});
