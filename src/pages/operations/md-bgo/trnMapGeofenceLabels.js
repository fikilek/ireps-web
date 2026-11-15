export function trnMapGeofenceLabels(geofences = []) {
  const unique = [...new Map(geofences.filter(fence => fence?.id).map(fence => [fence.id, fence])).values()];
  const name = fence => String(fence.name || fence.id);
  const counts = new Map();
  unique.forEach(fence => counts.set(name(fence), (counts.get(name(fence)) || 0) + 1));
  return unique.sort((a, b) => name(a).localeCompare(name(b)) || a.id.localeCompare(b.id)).map(fence => ({ id: fence.id, label: counts.get(name(fence)) > 1 ? `${name(fence)} (${fence.id})` : name(fence) }));
}
