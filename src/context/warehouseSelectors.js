// src/selectors/warehouseSelectors.js

// Robust time parser (handles Firestore Timestamp, {seconds}, ISO strings)
const toMillis = (v) => {
  if (!v) return 0;

  // Firestore Timestamp
  if (typeof v?.toMillis === "function") return v.toMillis();

  // { seconds, nanoseconds }
  if (typeof v?.seconds === "number") return v.seconds * 1000;

  // ISO string
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
};

export const buildGeoLibrary = ({ wards = [], erfGeoEntries = {} }) => {
  const geoLibrary = { ...(erfGeoEntries || {}) };

  const wardsArr = Array.isArray(wards) ? wards : [];

  wardsArr.forEach((w) => {
    if (w?.id) geoLibrary[w.id] = w;
  });

  return geoLibrary;
};

export const selectFilteredWards = ({ wards = [] }) => {
  const wardsArr = Array.isArray(wards) ? wards : [];

  // Always return the full LM ward pool.
  // Do NOT collapse to selectedWard only.
  // This keeps GCS, ErfsScreen, and MapsScreen able to switch wards freely.
  return [...wardsArr].sort((a, b) => (a.code ?? 0) - (b.code ?? 0));
};

export const selectFilteredErfs = ({ erfs = [], selectedErfId = null }) => {
  const erfsArr = Array.isArray(erfs) ? erfs : [];

  if (selectedErfId) {
    return erfsArr.filter((e) => e?.id === selectedErfId);
  }

  return [...erfsArr].sort(
    (a, b) =>
      toMillis(b?.metadata?.updatedAt) - toMillis(a?.metadata?.updatedAt),
  );
};

const belongsToSelectedGeofence = (entity, selectedGeofenceId = null) => {
  if (!selectedGeofenceId) return true;

  const geofenceRefs = Array.isArray(entity?.geofenceRefs)
    ? entity.geofenceRefs
    : [];

  return geofenceRefs.some((ref) => ref?.id === selectedGeofenceId);
};

export const selectFilteredPrems = ({
  prems = [],
  selectedErfId = null,
  selectedPremiseId = null,
  selectedGeofenceId = null,
}) => {
  const premsArr = Array.isArray(prems) ? prems : [];

  const geofenceFilteredPrems = premsArr.filter((premise) =>
    belongsToSelectedGeofence(premise, selectedGeofenceId),
  );

  if (selectedPremiseId) {
    return geofenceFilteredPrems.filter(
      (p) => (p?.premiseId || p?.id || null) === selectedPremiseId,
    );
  }

  if (selectedErfId) {
    return geofenceFilteredPrems.filter(
      (p) => (p?.erfId || p?.erf?.id || null) === selectedErfId,
    );
  }

  return geofenceFilteredPrems;
};

export const selectFilteredMeters = ({
  meters = [],
  selectedErfId = null,
  selectedPremiseId = null,
  selectedMeterId = null,
  selectedGeofenceId = null,
}) => {
  const metersArr = Array.isArray(meters) ? meters : [];

  const geofenceFilteredMeters = metersArr.filter((meter) =>
    belongsToSelectedGeofence(meter, selectedGeofenceId),
  );

  if (selectedMeterId) {
    return geofenceFilteredMeters.filter(
      (m) =>
        (m?.ast?.astData?.astId ||
          m?.astData?.astId ||
          m?.meterId ||
          m?.id ||
          null) === selectedMeterId,
    );
  }

  if (selectedPremiseId) {
    return geofenceFilteredMeters.filter(
      (m) =>
        (m?.accessData?.premise?.id || m?.premiseId || null) ===
        selectedPremiseId,
    );
  }

  if (selectedErfId) {
    return geofenceFilteredMeters.filter(
      (m) => (m?.accessData?.erfId || m?.erfId || null) === selectedErfId,
    );
  }

  return geofenceFilteredMeters;
};

export const selectFilteredTrns = ({
  trns = [],
  selectedErfId = null,
  selectedPremiseId = null,
  selectedMeterId = null,
}) => {
  const trnsArr = Array.isArray(trns) ? trns : [];

  if (selectedMeterId) {
    return trnsArr.filter((t) => t?.derived?.astId === selectedMeterId);
  }

  if (selectedPremiseId) {
    return trnsArr.filter(
      (t) => t?.accessData?.premise?.id === selectedPremiseId,
    );
  }

  if (selectedErfId) {
    return trnsArr.filter((t) => t?.accessData?.erfId === selectedErfId);
  }

  return trnsArr;
};
