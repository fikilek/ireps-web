import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildMdBgoAllocationModel, MD_BGO_ALLOCATION_MAX, MD_BGO_ALLOCATION_STATES, mdBgoAllocationFailure, mdBgoAllocationSelection, toggleMdBgoSelection } from "./allocationModel.js";

const batch = (id, state = "READY_FOR_ALLOCATION", erfCount = 4, targetName = "") => ({ id, batchMode: "BMD", operationType: "METER_DISCOVERY", workflowState: state, targetName, geofenceId: `GF_${id}`, scope: { wardPcode: "ZA5241006" }, summary: { erfCount }, raw: { batchMode: "BMD", workflow: { state }, bgo: targetName ? { targetName } : {} } });
const fence = (id, name) => ({ id: `GF_${id}`, name, parents: { wardPcode: "ZA5241006" }, geometry: { points: [{ lat: -28.16, lng: 30.23 }, { lat: -28.16, lng: 30.24 }, { lat: -28.17, lng: 30.24 }] } });

test("MD BGO allocation model maps only BMD batches and labels ready/issued geofences", () => {
  const model = buildMdBgoAllocationModel({ batches: [batch("A"), batch("B", "ISSUED", 7, "Kaiser TEAM"), { id: "TRN1", batchMode: "TRN", workflowState: "READY_FOR_ALLOCATION" }], geofences: [fence("A", "Gf W6 One"), fence("B", "Gf W6 Two")] });
  assert.deepEqual(model.items.map(item => [item.bgoBatchId, item.name, item.erfCount, item.state, item.targetName]), [["A", "Gf W6 One", 4, MD_BGO_ALLOCATION_STATES.READY, ""], ["B", "Gf W6 Two", 7, MD_BGO_ALLOCATION_STATES.ISSUED, "Kaiser TEAM"]]);
  assert.equal(model.counts.ready, 1); assert.equal(model.counts.issued, 1);
});

test("normalized NAv target id does not make an unassigned batch unavailable", () => {
  const unassigned = { ...batch("NAV_BATCH"), targetId: "NAv" };
  const model = buildMdBgoAllocationModel({ batches: [unassigned], geofences: [fence("NAV_BATCH", "Gf W6 Unassigned")] });
  assert.equal(model.items[0].state, MD_BGO_ALLOCATION_STATES.READY);
  assert.deepEqual(toggleMdBgoSelection([], model.items[0]).ids, ["NAV_BATCH"]);
});

test("selection is capped at 15, totals ERFs and drops batches that cease to be ready", () => {
  const item = { bgoBatchId: "A", state: MD_BGO_ALLOCATION_STATES.READY, erfCount: 4, wardLabel: "Ward 6" };
  assert.deepEqual(toggleMdBgoSelection([], item), { ids: ["A"], message: "" });
  const full = Array.from({ length: MD_BGO_ALLOCATION_MAX }, (_, index) => `B${index}`);
  assert.match(toggleMdBgoSelection(full, { ...item, bgoBatchId: "OVER" }).message, /At most 15/);
  assert.deepEqual(mdBgoAllocationSelection([item], ["A", "ISSUED"]), { items: [item], dropped: ["ISSUED"], batches: 1, erfs: 4, wards: ["Ward 6"] });
});

test("register selection key is municipality-scoped and result distinguishes uncertain delivery", async () => {
  const selectionSource = await readFile(new URL("./allocationSelection.js", import.meta.url), "utf8");
  assert.match(selectionSource, /ireps\.mdBgoAllocation\.\$\{String\(lmPcode \|\| ""\)\.trim\(\)\}/);
  const uncertain = mdBgoAllocationFailure({ uncertain: true }, { items: [] }, { name: "Team A" });
  assert.equal(uncertain.kind, "uncertain"); assert.match(uncertain.lines.join(" "), /may or may not be issued/);
  const failed = mdBgoAllocationFailure({ data: { bgoBatchId: "A", message: "not ready" } }, { items: [{ bgoBatchId: "A", name: "Fence A" }] });
  assert.equal(failed.lines[0], "Fence A (A): not ready");
});

test("page and callable preserve MD BGO state and storage boundaries", async () => {
  const read = path => readFile(new URL(path, import.meta.url), "utf8");
  const page = await read("../MdBgoAllocationPage.jsx");
  const server = await read("../../../../functions/bgo/allocationCallable.js");
  const index = await read("../../../../functions/index.js");
  assert.match(page, /useGetBgoBatchesByLmQuery/); assert.match(page, /useGetGeoFencesByLmQuery/); assert.match(page, /useAllocateMdBgoBatchesTogetherMutation/);
  assert.match(page, /if \(view\.kind === "done"\) \{ navigate\("\/operations\/bgo"\); return; \}/);
  assert.match(page, /view\.kind === "done"\).*label: "OK".*onClick: onClose/s);
  assert.match(server, /workflow\.state": "ISSUED"/); assert.match(server, /"assignment\.targets"/); assert.match(server, /runTransaction/);
  assert.doesNotMatch(server, /tb_rows|tb_uploads|ALLOCATED/);
  assert.match(index, /onAllocateMdBgoBatchesTogetherCallable,/);
});
