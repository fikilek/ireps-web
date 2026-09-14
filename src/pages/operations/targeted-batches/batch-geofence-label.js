// Targeted Batch rules TB-R043: batch lists (TB Register, Sales Reporting) show the name of
// each batch's geofence. The link is tb_uploads.geofenceId; the name is a display value read
// from the LM's active geofences, which the app already streams for its maps.
export const NO_GEOFENCE_LABEL = "No geofence";

export function geofenceNamesById(geofences = []) {
  return new Map(
    (Array.isArray(geofences) ? geofences : [])
      .filter((fence) => fence?.id)
      .map((fence) => [fence.id, fence.name && fence.name !== "NAv" ? fence.name : fence.id]),
  );
}

// A batch from before TB-R039 has no geofence. Until the geofence list arrives (or if the
// geofence is not in it) the ID is shown rather than a guessed name.
export function batchGeofenceLabel(geofenceId, namesById = new Map()) {
  const id = String(geofenceId ?? "").trim();
  if (!id) return NO_GEOFENCE_LABEL;
  return namesById.get(id) || id;
}
