import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { geofenceProgress, geofenceFinalCounts, GEOFENCE_PROGRESS_TIMEOUT_MS } from "./geofence-progress.js";

// Targeted Batch rules TB-R040 (1.3.22) and Geofences rules GF-R002.
const read = path => readFile(new URL(path, import.meta.url), "utf8");
const linkedFence = { id: "F1", counts: { erfs: 45, premises: 1, meters: 2, salesMeters: 29 }, metadata: { updatedByUid: "SYSTEM", updatedByUser: "onGeoFenceCreated" } };

test("the three steps tick in order and the window says done only when Create Batch is really available", () => {
  const states = geofenceProgress => geofenceProgress.steps.map(step => `${step.key}:${step.done ? "done" : step.active ? "working" : "waiting"}`).join(" ");
  assert.equal(states(geofenceProgress({ phase: "saving" })), "save:working link:waiting ready:waiting");
  const saved = geofenceProgress({ phase: "saved", fenceId: "F1", fence: { id: "F1", metadata: { updatedByUser: "Zamo Ngubs" } }, createReady: true });
  assert.equal(states(saved), "save:done link:working ready:waiting"); assert.equal(saved.done, false, "not done before the membership processing finishes");
  const locating = geofenceProgress({ phase: "saved", fenceId: "F1", fence: linkedFence, locating: true, createReady: true });
  assert.equal(states(locating), "save:done link:done ready:working"); assert.equal(locating.done, false);
  const notReady = geofenceProgress({ phase: "saved", fenceId: "F1", fence: linkedFence, createReady: false });
  assert.equal(notReady.done, false, "Create Batch still unavailable");
  const done = geofenceProgress({ phase: "saved", fenceId: "F1", fence: linkedFence, createReady: true });
  assert.deepEqual([done.done, done.stillLinking, states(done)], [true, false, "save:done link:done ready:done"]);
  assert.equal(geofenceProgress({ phase: "saved", fenceId: "F1", fence: { ...linkedFence, id: "OTHER" }, createReady: true }).done, false, "another geofence's processing does not count");
  const timedOut = geofenceProgress({ phase: "saved", fenceId: "F1", fence: { id: "F1" }, createReady: false, timedOut: true });
  assert.deepEqual([timedOut.done, timedOut.stillLinking], [true, true], "after 90 seconds it says created, still linking");
  assert.equal(GEOFENCE_PROGRESS_TIMEOUT_MS, 90000);
  assert.deepEqual(geofenceFinalCounts(linkedFence), { erfs: 45, salesMeters: 29, premises: 1, assets: 2 });
  assert.deepEqual(geofenceFinalCounts(null), { erfs: 0, salesMeters: 0, premises: 0, assets: 0 });
});

test("Save opens the progress window at once; Geofence created has the next step and only OK", async () => {
  const workspace = await read("./sales-batch-geofence-workspace.jsx");
  assert.match(workspace, /setConfirmCreateModalOpen\(false\);\s*setProgress\(\{ phase: "saving", name: standardDraftName, wardLabel, fenceId: null, timedOut: false \}\);\s*try \{\s*const result = await onSave\(/);
  assert.match(workspace, /setProgress\(current => current && \{ \.\.\.current, phase: "saved", fenceId: result\?\.geofenceId \|\| null \}\);/);
  assert.match(workspace, /catch \(failure\) \{ setProgress\(null\); setError\(/, "a failed save closes the window and shows why");
  assert.match(workspace, /setTimeout\(\(\) => setProgress\(current => current && \{ \.\.\.current, timedOut: true \}\), GEOFENCE_PROGRESS_TIMEOUT_MS\)/);
  assert.doesNotMatch(workspace, /setCreateSuccess\(\{/, "TB Draft no longer opens the old Geofence Created window");
  const modal = await read("./geofence-progress-modal.jsx");
  assert.match(modal, /<strong>Next:<\/strong> press <strong>Create Batch<\/strong> \(next to Satellite\) to create the batch now, or create it later from <strong>Batches &amp; Geofences<\/strong>\./);
  assert.equal((modal.match(/<button/g) || []).length, 1, "only OK; it never creates the batch");
  assert.match(modal, /onClick=\{onClose\}>OK<\/button>/);
});

test("a taken geofence name is shown as you type and stops drawing and saving, on both pages", async () => {
  const shared = await read("../../geofence-shared-ui.jsx");
  assert.match(shared, /const nameDuplicate = wardNumber \? findDuplicateGeofence\(composeGeofenceName\(wardNumber, geofenceNamePart\(draftName\)\), existingGeofences\) : null;/);
  assert.match(shared, /\{nameDuplicate \? <p role="alert" style=\{duplicateNameStyle\}>\{duplicateGeofenceNameMessage\(nameDuplicate\)\}<\/p> : null\}/);
  assert.match(shared, /<button onClick=\{handleStartDrawing\} disabled=\{Boolean\(nameDuplicate\)\}/);
  const workspace = await read("./sales-batch-geofence-workspace.jsx");
  assert.match(workspace, /existingGeofences=\{geofences\}/);
  assert.equal((workspace.match(/findDuplicateGeofence\(standardDraftName, geofences\)/g) || []).length, 2, "before drawing and before saving");
  const page = await read("../../GeoFencesPage.jsx");
  assert.match(page, /existingGeofences=\{geofences\}/);
  assert.equal((page.match(/findDuplicateGeofence\(standardDraftName, geofences\)/g) || []).length, 2);
});
