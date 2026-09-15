import { difference } from "@turf/difference";
import { booleanValid } from "@turf/boolean-valid";
import { kinks } from "@turf/kinks";
import { orient2d } from "robust-predicates";
import { coordinateNumber } from "../salesAllMeters/sales-batch-policy.js";

export const MAX_DRAW_VERTICES = 300;
export const MAX_GEOMETRY_BYTES = 2_000_000;
const fail = message => { throw new Error(message); };
const equal = (a, b) => a[0] === b[0] && a[1] === b[1];
export function pointCoordinates(point) {
  const rawLat = Array.isArray(point) ? point[1] : point?.latitude ?? point?.lat;
  const rawLng = Array.isArray(point) ? point[0] : point?.longitude ?? point?.lng;
  const latitude = coordinateNumber(rawLat, 90);
  const longitude = coordinateNumber(rawLng, 180);
  if (latitude === null || longitude === null) fail("Coordinates are missing or invalid");
  return [longitude, latitude];
}
export function polygonFromPoints(points) {
  if (!Array.isArray(points) || points.length < 3 || points.length > MAX_DRAW_VERTICES) fail("Draw between 3 and 300 vertices");
  const ring = points.map(pointCoordinates);
  if (!equal(ring[0], ring.at(-1))) ring.push([...ring[0]]);
  return normalizeBatchGeometry({ type: "Polygon", coordinates: [ring] });
}
// Targeted Batch rules 18.7 (1.3.30): validating a large boundary (a Ward has thousands of points)
// takes about a third of a second, and testing a point inside it takes microseconds. A shape this
// function has validated is recognised and not validated again, and the same stored boundary text is
// validated once, so checking many points against one Ward no longer freezes TB Draft. The shapes it
// returns are never modified by their users.
const VALIDATED = new WeakSet();
const VALIDATED_OBJECTS = new WeakMap();
const VALIDATED_TEXT = new Map();
const VALIDATED_TEXT_LIMIT = 32;
export function normalizeBatchGeometry(value) {
  if (value && typeof value === "object") {
    if (VALIDATED.has(value)) return value;
    if (VALIDATED_OBJECTS.has(value)) return VALIDATED_OBJECTS.get(value);
  }
  if (typeof value === "string" && VALIDATED_TEXT.has(value)) return VALIDATED_TEXT.get(value);
  const normalized = validateBatchGeometry(value);
  VALIDATED.add(normalized);
  if (value && typeof value === "object") VALIDATED_OBJECTS.set(value, normalized);
  if (typeof value === "string") {
    if (VALIDATED_TEXT.size >= VALIDATED_TEXT_LIMIT) VALIDATED_TEXT.delete(VALIDATED_TEXT.keys().next().value);
    VALIDATED_TEXT.set(value, normalized);
  }
  return normalized;
}
function validateBatchGeometry(value) {
  let geometry = value;
  if (typeof geometry === "string") {
    if (geometry.length > MAX_GEOMETRY_BYTES) fail("Geometry exceeds the supported size");
    try { geometry = JSON.parse(geometry); } catch { fail("Invalid geometry JSON"); }
  }
  if (geometry?.type === "Feature") geometry = geometry.geometry;
  if (geometry?.points) return polygonFromPoints(geometry.points);
  if (!["Polygon", "MultiPolygon"].includes(geometry?.type)) fail("A Polygon or MultiPolygon is required");
  if (JSON.stringify(geometry).length > MAX_GEOMETRY_BYTES) fail("Geometry exceeds the supported size");
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons) || !polygons.length) fail("Empty geometry");
  let vertices = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) fail("Empty polygon");
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4 || !equal(ring[0], ring.at(-1))) fail("Polygon rings must be closed");
      vertices += ring.length;
      if (vertices > 20000) fail("Geometry vertex limit exceeded");
      for (const p of ring) {
        if (!Array.isArray(p) || p.length !== 2 || p.some(n => typeof n !== "number") || !equal(pointCoordinates(p), p)) fail("Invalid polygon vertex");
      }
      const seen = new Set(ring.slice(0, -1).map(p => `${p[0]},${p[1]}`));
      if (seen.size !== ring.length - 1 || seen.size < 3) fail("Repeated or insufficient vertices");
      const origin = ring[0];
      if (!ring.some((p, i) => i > 1 && orient2d(...origin, ...ring[1], ...p) !== 0)) fail("Degenerate polygon");
    }
  }
  const normalized = { type: geometry.type, coordinates: JSON.parse(JSON.stringify(geometry.coordinates)) };
  if (!booleanValid(normalized) || kinks(normalized).features.length) fail("Polygon is not simple and valid");
  // Holes must be contained by the exterior; malformed imported geometry is not no-match.
  for (const polygon of polygons) {
    for (const hole of polygon.slice(1)) {
      if (!ringInside(hole[0], polygon[0]) || ringsTouch(hole, polygon[0])) fail("Polygon hole lies outside its exterior");
    }
    for (let i = 1; i < polygon.length; i++) for (let j = i + 1; j < polygon.length; j++) {
      if (ringsTouch(polygon[i], polygon[j]) || ringInside(polygon[i][0], polygon[j]) || ringInside(polygon[j][0], polygon[i])) fail("Polygon holes overlap");
    }
  }
  // A rotated or reversed ring describes the same intent and must hash identically.
  const canonicalRing = ring => {
    const vertices = ring.slice(0, -1);
    const start = vertices.reduce((best, p, i) => p[0] < vertices[best][0] || (p[0] === vertices[best][0] && p[1] < vertices[best][1]) ? i : best, 0);
    const forward = vertices.map((_, i) => vertices[(start + i) % vertices.length]);
    const reverse = vertices.map((_, i) => vertices[(start - i + vertices.length) % vertices.length]);
    const result = JSON.stringify(forward) < JSON.stringify(reverse) ? forward : reverse;
    return [...result, [...result[0]]];
  };
  const canonicalPolygons = polygons.map(polygon => [canonicalRing(polygon[0]), ...polygon.slice(1).map(canonicalRing).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
  return { type: geometry.type, coordinates: geometry.type === "Polygon" ? canonicalPolygons[0] : canonicalPolygons.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
}
export function pointOnSegment(p, a, b) {
  return orient2d(...a, ...b, ...p) === 0 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
}
export function segmentsTouch(a, b, c, d) {
  if (pointOnSegment(a, c, d) || pointOnSegment(b, c, d) || pointOnSegment(c, a, b) || pointOnSegment(d, a, b)) return true;
  const abC = orient2d(...a, ...b, ...c), abD = orient2d(...a, ...b, ...d);
  const cdA = orient2d(...c, ...d, ...a), cdB = orient2d(...c, ...d, ...b);
  return Math.sign(abC) !== Math.sign(abD) && Math.sign(cdA) !== Math.sign(cdB) && abC !== 0 && abD !== 0 && cdA !== 0 && cdB !== 0;
}
function ringInside(point, ring) {
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i];
    if (pointOnSegment(point, a, b)) return false;
    // Robust orientation determines which side of a crossing the point lies on.
    if ((a[1] > point[1]) !== (b[1] > point[1])) {
      const orientation = orient2d(...a, ...b, ...point);
      if ((orientation < 0) === (b[1] > a[1])) inside = !inside;
    }
  }
  return inside;
}
const ringsOf = geometry => geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
function ringsTouch(left, right) {
  for (let i = 1; i < left.length; i++) for (let j = 1; j < right.length; j++) if (segmentsTouch(left[i - 1], left[i], right[j - 1], right[j])) return true;
  return false;
}
export function strictlyInside(point, input) {
  const p = pointCoordinates(point);
  const geometry = normalizeBatchGeometry(input);
  // Every boundary is excluded, including holes and other multipolygon islands.
  for (const ring of ringsOf(geometry)) for (let i = 1; i < ring.length; i++) if (pointOnSegment(p, ring[i - 1], ring[i])) return false;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(polygon => ringInside(p, polygon[0]) && !polygon.slice(1).some(hole => ringInside(p, hole)));
}
export function strictlyWithinWard(fenceInput, wardInput) {
  const fence = normalizeBatchGeometry(fenceInput), ward = normalizeBatchGeometry(wardInput);
  for (const a of ringsOf(fence)) for (const b of ringsOf(ward)) if (ringsTouch(a, b)) return false;
  const outside = difference({ type: "FeatureCollection", features: [fence, ward].map(geometry => ({ type: "Feature", properties: {}, geometry })) });
  return outside === null;
}
export function batchGeometryBounds(input) {
  const points = ringsOf(normalizeBatchGeometry(input)).flat();
  return { minLat: Math.min(...points.map(p => p[1])), maxLat: Math.max(...points.map(p => p[1])), minLng: Math.min(...points.map(p => p[0])), maxLng: Math.max(...points.map(p => p[0])) };
}
