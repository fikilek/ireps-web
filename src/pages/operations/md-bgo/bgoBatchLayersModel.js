import difference from "@turf/difference";
import { normalizeBatchGeometry, strictlyInside } from "../../../../functions/geofences/sales-batch-geometry.js";
const feature = geometry => ({ type: "Feature", properties: {}, geometry });
const subtract = (a, b) => difference({ type: "FeatureCollection", features: [feature(a), feature(b)] });
export function bgoFenceGeometry(fence) {
  try { const geometry = fence.geometry || { points: fence.points }; return normalizeBatchGeometry(geometry.points ? { points: [...geometry.points].sort((a, b) => Number(a.order || 0) - Number(b.order || 0)) } : geometry); } catch { return null; }
}
export function batchMapLayers({ erfs = [], premises = [], meters = [], geofences = [] }) {
  const boundaries = geofences.map(bgoFenceGeometry).filter(Boolean);
  const inside = point => point && boundaries.some(boundary => { try { return strictlyInside(point, boundary); } catch { return false; } });
  const clippedErfs = erfs.flatMap(erf => {
    if (!erf.geometry) return inside(erf.centroid) ? [erf] : [];
    const pieces = [];
    for (const boundary of boundaries) {
      try {
        const outside = subtract(erf.geometry, boundary);
        const clipped = outside ? subtract(erf.geometry, outside.geometry)?.geometry : erf.geometry;
        if (clipped?.type === "Polygon") pieces.push(clipped.coordinates);
        else if (clipped?.type === "MultiPolygon") pieces.push(...clipped.coordinates);
      } catch { /* An invalid geometry is not mapped outside the selected scope. */ }
    }
    return pieces.length ? [{ ...erf, centroid: inside(erf.centroid) ? erf.centroid : null,
      geometry: pieces.length === 1 ? { type: "Polygon", coordinates: pieces[0] } : { type: "MultiPolygon", coordinates: pieces } }] : [];
  });
  return { boundaries, erfs: clippedErfs, premises: premises.filter(item => inside(item.point)), meters: meters.filter(item => inside(item.point)) };
}
