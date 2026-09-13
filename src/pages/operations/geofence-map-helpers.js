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

