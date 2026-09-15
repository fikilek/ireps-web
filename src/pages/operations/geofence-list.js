// Geofences rules GF-R003: the Existing Geofences list, newest first, each with when and by
// whom it was created; an empty description shows "No Description Given".
export const NO_DESCRIPTION_GIVEN = "No Description Given";

function createdMillis(fence) {
  const value = fence?.metadata?.createdAt ?? fence?.createdAt;
  if (!value) return null;
  const millis = typeof value === "string" ? Date.parse(value) : value.toMillis?.() ?? (Number.isFinite(value.seconds) ? value.seconds * 1000 : NaN);
  return Number.isFinite(millis) ? millis : null;
}

export function sortGeofencesNewestFirst(fences = []) {
  return [...fences].sort((left, right) => {
    const a = createdMillis(left), b = createdMillis(right);
    if (a === null || b === null) return a === b ? String(left?.name || "").localeCompare(String(right?.name || ""), undefined, { numeric: true }) : a === null ? 1 : -1;
    return b - a || String(left?.name || "").localeCompare(String(right?.name || ""), undefined, { numeric: true });
  });
}

export function geofenceDescriptionLabel(fence) {
  const description = String(fence?.description ?? "").trim();
  return !description || description === "NAv" ? NO_DESCRIPTION_GIVEN : description;
}

export function geofenceCreatedLabel(fence) {
  const millis = createdMillis(fence);
  const by = String(fence?.metadata?.createdByUser ?? fence?.createdByUser ?? "").trim();
  const when = millis === null ? "date unknown" : new Date(millis).toLocaleString("en-ZA", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `Created ${when}${by && by !== "NAv" ? ` · ${by}` : ""}`;
}
