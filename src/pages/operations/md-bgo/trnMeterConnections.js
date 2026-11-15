const valid = point => point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
export function trnMeterConnections(premises, meters, metersVisible = true) {
  if (!metersVisible) return [];
  const byId = new Map(premises.map(premise => [premise.id, premise]));
  return meters.flatMap(meter => {
    const premise = byId.get(meter.linkedPremiseId);
    return valid(premise?.point) && valid(meter.point) ? [{ meterId: meter.id, path: [premise.point, meter.point] }] : [];
  });
}
export function attachTrnMeterConnections(maps, map, connections) {
  const lines = connections.map(connection => new maps.Polyline({ map, path: connection.path, geodesic: true, clickable: false, strokeColor: "#7c3aed", strokeOpacity: 0.8, strokeWeight: 2, zIndex: 120 }));
  return () => lines.forEach(line => line.setMap(null));
}
