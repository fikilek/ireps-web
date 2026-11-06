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

test("MD BGO Planning Map adheres to 60 ERF limit invariant", () => {
  const planningPath = path.join(repoRoot, "src/pages/operations/MdBgoPlanningPage.jsx");
  const content = fs.readFileSync(planningPath, "utf8");

  assert.match(
    content,
    /const BGO_ERF_LIMIT = 60;/,
    "Planning map must define BGO_ERF_LIMIT = 60",
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

  // Verify declaration order: state hooks must be declared before query conditions
  const showErfsIndex = content.indexOf("const [showErfsLayer, setShowErfsLayer] = useState(false);");
  const isDrawingIndex = content.indexOf("const [isDrawing, setIsDrawing] = useState(false);");
  const shouldLoadErfsIndex = content.indexOf("const shouldLoadErfs =");
  assert.ok(showErfsIndex !== -1 && shouldLoadErfsIndex !== -1 && showErfsIndex < shouldLoadErfsIndex, "showErfsLayer must be initialized before shouldLoadErfs");
  assert.ok(isDrawingIndex !== -1 && isDrawingIndex < shouldLoadErfsIndex, "isDrawing must be initialized before shouldLoadErfs");

  const savedLandingIndex = content.indexOf("const [savedGeofenceLanding, setSavedGeofenceLanding] = useState(null);");
  const displayGeofencesIndex = content.indexOf("const displayGeofences = useMemo");
  assert.ok(savedLandingIndex !== -1 && displayGeofencesIndex !== -1 && savedLandingIndex < displayGeofencesIndex, "savedGeofenceLanding must be initialized before displayGeofences");
  assert.ok(savedLandingIndex !== -1 && shouldLoadErfsIndex !== -1 && savedLandingIndex < shouldLoadErfsIndex, "savedGeofenceLanding must be initialized before queries");
});

test("MD BGO Planning Map adheres to GPS Sales Table geofence creation routine (MD-BGO-R010 v1.6.0)", () => {
  const planningPath = path.join(repoRoot, "src/pages/operations/MdBgoPlanningPage.jsx");
  const content = fs.readFileSync(planningPath, "utf8");

  // 1. Pre-drawing modal opens first
  assert.match(content, /setIsCreateModalOpen\(true\)/, "Must open create modal before drawing begins");
  assert.match(content, /isCreateModalOpen/, "Must manage isCreateModalOpen state");

  // 2. Fixed prefix per GF-R001 and duplicate check
  assert.match(content, /Gf W\{wardNumber\}/, "Geofence name must display fixed prefix Gf W{wardNumber}");
  assert.match(content, /findDuplicateGeofence/, "Must check duplicate geofence names in real-time");

  // 3. Ward locked to 1 ward only (cannot cross ward boundaries)
  assert.match(content, /disabled=\{isDrawing\}/, "Ward selector must be locked during drawing");
  assert.match(content, /Batches belong to 1 ward only/, "Must declare single ward batch invariant");

  // 4. Start drawing auto-activates ERF layer
  assert.match(content, /setShowErfsLayer\(true\)/, "Must activate ERF layer when drawing starts");

  // 5. Drawing toolbar displays Creating name and points
  assert.match(content, /Creating:\s*<strong>\{fullStandardName\}<\/strong>/, "Drawing bar must display creating name");

  // 6. Confirm modal opens on Save with decoupled options
  assert.match(content, /setIsConfirmModalOpen\(true\)/, "Must open confirm modal on Save");
  assert.match(content, /Save Geofence Only/, "Must provide Save Geofence Only action");
  assert.match(content, /Save & Create Batch/, "Must provide Save & Create Batch action");

  // 7. Canonical parents and points payload for createGeoFence
  assert.match(content, /countryPcode:\s*"ZA"/, "Must pass countryPcode in parents payload");
  assert.match(content, /latitude:\s*point\.lat/, "Must pass latitude in points payload");

  // 8. Option 1 clean landing panel
  assert.match(content, /savedGeofenceLanding/, "Must manage savedGeofenceLanding state");
  assert.match(content, /Create MD BGO Batch from this Geofence Now/, "Landing card must have action to create batch");
  assert.match(content, /Draw Another Geofence in Ward/, "Landing card must have action to draw another geofence");
  assert.match(content, /Return to MD BGO Register/, "Landing card must have action to return to register");
});

test("MD BGO Planning Map renders iREPS geofences via getGeoFencePath and manages dual-scope visibility (MD-BGO-R010)", () => {
  const planningPath = path.join(repoRoot, "src/pages/operations/MdBgoPlanningPage.jsx");
  const content = fs.readFileSync(planningPath, "utf8");

  // 1. Imports getGeoFencePath and geofenceLabelPoint from geofence-map-helpers
  assert.match(content, /import\s*\{[^}]*getGeoFencePath[^}]*\}\s*from\s*"\.\/geofence-map-helpers"/, "Must import getGeoFencePath");
  assert.match(content, /import\s*\{[^}]*geofenceLabelPoint[^}]*\}\s*from\s*"\.\/geofence-map-helpers"/, "Must import geofenceLabelPoint");

  // 2. Extracts path via getGeoFencePath supporting iREPS geometry.points
  assert.match(content, /getGeoFencePath\(gf\)/, "Must extract pointPath via getGeoFencePath");

  // 3. Dual-scope visibility: all geofences when layer active, only selected when layer inactive
  assert.match(content, /fencesToRender\s*=\s*showGeofencesLayer/, "fencesToRender must respect showGeofencesLayer toggle");
  assert.match(content, /gf\.id === selectedGeofenceId/, "Must filter selectedGeofenceId when layer is inactive");

  // 4. Geofence name label marker
  assert.match(content, /geofenceLabelPoint\(gf\)/, "Must compute label position via geofenceLabelPoint");
  assert.match(content, /className:\s*"ireps-geofence-label"/, "Must style geofence label");

  // 5. Unified selection handler
  assert.match(content, /handleSelectGeofence/, "Must provide unified handleSelectGeofence");
  assert.match(content, /onSelectGeofence=\{handleSelectGeofence\}/, "Map inner must receive handleSelectGeofence");
});

