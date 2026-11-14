import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

test("TRN-BGO-R016 Action 1: TrnBgoRowsPage passes rows to IrepsTable and displays meter specification columns", () => {
  const rowsPagePath = path.join(
    repoRoot,
    "src/pages/operations/TrnBgoRowsPage.jsx",
  );
  const content = fs.readFileSync(rowsPagePath, "utf8");

  assert.ok(
    content.includes("rows={displayRows}"),
    "TrnBgoRowsPage must pass rows={displayRows} to IrepsTable (not data={displayRows})",
  );
  assert.ok(
    content.includes('key: "meterType"') && content.includes('key: "meterPhase"'),
    "TrnBgoRowsPage must define meterType and meterPhase columns in IrepsTable",
  );
  assert.ok(
    content.includes("downloads={{") && content.includes("registryName:"),
    "TrnBgoRowsPage must configure downloads prop on IrepsTable for QD / FD exports",
  );
});

test("TRN-BGO-R016 Action 2: TrnBgoAllocationPage provides dedicated batch allocation and unallocation controls", () => {
  const allocPagePath = path.join(
    repoRoot,
    "src/pages/operations/TrnBgoAllocationPage.jsx",
  );
  assert.ok(fs.existsSync(allocPagePath), "TrnBgoAllocationPage.jsx must exist");
  const content = fs.readFileSync(allocPagePath, "utf8");

  assert.ok(
    content.includes("export default function TrnBgoAllocationPage"),
    "TrnBgoAllocationPage must default export TrnBgoAllocationPage component",
  );
  assert.ok(
    content.includes("Operational Team") && content.includes("Service Provider (SP)"),
    "TrnBgoAllocationPage must provide radio toggle between Operational Team and Service Provider",
  );
  assert.ok(
    content.includes("handleAllocate") && content.includes("useAllocateTrnBgoWardBatchesMutation"),
    "TrnBgoAllocationPage must define handleAllocate invoking useAllocateTrnBgoWardBatchesMutation",
  );
  assert.ok(
    content.includes("handleUnallocate") && content.includes('targetType: "UNALLOCATE"'),
    "TrnBgoAllocationPage must support unallocating batches via targetType UNALLOCATE",
  );
  assert.ok(
    content.includes("<IrepsTable"),
    "TrnBgoAllocationPage must render IrepsTable listing constituent meters of the selected batch",
  );
});

test("TRN-BGO-R016 Action 3: TrnBgoBatchMapPage renders Google Map with meter markers and InfoWindow", () => {
  const mapPagePath = path.join(
    repoRoot,
    "src/pages/operations/TrnBgoBatchMapPage.jsx",
  );
  assert.ok(fs.existsSync(mapPagePath), "TrnBgoBatchMapPage.jsx must exist");
  const content = fs.readFileSync(mapPagePath, "utf8");

  assert.ok(
    content.includes("export default function TrnBgoBatchMapPage"),
    "TrnBgoBatchMapPage must default export TrnBgoBatchMapPage component",
  );
  assert.ok(
    content.includes("@vis.gl/react-google-maps"),
    "TrnBgoBatchMapPage must use @vis.gl/react-google-maps",
  );
  assert.ok(
    content.includes("extractRowLatLng"),
    "TrnBgoBatchMapPage must define extractRowLatLng to extract meter GPS coordinates",
  );
  assert.ok(
    content.includes("InfoWindow") && content.includes("infoWindow.setContent"),
    "TrnBgoBatchMapPage must render interactive InfoWindow on marker click",
  );
  assert.ok(
    content.includes("isSidebarOpen") && content.includes("filteredMeters"),
    "TrnBgoBatchMapPage must provide collapsible sidebar / drawer listing batch meters",
  );
});

test("TRN-BGO-R016 Register Column Actions: Map, Allocation, and BGO Rows links", () => {
  const regPagePath = path.join(
    repoRoot,
    "src/pages/operations/TrnBgoRegisterPage.jsx",
  );
  const content = fs.readFileSync(regPagePath, "utf8");

  assert.ok(
    content.includes('to={`/operations/trn-bgo/map?batchId=${encodeURIComponent(batch.id)}`}'),
    "Map column in TrnBgoRegisterPage must link to /operations/trn-bgo/map?batchId=...",
  );
  assert.ok(
    content.includes('to={`/operations/trn-bgo/allocation?batchId=${encodeURIComponent(batch.id)}`}'),
    "Allocation column in TrnBgoRegisterPage must link to /operations/trn-bgo/allocation?batchId=...",
  );
  assert.ok(
    content.includes('to={`/operations/trn-bgo-rows?batchId=${encodeURIComponent(batch.id)}`}'),
    "BGO Rows column in TrnBgoRegisterPage must link to /operations/trn-bgo-rows?batchId=...",
  );
});

test("TRN-BGO-R016 Routes: AppRoutes maps /operations/trn-bgo/allocation and /operations/trn-bgo/map", () => {
  const routesPath = path.join(repoRoot, "src/routes/AppRoutes.jsx");
  const content = fs.readFileSync(routesPath, "utf8");

  assert.ok(
    content.includes('path="/operations/trn-bgo/allocation"') &&
      content.includes("<TrnBgoAllocationPage />"),
    "AppRoutes must route /operations/trn-bgo/allocation to TrnBgoAllocationPage",
  );
  assert.ok(
    content.includes('path="/operations/trn-bgo/map"') &&
      content.includes("<TrnBgoBatchMapPage />"),
    "AppRoutes must route /operations/trn-bgo/map to TrnBgoBatchMapPage",
  );
});

test("TC allocation routes to the shared MD policy adapter", () => {
 const adapter=fs.readFileSync(path.join(repoRoot,"functions/tcUploads/allocation.js"),"utf8");
 const entry=fs.readFileSync(path.join(repoRoot,"functions/tcUploads/callables.js"),"utf8");
 assert.ok(entry.includes("allocateTcBatches"));
 assert.ok(adapter.includes("readMdAllocationTarget"));
 assert.ok(adapter.includes('data.targetType==="UNALLOCATE"'));
});
