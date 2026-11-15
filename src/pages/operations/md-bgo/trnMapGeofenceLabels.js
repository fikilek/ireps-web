export function trnMapGeofenceLabels(geofences = []) {
  const names = [...new Set(geofences.map(fence => typeof fence?.name === "string" ? fence.name.trim() : "").filter(name => name && name !== "NAv"))];
  return names.sort((a, b) => a.localeCompare(b)).map(name => ({ id: name, label: name }));
}
