export function isZeroZeroPoint(point) {
  const lat = Number(point?.lat ?? point?.latitude);
  const lng = Number(point?.lng ?? point?.longitude);

  return Number.isFinite(lat) && Number.isFinite(lng) && lat === 0 && lng === 0;
}

export function isUsableMapPoint(point) {
  const lat = Number(point?.lat ?? point?.latitude);
  const lng = Number(point?.lng ?? point?.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

  // iREPS operational geography is never at 0,0. Treat this as missing/bad GPS
  // so a single bad point cannot pull the map away from the selected geofence.
  if (lat === 0 && lng === 0) return false;

  return true;
}

export function toUsableLatLng(point) {
  if (!isUsableMapPoint(point)) return null;

  return {
    lat: Number(point?.lat ?? point?.latitude),
    lng: Number(point?.lng ?? point?.longitude),
  };
}

export function normalizeBbox(bbox) {
  if (!bbox) return null;

  const minLat = Number(bbox.minLat ?? bbox.minLatitude);
  const maxLat = Number(bbox.maxLat ?? bbox.maxLatitude);
  const minLng = Number(bbox.minLng ?? bbox.minLongitude);
  const maxLng = Number(bbox.maxLng ?? bbox.maxLongitude);

  if (
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLat) ||
    !Number.isFinite(minLng) ||
    !Number.isFinite(maxLng)
  ) {
    return null;
  }

  if (minLat === 0 && maxLat === 0 && minLng === 0 && maxLng === 0) {
    return null;
  }

  if (minLat > maxLat || minLng > maxLng) {
    return null;
  }

  return {
    minLat,
    maxLat,
    minLng,
    maxLng,
  };
}

export function fitMapToBbox(map, bbox, padding = 56) {
  if (!map || !bbox || !window.google?.maps) return;

  const cleanBbox = normalizeBbox(bbox);
  if (!cleanBbox) return;

  const bounds = new window.google.maps.LatLngBounds();

  bounds.extend({
    lat: cleanBbox.minLat,
    lng: cleanBbox.minLng,
  });

  bounds.extend({
    lat: cleanBbox.maxLat,
    lng: cleanBbox.maxLng,
  });

  map.fitBounds(bounds, padding);
}

export function getGeoFencePath(geoFence) {
  const points = geoFence?.geometry?.points || geoFence?.points || [];

  if (!Array.isArray(points)) return [];

  return [...points]
    .sort((left, right) => Number(left?.order || 0) - Number(right?.order || 0))
    .map(toUsableLatLng)
    .filter(Boolean);
}

export function getGeoFencePointCount(geoFence) {
  return getGeoFencePath(geoFence).length;
}

// Ward boundaries are stored as GeoJSON, often as JSON text.
export function parseGeometry(geometry) {
  if (!geometry) return null;

  if (typeof geometry === "string") {
    try {
      return JSON.parse(geometry);
    } catch (error) {
      console.error("Could not parse geometry:", error);
      return null;
    }
  }

  return geometry;
}

export function geoJsonPolygonToGooglePaths(geoJsonGeometry) {
  if (!geoJsonGeometry) return [];

  if (geoJsonGeometry.type === "Polygon") {
    return geoJsonGeometry.coordinates.map((ring) =>
      ring.map(([lng, lat]) => ({ lat, lng })),
    );
  }

  if (geoJsonGeometry.type === "MultiPolygon") {
    return geoJsonGeometry.coordinates.flatMap((polygon) =>
      polygon.map((ring) => ring.map(([lng, lat]) => ({ lat, lng }))),
    );
  }

  return [];
}

// One Ward boundary look for the Geo-Fences page and the TB Draft Wards layer
// (Targeted Batch rules 18.7, 1.3.7): amber line with a faint fill.
export const WARD_BOUNDARY_STYLE = Object.freeze({
  strokeColor: "#f59e0b",
  strokeOpacity: 1,
  strokeWeight: 3,
  fillColor: "#f59e0b",
  fillOpacity: 0.08,
});
export const WARD_LABEL_COLOR = "#b45309";

