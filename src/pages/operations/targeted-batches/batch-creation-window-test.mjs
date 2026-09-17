import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { batchArrival, checkingText, checkFailedLines, creatingText, creationSteps, CREATION_STEPS } from "./draft/batch-creation-window.js";

// Targeted Batch rules TB-R040 (1.3.36): checking, creating and the result are never silent.
const read = path => readFile(new URL(path, import.meta.url), "utf8");
const TB = "TGB_20260917_081500_AB12";
const creation = { success: true, createdBatchCount: 1, createdRowCount: 19, wardLabel: "Ward 6", batches: [{ tbId: TB, rowCount: 19 }] };
const upload = { id: TB, scope: { wardName: "Ward 6" }, counts: { totalRows: 19 }, geofenceLabel: "Gf W6 Dundee North" };

test("the texts say what is being checked and created", () => {
  assert.equal(checkingText(19), "Checking 19 meters: still free to batch, inside the geofence and in one Ward.");
  assert.equal(checkingText(1), "Checking 1 meter: still free to batch, inside the geofence and in one Ward.");
  assert.match(creatingText(30), /exactly 30 meters/);
});

test("creating shows two steps: the batch first, then opening TB Register", () => {
  assert.deepEqual(CREATION_STEPS.map(step => step.label), ["Creating the batch and its rows", "Opening TB Register"]);
  assert.deepEqual(creationSteps("create").map(step => [step.done, step.active]), [[false, true], [false, false]]);
  assert.deepEqual(creationSteps("open").map(step => [step.done, step.active]), [[true, false], [false, true]]);
  assert.deepEqual(creationSteps("done").map(step => [step.done, step.active]), [[true, false], [true, false]]);
});

test("TB Register keeps opening until the new batch is loaded, then shows Batch created", () => {
  assert.equal(batchArrival({ creation, uploads: [], loading: true }).phase, "opening");
  assert.equal(batchArrival({ creation, uploads: [{ id: "OTHER" }], loading: false }).phase, "opening");
  const created = batchArrival({ creation, uploads: [upload], loading: false });
  assert.deepEqual(created, { phase: "created", tbId: TB, meters: 19, wardLabel: "Ward 6", geofenceLabel: "Gf W6 Dundee North", notYetListed: false, registerError: "", allocationPath: `/operations/targeted-batches/${TB}/allocation` });
});

test("after the time limit it says created but not yet listed, instead of spinning", () => {
  const late = batchArrival({ creation, uploads: [], loading: false, timedOut: true });
  assert.equal(late.phase, "created");
  assert.equal(late.notYetListed, true);
  assert.equal(late.wardLabel, "Ward 6");
});

test("no hand-over, or a failed one, shows nothing", () => {
  assert.equal(batchArrival({ creation: undefined, uploads: [upload] }), null);
  assert.equal(batchArrival({ creation: { success: false }, uploads: [upload] }), null);
});

test("TB Draft opens Checking the batch before assessing and hides the confirmation while creating", async () => {
  const page = await read("../TargetedBatchDraftPage.jsx");
  const open = page.slice(page.indexOf("async function openConfirmation"), page.indexOf("async function commitConfirmed"));
  assert.ok(open.indexOf('kind: "checking"') > -1 && open.indexOf('kind: "checking"') < open.indexOf("await assess("), "checking window opens before the server check");
  assert.match(open, /kind: "check-failed"/);
  const commit = page.slice(page.indexOf("async function commitConfirmed"), page.indexOf("function closeFailedCreation"));
  assert.ok(commit.indexOf('kind: "creating"') < commit.indexOf("await create("), "creating window opens before the create call");
  assert.match(commit, /kind: error\.uncertain \? "uncertain" : "failed"/);
  assert.match(commit, /wardLabel, geofenceLabel, batches:/);
  assert.doesNotMatch(commit, /clearTargetedBatchDraft/, "TB Register clears the draft, so no empty TB Draft flashes between the windows");
  assert.match(page, /confirmation && !uncertain && !creationWindow && <TargetedBatchConfirmModal/);
  assert.match(page, /title="Batch not created"/);
  assert.match(page, /label: "Retry the same request"/);
});

test("TB Register shows Allocate this batch and Stay on TB Register, and clears the hand-over", async () => {
  const page = await read("../TargetedBatchesPage.jsx");
  assert.match(page, /title="Batch created"/);
  assert.match(page, /label: "Allocate this batch", primary: true, onClick: \(\) => finishArrival\(arrival\.allocationPath\)/);
  assert.match(page, /label: "Stay on TB Register", onClick: \(\) => finishArrival\(\)/);
  assert.match(page, /navigate\(`\$\{location\.pathname\}\$\{location\.search\}`, \{ replace: true, state: null \}\)/);
});

test("Batch created stays once shown, reports a register failure honestly and prefers the handed-over geofence name", () => {
  assert.equal(batchArrival({ creation, uploads: [], loading: true, settled: true }).phase, "created");
  const failed = batchArrival({ creation, uploads: [], loading: false, registerError: "permission-denied" });
  assert.deepEqual([failed.phase, failed.registerError], ["created", "permission-denied"]);
  assert.equal(batchArrival({ creation: { ...creation, geofenceLabel: "Gf W6 Named" }, uploads: [upload] }).geofenceLabel, "Gf W6 Named");
  assert.equal(batchArrival({ creation, uploads: [{ ...upload, geofenceId: "GF1", geofenceLabel: "GF1" }] }).geofenceLabel, null, "a raw geofence ID is never shown as its name");
});

test("a failed check always says what to do next", () => {
  assert.deepEqual(checkFailedLines({ message: "No retained meter is ready" }), ["No retained meter is ready", "Nothing was created. Fix what is listed in TB Draft, then press Create Batch again."]);
  assert.match(checkFailedLines({ unreachable: true }).join(" "), /could not reach the server.*Check your connection/);
});

test("TB Register clears the handed-over draft before paint and keeps a banner after Stay", async () => {
  const page = await read("../TargetedBatchesPage.jsx");
  assert.match(page, /useLayoutEffect\(\(\) => \{\s+if \(handedOverTbId && storedDraft\?\.id === handedOverTbId\) dispatch\(clearTargetedBatchDraft\(\)\);/);
  assert.match(page, /setRegisterStatusMessage\(`Batch \$\{created\.tbId\} created with/);
  assert.match(page, /if \(arrivalCreated && !arrivalSettled\) setArrivalSettled\(true\)/);
});
