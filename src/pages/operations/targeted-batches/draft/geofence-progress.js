// Targeted Batch rules TB-R040 (1.3.22): from Save until Create Batch is really available, TB Draft
// shows three steps. The geofence's own membership processing ends by writing its final counts
// with metadata.updatedByUser "onGeoFenceCreated"; that is the "linked" signal.
export const GEOFENCE_PROGRESS_TIMEOUT_MS = 90_000;
export const GEOFENCE_PROGRESS_STEPS = Object.freeze([
  { key: "save", label: "Saving the geofence" },
  { key: "link", label: "Linking the ERFs, premises and meters inside it" },
  { key: "ready", label: "Getting this draft's meters ready for the batch" },
]);

export function geofenceProgress({ phase, fenceId, fence, locating = false, createReady = false, timedOut = false } = {}) {
  const saved = phase === "saved" && Boolean(fenceId);
  const linked = saved && fence?.id === fenceId && fence?.metadata?.updatedByUid === "SYSTEM" && fence?.metadata?.updatedByUser === "onGeoFenceCreated";
  const ready = linked && !locating && createReady;
  const doneByStep = { save: saved, link: linked, ready };
  const current = GEOFENCE_PROGRESS_STEPS.find(step => !doneByStep[step.key])?.key || null;
  return {
    steps: GEOFENCE_PROGRESS_STEPS.map(step => ({ ...step, done: doneByStep[step.key], active: step.key === current })),
    done: ready || (saved && timedOut),
    stillLinking: saved && timedOut && !ready,
  };
}

// The final counts the membership processing wrote (assets are counts.meters).
export function geofenceFinalCounts(fence) {
  const counts = fence?.counts || {};
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  return { erfs: number(counts.erfs), salesMeters: number(counts.salesMeters), premises: number(counts.premises), assets: number(counts.meters) };
}