// The average of some { lat, lng } points, or null when there are none.
export function pointsCentre(points = []) {
  const usable = points.map(toUsableLatLng).filter(Boolean);
  if (!usable.length) return null;
  return {
    lat: usable.reduce((sum, point) => sum + point.lat, 0) / usable.length,
    lng: usable.reduce((sum, point) => sum + point.lng, 0) / usable.length,
  };
}

// Even-odd test over every ring, so holes and multi-part Wards are handled.
export function pointInPaths(point, paths = []) {
  let inside = false;
  for (const ring of paths) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.lat > point.lat) !== (b.lat > point.lat)
        && point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
    }
  }
  return inside;
}

const METRES_PER_DEGREE = 111320;

// The point on any ring edge nearest `point`, with its distance in metres (a local
// flat approximation, accurate to a few metres across a municipality).
export function nearestPointOnPaths(point, paths = []) {
  const kx = Math.cos((point.lat * Math.PI) / 180) * METRES_PER_DEGREE, ky = METRES_PER_DEGREE;
  let best = null;
  for (const ring of paths) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const ax = (a.lng - point.lng) * kx, ay = (a.lat - point.lat) * ky;
      const dx = (b.lng - a.lng) * kx, dy = (b.lat - a.lat) * ky;
      const lengthSq = dx * dx + dy * dy;
      const t = lengthSq ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq)) : 0;
      const x = ax + t * dx, y = ay + t * dy, distance = Math.hypot(x, y);
      if (!best || distance < best.distance) best = { point: { lat: point.lat + y / ky, lng: point.lng + x / kx }, distance };
    }
  }
  return best;
}

// Where a Ward's name goes on the TB Draft Wards layer (Targeted Batch rules 18.7, 1.3.8):
// inside the Ward at the spot nearest `towards` (the draft's meters) — `towards` itself
// when it lies in the Ward, else just across the Ward's nearest edge: straight on first,
// then around that edge point, a little further each time where the edge is jagged or a
// narrow spike — or else the Ward's stored centroid.
export function wardNameLabelPoint(paths, towards, { steps = [40, 80, 160, 320], centroid = null } = {}) {
  if (towards && pointInPaths(towards, paths)) return towards;
  const nearest = towards ? nearestPointOnPaths(towards, paths) : null;
  if (nearest && nearest.distance > 0) {
    const edge = nearest.point;
    const kx = Math.cos((edge.lat * Math.PI) / 180) * METRES_PER_DEGREE, ky = METRES_PER_DEGREE;
    const straight = Math.atan2((edge.lat - towards.lat) * ky, (edge.lng - towards.lng) * kx);
    const turns = [0, 1, -1, 2, -2, 3, -3, 4].map((turn) => straight + (turn * Math.PI) / 4);
    for (const step of steps) {
      for (const angle of turns) {
        const candidate = { lat: edge.lat + (Math.sin(angle) * step) / ky, lng: edge.lng + (Math.cos(angle) * step) / kx };
        if (pointInPaths(candidate, paths)) return candidate;
      }
    }
  }
  return toUsableLatLng(centroid) || pointsCentre(paths[0] || []);
}

// Rules 18.7 (1.3.2): one ERF look for every map. The ERF number only, on the centroid, small and
// light on an off-white label (.ireps-erf-label in index.css) so it stays readable on satellite too.
export const ERF_BOUNDARY_STYLE = Object.freeze({
  strokeColor: "#0284c7",
  strokeOpacity: 0.7,
  strokeWeight: 1,
  fillColor: "#38bdf8",
  fillOpacity: 0.035,
});

// TB-R061 (1.3.64): the Meter Location window draws one ERF at window size rather than a whole
// Ward of them, so it keeps the same colours with a heavier line and a slightly stronger fill.
export const ERF_FOCUS_BOUNDARY_STYLE = Object.freeze({
  ...ERF_BOUNDARY_STYLE,
  strokeOpacity: 1,
  strokeWeight: 3,
  fillOpacity: 0.12,
});

