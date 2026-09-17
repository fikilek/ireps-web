// Targeted Batch rules TB-R040 (1.3.36): checking, creating and the result are never silent.
// TB Draft checks, then creates; TB Register finishes the "Opening TB Register" step once it has
// loaded the new batch, then shows Batch created.
export const CREATION_STEPS = Object.freeze([
  { key: "create", label: "Creating the batch and its rows" },
  { key: "open", label: "Opening TB Register" },
]);
// If TB Register has not listed the new batch after this long, say so instead of spinning forever.
export const CREATION_ARRIVAL_TIMEOUT_MS = 60_000;
export const CREATION_NOT_CONFIRMED = "We could not confirm whether the batch was created. Retry the same request; do not start a new batch.";

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function checkingText(meterCount) {
  return `Checking ${plural(Number(meterCount) || 0, "meter")}: still free to batch, inside the geofence and in one Ward.`;
}

export function creatingText(meterCount) {
  return `Creating one batch with exactly ${plural(Number(meterCount) || 0, "meter")}. Please wait.`;
}

// What to show when the check before the confirmation window fails, always with what to do next.
export function checkFailedLines({ message, unreachable = false } = {}) {
  if (unreachable) return ["The check could not reach the server.", "Nothing was created. Check your connection, then press Create Batch again."];
  return [message || "The draft is not ready to become a batch.", "Nothing was created. Fix what is listed in TB Draft, then press Create Batch again."];
}

export function creationSteps(current) {
  const order = CREATION_STEPS.map(step => step.key);
  const at = current === "done" ? order.length : Math.max(0, order.indexOf(current));
  return CREATION_STEPS.map((step, index) => ({ ...step, done: index < at, active: index === at }));
}

// What TB Register shows for a creation handed over from TB Draft: still opening, or created.
// settled: Batch created was already shown (it never turns back into a spinner).
export function batchArrival({ creation, uploads = [], loading = false, timedOut = false, settled = false, registerError = "" } = {}) {
  const tbId = creation?.success ? creation?.batches?.[0]?.tbId : null;
  if (!tbId) return null;
  const upload = uploads.find(item => item?.id === tbId) || null;
  if ((loading || !upload) && !timedOut && !settled && !registerError) return { phase: "opening", tbId, steps: creationSteps("open") };
  const listedLabel = upload?.geofenceLabel && upload.geofenceLabel !== upload.geofenceId ? upload.geofenceLabel : null;
  return {
    phase: "created",
    tbId,
    meters: Number(creation.createdRowCount ?? upload?.counts?.totalRows ?? 0),
    wardLabel: creation.wardLabel || upload?.scope?.wardName || (upload?.scope?.wardNumber ? `Ward ${upload.scope.wardNumber}` : null),
    geofenceLabel: creation.geofenceLabel || listedLabel,
    notYetListed: !upload,
    registerError: registerError || "",
    allocationPath: `/operations/targeted-batches/${encodeURIComponent(tbId)}/allocation`,
  };
}
