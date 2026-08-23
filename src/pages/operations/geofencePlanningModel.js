export const SALES_PLANNING_STATES = Object.freeze({
  NOT_TOUCHED: "NOT_TOUCHED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  INTEGRITY_EXCEPTION: "INTEGRITY_EXCEPTION",
});

const VALID_FIELDWORK_STATUSES = new Set([
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETED",
]);

const NORMAL_SALES_CATEGORY = "NORMAL - NO LEAKAGE FLAG";

export function normalizePlanningScope(value) {
  return String(value || "").trim().toUpperCase();
}

function cleanText(value) {
  return String(value ?? "").trim();
}

export function isNormalSalesPlanningCategory(sales = {}) {
  return (
    normalizePlanningScope(sales?.leakageCategory) === NORMAL_SALES_CATEGORY
  );
}

function normalizePoint(value, { rejectZeroZero = true } = {}) {
  const lat = Number(value?.lat ?? value?.latitude);
  const lng = Number(value?.lng ?? value?.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (rejectZeroZero && lat === 0 && lng === 0) return null;

  return { lat, lng };
}

function pointIsInsideNormalizedPolygon(candidate, polygon) {
  if (!candidate || polygon.length < 3) return false;

  const x = candidate.lng;
  const y = candidate.lat;
  let inside = false;

  for (let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1) {
    const xi = polygon[index].lng;
    const yi = polygon[index].lat;
    const xj = polygon[previous].lng;
    const yj = polygon[previous].lat;

    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

export function pointIsInsidePlanningPolygon(point, polygonPoints = []) {
  const candidate = normalizePoint(point, { rejectZeroZero: false });
  const polygon = (polygonPoints || [])
    .map((item) => normalizePoint(item, { rejectZeroZero: false }))
    .filter(Boolean);

  return pointIsInsideNormalizedPolygon(candidate, polygon);
}

function parseGeometry(geometry) {
  if (!geometry) return null;
  if (typeof geometry !== "string") return geometry;

  try {
    return JSON.parse(geometry);
  } catch {
    return null;
  }
}

export function geoJsonGeometryToPlanningPaths(geometry) {
  const parsed = parseGeometry(geometry);
  if (!parsed) return [];

  if (parsed.type === "Polygon") {
    return (parsed.coordinates || []).map((ring) =>
      (ring || [])
        .map(([lng, lat]) => normalizePoint({ lat, lng }))
        .filter(Boolean),
    );
  }

  if (parsed.type === "MultiPolygon") {
    return (parsed.coordinates || []).flatMap((polygon) =>
      (polygon || []).map((ring) =>
        (ring || [])
          .map(([lng, lat]) => normalizePoint({ lat, lng }))
          .filter(Boolean),
      ),
    );
  }

  return [];
}

export function getCanonicalAstId(ast = {}) {
  return cleanText(
    ast?.__astId ||
      ast?.id ||
      ast?.astId ||
      ast?.ast?.astData?.astId ||
      ast?.astData?.astId ||
      ast?.trnId,
  );
}

function getAstMeterNo(ast = {}) {
  return (
    cleanText(
      ast?.__meterNo ||
        ast?.ast?.astData?.astNo ||
        ast?.ast?.astData?.meterNo ||
        ast?.astData?.astNo ||
        ast?.meterNo ||
        ast?.id,
    ) || "NAv"
  );
}

function getAstPoint(ast = {}) {
  return normalizePoint(
    ast?.ast?.location?.gps || ast?.location?.gps || ast?.gps,
  );
}

function getAstStatus(ast = {}) {
  return normalizePlanningScope(ast?.status?.state || ast?.status);
}

function getAstLmPcode(ast = {}) {
  return normalizePlanningScope(
    ast?.accessData?.parents?.lmPcode || ast?.parents?.lmPcode || ast?.lmPcode,
  );
}

function getAstWardPcode(ast = {}) {
  return normalizePlanningScope(
    ast?.accessData?.parents?.wardPcode ||
      ast?.parents?.wardPcode ||
      ast?.wardPcode,
  );
}

function getPremiseId(premise = {}, index = 0) {
  return (
    cleanText(premise?.premiseId || premise?.id) ||
    `premise_${index}`
  );
}

function getPremisePoint(premise = {}) {
  return normalizePoint(
    premise?.geometry?.centroid ||
      premise?.centroid ||
      { lat: premise?.lat, lng: premise?.lng },
  );
}

function getPremiseAddress(premise = {}) {
  if (typeof premise?.premiseAddress === "string" && premise.premiseAddress.trim()) {
    return premise.premiseAddress.trim();
  }

  const address = premise?.address;
  if (typeof address === "string") return address.trim() || "NAv";

  const parts = [address?.strNo, address?.strName, address?.strType]
    .map(cleanText)
    .filter(Boolean);

  return parts.join(" ") || "NAv";
}

function getErfId(erf = {}, index = 0) {
  return cleanText(erf?.erfId || erf?.id) || `erf_${index}`;
}

function getErfNo(erf = {}) {
  return (
    cleanText(
      erf?.erfNo ||
        erf?.erf?.erfNo ||
        erf?.erf?.number ||
        erf?.sg?.erfNo ||
        erf?.sg?.parcelNo ||
        erf?.sg?.parcelNumber ||
        erf?.admin?.erfNo ||
        erf?.admin?.parcelNo,
    ) || "NAv"
  );
}

function getErfPoint(erf = {}) {
  return normalizePoint(erf?.centroid || erf?.geometry?.centroid);
}

export function classifySalesPlanningState(sales = {}) {
  const integrity = sales?.tbRefsIntegrity;

  if (!integrity || integrity.valid !== true) {
    return {
      state: SALES_PLANNING_STATES.INTEGRITY_EXCEPTION,
      issues: Array.isArray(integrity?.issues)
        ? integrity.issues
        : ["tbRefsIntegrity"],
    };
  }

  const refs = Array.isArray(sales?.tbRefs) ? sales.tbRefs : [];
  let hasInProgress = false;

  for (const reference of refs) {
    const fieldWork = reference?.fieldWork;
    const rawStatus = fieldWork?.status;
    const status = rawStatus
      ? normalizePlanningScope(rawStatus)
      : "NOT_STARTED";

    if (!VALID_FIELDWORK_STATUSES.has(status)) {
      return {
        state: SALES_PLANNING_STATES.INTEGRITY_EXCEPTION,
        issues: ["tbRefs.fieldWork.status"],
      };
    }

    if (status === "COMPLETED") {
      return { state: SALES_PLANNING_STATES.COMPLETED, issues: [] };
    }

    if (status === "IN_PROGRESS") hasInProgress = true;
  }

  return {
    state: hasInProgress
      ? SALES_PLANNING_STATES.IN_PROGRESS
      : SALES_PLANNING_STATES.NOT_TOUCHED,
    issues: [],
  };
}

function salesCandidateMatchesScope(candidate, lmPcode, wardPcode) {
  return (
    normalizePlanningScope(candidate?.lmPcode) === lmPcode &&
    normalizePlanningScope(candidate?.wardPcode) === wardPcode
  );
}

function normalizeSalesCandidatePoint(candidate = {}) {
  if (candidate?.hasValidGps !== true) return null;

  return normalizePoint(
    {
      latitude: candidate?.latitude,
      longitude: candidate?.longitude,
    },
    { rejectZeroZero: false },
  );
}

export function buildSalesPlanningRecords({
  salesRows = [],
  lmPcode,
  wardPcode,
} = {}) {
  const normalizedLmPcode = normalizePlanningScope(lmPcode);
  const normalizedWardPcode = normalizePlanningScope(wardPcode);
  const recordsById = new Map();

  if (!normalizedLmPcode || !normalizedWardPcode) return [];

  for (const sales of Array.isArray(salesRows) ? salesRows : []) {
    if (isNormalSalesPlanningCategory(sales)) continue;
    if (sales?.geofenceGpsEligible !== true) continue;

    const salesId = cleanText(sales?.id);
    if (!salesId) continue;

    const candidates = (Array.isArray(sales?.erfCandidates)
      ? sales.erfCandidates
      : []
    )
      .map((candidate, index) => {
        if (
          !salesCandidateMatchesScope(
            candidate,
            normalizedLmPcode,
            normalizedWardPcode,
          )
        ) {
          return null;
        }

        const point = normalizeSalesCandidatePoint(candidate);
        if (!point) return null;

        return {
          key: `${salesId}::${cleanText(candidate?.erfId) || index}::${index}`,
          point,
          erfId: cleanText(candidate?.erfId),
          erfNumber: cleanText(candidate?.erfNumber),
        };
      })
      .filter(Boolean);

    if (candidates.length === 0) continue;

    const classification = classifySalesPlanningState(sales);

    recordsById.set(salesId, {
      id: salesId,
      meterNo: cleanText(sales?.meterNo || sales?.meterNoNormalized) || "NAv",
      state: classification.state,
      integrityIssues: classification.issues,
      candidates,
      raw: sales,
    });
  }

  return Array.from(recordsById.values());
}

export function summarizeSalesPlanningRecords(records = []) {
  const summary = {
    total: 0,
    notTouched: 0,
    inProgress: 0,
    completed: 0,
    integrityExceptions: 0,
  };

  (records || []).forEach((record) => {
    switch (record?.state) {
      case SALES_PLANNING_STATES.NOT_TOUCHED:
        summary.notTouched += 1;
        summary.total += 1;
        break;
      case SALES_PLANNING_STATES.IN_PROGRESS:
        summary.inProgress += 1;
        summary.total += 1;
        break;
      case SALES_PLANNING_STATES.COMPLETED:
        summary.completed += 1;
        summary.total += 1;
        break;
      default:
        summary.integrityExceptions += 1;
        break;
    }
  });

  return summary;
}

export function normalizePlanningErfs({ erfs = [], lmPcode, wardPcode } = {}) {
  const normalizedLmPcode = normalizePlanningScope(lmPcode);
  const normalizedWardPcode = normalizePlanningScope(wardPcode);

  return (Array.isArray(erfs) ? erfs : [])
    .filter(
      (erf) =>
        normalizePlanningScope(erf?.lmPcode) === normalizedLmPcode &&
        normalizePlanningScope(erf?.wardPcode) === normalizedWardPcode,
    )
    .map((erf, index) => ({
      id: getErfId(erf, index),
      erfNo: getErfNo(erf),
      point: getErfPoint(erf),
      paths: geoJsonGeometryToPlanningPaths(erf?.geometry),
      raw: erf,
    }));
}

export function normalizePlanningPremises({
  premises = [],
  lmPcode,
  wardPcode,
} = {}) {
  const normalizedLmPcode = normalizePlanningScope(lmPcode);
  const normalizedWardPcode = normalizePlanningScope(wardPcode);

  return (Array.isArray(premises) ? premises : [])
    .filter(
      (premise) =>
        normalizePlanningScope(
          premise?.lmPcode || premise?.parents?.lmPcode,
        ) === normalizedLmPcode &&
        normalizePlanningScope(
          premise?.wardPcode || premise?.parents?.wardPcode,
        ) === normalizedWardPcode,
    )
    .map((premise, index) => ({
      id: getPremiseId(premise, index),
      address: getPremiseAddress(premise),
      point: getPremisePoint(premise),
      raw: premise,
    }))
    .filter((premise) => Boolean(premise.point));
}

export function normalizePlanningAssets({
  assets = [],
  lmPcode,
  wardPcode,
} = {}) {
  const normalizedLmPcode = normalizePlanningScope(lmPcode);
  const normalizedWardPcode = normalizePlanningScope(wardPcode);
  const seenIds = new Set();

  return (Array.isArray(assets) ? assets : [])
    .map((asset) => {
      const id = getCanonicalAstId(asset);
      const point = getAstPoint(asset);

      if (!id || !point) return null;
      if (seenIds.has(id)) return null;
      if (getAstStatus(asset) === "REMOVED") return null;
      if (getAstLmPcode(asset) !== normalizedLmPcode) return null;
      if (getAstWardPcode(asset) !== normalizedWardPcode) return null;

      seenIds.add(id);

      return {
        id,
        meterNo: getAstMeterNo(asset),
        point,
        raw: asset,
      };
    })
    .filter(Boolean);
}

export function getNoGeofencePlanningAstIds(noGeofenceMeters = []) {
  return new Set(
    (Array.isArray(noGeofenceMeters) ? noGeofenceMeters : [])
      .map((meter) => getCanonicalAstId(meter))
      .filter(Boolean),
  );
}

function emptyDraftStats() {
  return {
    erfs: 0,
    premises: 0,
    assets: 0,
    meters: 0,
    sales: {
      total: 0,
      notTouched: 0,
      inProgress: 0,
      completed: 0,
      integrityExceptions: 0,
    },
  };
}

export function buildGeofencePlanningDraftStats({
  draftPoints = [],
  erfs = [],
  premises = [],
  assets = [],
  salesRecords = [],
} = {}) {
  const polygon = (draftPoints || [])
    .map((point) => normalizePoint(point, { rejectZeroZero: false }))
    .filter(Boolean);

  if (polygon.length < 3) return emptyDraftStats();

  const insideErfIds = new Set();
  (erfs || []).forEach((erf) => {
    if (erf?.point && pointIsInsideNormalizedPolygon(erf.point, polygon)) {
      insideErfIds.add(erf.id);
    }
  });

  const insidePremiseIds = new Set();
  (premises || []).forEach((premise) => {
    if (premise?.point && pointIsInsideNormalizedPolygon(premise.point, polygon)) {
      insidePremiseIds.add(premise.id);
    }
  });

  const insideAssetIds = new Set();
  (assets || []).forEach((asset) => {
    if (asset?.point && pointIsInsideNormalizedPolygon(asset.point, polygon)) {
      insideAssetIds.add(asset.id);
    }
  });

  const insideSales = [];
  (salesRecords || []).forEach((record) => {
    const belongs = (record?.candidates || []).some((candidate) =>
      pointIsInsideNormalizedPolygon(candidate?.point, polygon),
    );

    if (belongs) insideSales.push(record);
  });

  const sales = summarizeSalesPlanningRecords(insideSales);

  return {
    erfs: insideErfIds.size,
    premises: insidePremiseIds.size,
    assets: insideAssetIds.size,
    meters: insideAssetIds.size,
    sales,
  };
}

export function buildGeofencePlanningModel({
  lmPcode,
  wardPcode,
  erfs = [],
  premises = [],
  assets = [],
  salesRows = [],
  noGeofenceMeters = [],
  draftPoints = [],
} = {}) {
  const planningErfs = normalizePlanningErfs({ erfs, lmPcode, wardPcode });
  const planningPremises = normalizePlanningPremises({
    premises,
    lmPcode,
    wardPcode,
  });
  const planningAssets = normalizePlanningAssets({
    assets,
    lmPcode,
    wardPcode,
  });
  const noGeofenceAstIds = getNoGeofencePlanningAstIds(noGeofenceMeters);
  const generalAssets = planningAssets.filter(
    (asset) => !noGeofenceAstIds.has(asset.id),
  );
  const salesRecords = buildSalesPlanningRecords({
    salesRows,
    lmPcode,
    wardPcode,
  });
  const salesSummary = summarizeSalesPlanningRecords(salesRecords);

  return {
    erfs: planningErfs,
    premises: planningPremises,
    assets: planningAssets,
    generalAssets,
    noGeofenceAstIds,
    salesRecords,
    salesSummary,
    draftStats: buildGeofencePlanningDraftStats({
      draftPoints,
      erfs: planningErfs,
      premises: planningPremises,
      assets: planningAssets,
      salesRecords,
    }),
  };
}
