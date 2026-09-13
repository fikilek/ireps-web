import { normalizeBatchGeometry, pointCoordinates } from "../../../functions/geofences/sales-batch-geometry.js";

// Context for the camera only. It never supplies a meter position or batch membership.
function boundaryViewport(boundary, scope) {
  if (!boundary) return null;
  let bounds = null;
  try {
    const geometry = normalizeBatchGeometry(boundary.geometry);
    const points = geometry.type === "Polygon" ? geometry.coordinates.flat() : geometry.coordinates.flat(2);
    bounds = { south: Math.min(...points.map(p => p[1])), north: Math.max(...points.map(p => p[1])),
      west: Math.min(...points.map(p => p[0])), east: Math.max(...points.map(p => p[0])) };
  } catch { /* Bbox or centroid can still establish the camera context. */ }
  if (!bounds && boundary.bbox) {
    const { minLat, maxLat, minLng, maxLng } = boundary.bbox;
    if ([minLat,maxLat,minLng,maxLng].every(Number.isFinite) && minLat >= -90 && maxLat <= 90 && minLng >= -180 && maxLng <= 180 && minLat < maxLat && minLng < maxLng)
      bounds = { south: minLat, north: maxLat, west: minLng, east: maxLng };
  }
  if (bounds) return { scope, bounds, center: { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 }, zoom: scope === "WARD" ? 13 : 10 };
  try { const [lng,lat] = pointCoordinates(boundary.centroid); return { scope, center: { lat,lng }, bounds: null, zoom: scope === "WARD" ? 13 : 10 }; }
  catch { return null; }
}
export function salesBatchMapViewport({ ward = null, lm = null } = {}) {
  return boundaryViewport(ward, "WARD") || boundaryViewport(lm, "LM");
}
