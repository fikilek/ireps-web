// How far one point is from another, on the ground, in metres.
//
// ONE WELL. Nothing in iREPS computed a distance between two points before
// this: the Targeted Batch maps draw shapes and fit bounds, and the monitoring
// map plots positions, but none of them measures. So this is the first and it
// must stay the only one — a second copy of this arithmetic somewhere else is
// how two screens come to disagree about how far away a worker is.
//
// `DR-R001` 3 needs it twice over: the distance from each field worker to this
// meter, nearest first, and the 100 m ring that decides who is drawn on the map
// at all.

const EARTH_RADIUS_M = 6371008.8; // IUGG mean earth radius

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * A lat/lng out of whatever shape a record happens to carry, or `null`.
 *
 * Meters, premises and live positions each nest their coordinates differently,
 * and none of them is worth a second reader.
 */
export function readPoint(source) {
  const candidates = [
    source,
    source?.gps,
    source?.location,
    source?.location?.gps,
    source?.ast?.location?.gps,
  ];

  for (const candidate of candidates) {
    const lat = Number(candidate?.lat ?? candidate?.latitude);
    const lng = Number(candidate?.lng ?? candidate?.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

    // 0,0 is in the Atlantic. Nothing iREPS works on is there, and it is what
    // an unset pair of coordinates looks like, so it is treated as no position
    // rather than as a point every worker is thousands of kilometres from.
    if (lat === 0 && lng === 0) continue;

    return { lat, lng };
  }

  return null;
}

/**
 * Metres between two points, or `null` when either one has no position.
 *
 * **Null is not zero.** A worker whose phone has never reported is not standing
 * on the meter, and a distance of 0 would sort him to the top of the list as
 * the nearest man available. The caller shows `NAv` for null and sorts it last.
 */
export function metresBetween(from, to) {
  const a = readPoint(from);
  const b = readPoint(to);

  if (!a || !b) return null;

  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The distance as the office reads it: `64 m`, `1.4 km`, or `NAv`.
 *
 * Metres up to a kilometre, because that is the range the 100 m ring and the
 * walk to the gate live in; kilometres above it, because nobody drives to
 * `4832 m`.
 */
export function formatDistance(metres) {
  if (metres === null || !Number.isFinite(metres)) return "NAv";

  if (metres < 1000) return `${Math.round(metres)} m`;

  const km = metres / 1000;

  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/** Within the ring `DR-R001` 3 draws, so he belongs on the map. */
export const ON_THE_MAP_RADIUS_M = 100;

export function isWithinRadius(metres, radius = ON_THE_MAP_RADIUS_M) {
  return metres !== null && Number.isFinite(metres) && metres <= radius;
}
