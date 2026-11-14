import { buildTargetedBatchMapReadModel } from "../../sales/models/salesTargetedBatchReadModel.js";

const text = (value) => String(value ?? "").trim();
const unique = (values) => [...new Set(values.map(text).filter((value) => value && value !== "NAv"))].sort();

export function mdBgoMapMembership(rows = []) {
  return {
    erfIds: unique(rows.map((row) => row.erf?.id || row.refs?.erfId || row.erfId)),
    premiseIds: unique(rows.map((row) => row.refs?.premiseId || row.premise?.id)),
    meterIds: unique(rows.map((row) => row.refs?.meterId)),
  };
}

// Keep MD BGO membership in bgo_rows; reuse TB's proven spatial normalization.
export function buildMdBgoMapModel({ batchId, lmPcode, batch, rows = [], erfById = {}, premiseById = {}, meterById = {}, geofence = null }) {
  const links = rows.flatMap((row) => {
    const erfId = text(row.erf?.id || row.refs?.erfId || row.erfId);
    const premiseId = text(row.refs?.premiseId || row.premise?.id);
    const meters = unique([
      row.refs?.meterId,
      ...Object.values(meterById).filter((meter) => premiseId && text(meter.accessData?.premise?.id) === premiseId).map((meter) => meter.id),
    ]);
    return (meters.length ? meters : [null]).map((meterId) => ({ id: row.id, rowNo: row.rowNo, refs: { erfId, premiseId, meterId } }));
  });
  const model = buildTargetedBatchMapReadModel({ tbId: batchId, expectedLmPcode: lmPcode, batch, rows: links, erfById, premiseById: batchPremisesWithGps(premiseById), meterById });
  return {
    ...model,
    batch,
    geofence,
    membership: { ...model.membership, rowCount: rows.length },
    diagnostics: { ...model.diagnostics, rows: rows.length },
  };
}

export function batchPremisesWithGps(records = {}) {
  return Object.fromEntries(Object.entries(records).map(([id, premise]) => [id, { ...premise,
    geometry: { ...premise.geometry, centroid: premise.geometry?.centroid || premise.gps || premise.location?.gps || null } }]));
}