export const ERF_LABEL_STYLE = Object.freeze({
  className: "ireps-erf-label",
  color: "#334155",
  fontWeight: "400",
  fontSize: "10px",
});

// Targeted Batch rules 18.7 (1.3.3): area geofences are green, batch geofences
// (those linked to a Targeted Batch) purple; a selected geofence stays red.
export const GEOFENCE_KIND_COLORS = Object.freeze({ area: "#10b981", batch: "#7c3aed" });

export function geofenceKind(geoFence) {
  return geoFence?.targetedBatch ? "batch" : "area";
}

// Where a geofence's name label sits: its stored centroid, else the average of its points.
export function geofenceLabelPoint(geoFence) {
  const centroid = toUsableLatLng(geoFence?.geometry?.centroid);
  if (centroid) return centroid;
  const path = getGeoFencePath(geoFence);
  if (!path.length) return null;
  return {
    lat: path.reduce((sum, point) => sum + point.lat, 0) / path.length,
    lng: path.reduce((sum, point) => sum + point.lng, 0) / path.length,
  };
}

function onSegment(point, a, b) {
  const epsilon = 1e-12;
  const cross = (b.lng - a.lng) * (point.lat - a.lat) - (b.lat - a.lat) * (point.lng - a.lng);
  if (Math.abs(cross) > epsilon) return false;
  return Math.min(a.lng, b.lng) - epsilon <= point.lng && point.lng <= Math.max(a.lng, b.lng) + epsilon
    && Math.min(a.lat, b.lat) - epsilon <= point.lat && point.lat <= Math.max(a.lat, b.lat) + epsilon;
}

// Strictly inside: a point on an edge counts as outside (as elsewhere in the rules).
function pointInPath(point, path) {
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    if (onSegment(point, path[j], path[i])) return false;
  }
  let inside = false;
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    const a = path[i], b = path[j];
    if ((a.lat > point.lat) !== (b.lat > point.lat)
      && point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}

function segmentsCross(a, b, c, d) {
  const turn = (p, q, r) => Math.sign((q.lng - p.lng) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lng - p.lng));
  const t1 = turn(a, b, c), t2 = turn(a, b, d), t3 = turn(c, d, a), t4 = turn(c, d, b);
  return t1 !== 0 && t2 !== 0 && t3 !== 0 && t4 !== 0 && t1 !== t2 && t3 !== t4;
}

// True when two drawn areas share ground (one inside the other, or edges crossing).
// Touching only along an edge does not count. Paths are [{ lat, lng }].
export function pathsOverlap(first = [], second = []) {
  if (first.length < 3 || second.length < 3) return false;
  const centre = (path) => ({
    lat: path.reduce((sum, point) => sum + point.lat, 0) / path.length,
    lng: path.reduce((sum, point) => sum + point.lng, 0) / path.length,
  });
  if (first.some((point) => pointInPath(point, second)) || second.some((point) => pointInPath(point, first))) return true;
  // Identical or edge-aligned shapes have no corner strictly inside the other.
  if (pointInPath(centre(first), second) || pointInPath(centre(second), first)) return true;
  for (let i = 0; i < first.length; i++) {
    for (let j = 0; j < second.length; j++) {
      if (segmentsCross(first[i], first[(i + 1) % first.length], second[j], second[(j + 1) % second.length])) return true;
    }
  }
  return false;
}

export function fitMapToGeoFence(map, geoFence, padding = 88) {
  if (!map || !geoFence || !window.google?.maps) return;

  const bbox = normalizeBbox(geoFence?.bbox || geoFence?.geometry?.bbox);

  if (bbox) {
    fitMapToBbox(map, bbox, padding);
    return;
  }

  const bounds = new window.google.maps.LatLngBounds();
  let hasAnyPoint = false;

  const geoFencePath = getGeoFencePath(geoFence);

  geoFencePath.forEach((point) => {
    const usablePoint = toUsableLatLng(point);

    if (!usablePoint) return;

    bounds.extend(usablePoint);
    hasAnyPoint = true;
  });

  if (!hasAnyPoint) return;

  map.fitBounds(bounds, padding);
}