test("MD BGO Planning Map enforces 3-tier ERF -> Premise -> Meter asset chain metrics (MD-BGO-R010 v1.7.0)", () => {
  const planningPath = path.join(repoRoot, "src/pages/operations/MdBgoPlanningPage.jsx");
  const content = fs.readFileSync(planningPath, "utf8");

  // 1. Linking helper functions
  assert.match(content, /function getPremiseErfId/, "Must define getPremiseErfId helper");
  assert.match(content, /function getMeterPremiseId/, "Must define getMeterPremiseId helper");
  assert.match(content, /function getMeterErfId/, "Must define getMeterErfId helper");
  assert.match(content, /function evaluateGeofenceAssetChain/, "Must define evaluateGeofenceAssetChain evaluator");

  // 2. Query loading trigger on selection or drawing
  assert.match(content, /shouldLoadPremises\s*=\s*Boolean\([^)]*selectedGeofenceId/, "Premises must load when geofence is selected");
  assert.match(content, /shouldLoadMeters\s*=\s*Boolean\([^)]*selectedGeofenceId/, "Meters must load when geofence is selected");

  // 3. Live 3-tier evaluation during drawing
  assert.match(content, /premisesInside/, "Must compute premisesInside during drawing");
  assert.match(content, /metersInside/, "Must compute metersInside during drawing");
  assert.match(content, /Inside:\s*\$\{count\}\s*ERF.*Premises.*Meters/, "Drawing bar must report ERFs, Premises, and Meters");

  // 4. Landing panel 3-tier stat grid
  assert.match(content, /activeLandingCounts\.erfCount/, "Must display erfCount in landing card");
  assert.match(content, /activeLandingCounts\.premiseCount/, "Must display premiseCount in landing card");
  assert.match(content, /activeLandingCounts\.meterCount/, "Must display meterCount in landing card");
  assert.match(content, /statGrid/, "Must render 3-tier statGrid layout");
  assert.match(content, /Enclosed parcels/, "Must describe enclosed parcels");
  assert.match(content, /Linked to ERFs/, "Must describe premises linked to ERFs");
  assert.match(content, /On premises/, "Must describe meters on premises");
});

test("MD BGO Planning Map supports geofence editing, visible description input, and scoped ERF number labels (MD-BGO-R010 v1.8.0)", () => {
  const planningPath = path.join(repoRoot, "src/pages/operations/MdBgoPlanningPage.jsx");
  const content = fs.readFileSync(planningPath, "utf8");

  // 1. Scoped ERF number labels on selected geofence
  assert.match(content, /selectedErfLabelMarkersRef/, "Must track selected geofence ERF label markers");
  assert.match(content, /ireps-erf-label/, "Must apply ireps-erf-label class to ERF markers");
  assert.match(content, /strictlyInside/, "Must strictly filter ERF markers to enclosed polygon");

  // 2. Visible description textarea in creation modal
  assert.match(content, /modalTextarea/, "Must define and apply modalTextarea styling with visible border");

  // 3. Edit Geofence details support
  assert.match(content, /useUpdateGeoFenceMutation/, "Must import and use useUpdateGeoFenceMutation");
  assert.match(content, /handleOpenEditModal/, "Must provide handleOpenEditModal handler");
  assert.match(content, /handleSaveEdit/, "Must provide handleSaveEdit handler");
  assert.match(content, /isEditModalOpen/, "Must manage isEditModalOpen modal state");
  assert.match(content, /Edit Geofence Details/, "Must render Edit Geofence Details modal");
  assert.match(content, /landingEditButton/, "Must provide landing edit button");

  // 4. Backend update callable
  const callablePath = path.join(repoRoot, "functions/geofences/callables.js");
  const callableContent = fs.readFileSync(callablePath, "utf8");
  assert.match(callableContent, /export async function updateGeoFenceRequest/, "Must implement updateGeoFenceRequest");
  assert.match(callableContent, /export const updateGeoFence\s*=/, "Must export updateGeoFence callable");

  const indexPath = path.join(repoRoot, "functions/index.js");
  const indexContent = fs.readFileSync(indexPath, "utf8");
  assert.match(indexContent, /updateGeoFence,/, "Must export updateGeoFence in functions/index.js");
});
