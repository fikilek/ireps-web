import { onCall } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { nonblank, SALES_BATCH_ID } from "../salesAllMeters/sales-batch-policy.js";
import { polygonFromPoints, normalizeBatchGeometry, strictlyInside, strictlyWithinWard, batchGeometryBounds } from "../geofences/sales-batch-geometry.js";
import { batchError, canonicalJson, materialHash, requireBatchIntent, readBatchActor, snapshotReader, proofScope, readDraftAssessment, createProofCodec, salesBatchProofKey, callableFailure } from "./sales-batch-resolution.js";

export const salesBatchFenceId = tbId => {
  if (!SALES_BATCH_ID.test(tbId)) throw batchError("INVALID_BATCH_ID", "Invalid batch identity");
  return `SALES_${tbId}`;
};
export function assertDedicatedFence(fence, intent, actor, { linked = false } = {}) {
  if (!fence || fence.id !== salesBatchFenceId(intent.tbId) || fence.purpose !== "SALES_TARGETED_BATCH" || fence.status !== "BATCH_ONLY" || fence.proposedTbId !== intent.tbId || fence.metadata?.createdByUid !== actor.uid || fence.parents?.lmPcode !== intent.lmPcode || fence.linkState !== (linked ? "LINKED" : "UNLINKED")) throw batchError("GEOFENCE_OWNERSHIP_CONFLICT", "The dedicated geofence is missing, already consumed or belongs to another proposal or actor");
  if (!Array.isArray(fence.savedSalesIds) || fence.savedSalesIds.length < 1 || fence.savedSalesIds.length > 30 || new Set(fence.savedSalesIds).size !== fence.savedSalesIds.length || materialHash(normalizeBatchGeometry(fence.geometry)) !== fence.geometryHash) throw batchError("GEOFENCE_INTEGRITY_INVALID", "Saved geofence geometry or population is invalid");
}
export async function saveSalesBatchGeofence({ db, request, codec, now = () => Timestamp.now() }) {
  const intent = requireBatchIntent(request.data), geometry = polygonFromPoints(intent.points);
  const savedSalesIds = intent.saveSalesIds;
  if (!Array.isArray(savedSalesIds) || !savedSalesIds.length || savedSalesIds.length > 30 || new Set(savedSalesIds).size !== savedSalesIds.length || savedSalesIds.some(id => !intent.salesIds.includes(id))) throw batchError("INVALID_SAVED_POPULATION", "Confirm the complete meters to include when saving this fence");
  const ids = [...savedSalesIds].sort(), fenceId = salesBatchFenceId(intent.tbId);
  return db.runTransaction(async tx => {
    const read = snapshotReader(tx), actor = await readBatchActor({ db, request, lmPcode: intent.lmPcode, read });
    const existing = await read(db.doc(`geo_fences/${fenceId}`));
    const parent = await read(db.doc(`tb_uploads/${intent.tbId}`));
    if (parent.exists) throw batchError("BATCH_ALREADY_EXISTS", "The proposed batch already exists");
    const assessment = await readDraftAssessment({ db, request, intent, actor, codec, read });
    if (assessment.wards.length !== 1) throw batchError("MIXED_OR_UNRESOLVED_WARDS", `Exactly one Ward is required. Wards: ${assessment.wards.join(", ") || "unresolved"}`);
    for (const id of ids) {
      const row = assessment.rows.find(item => item.salesId === id), context = assessment.contexts.get(id);
      if (!row?.ready || !context) throw batchError(row?.code || "ROW_INCOMPLETE", `${row?.meterNo || id}: ${row?.reason || "incomplete"}`);
      if (!strictlyWithinWard(geometry, context.wardGeometry)) throw batchError("GEOFENCE_OUTSIDE_WARD", "The complete geofence must lie strictly inside the Ward, without touching its boundary");
      if (!strictlyInside(context.centroid, geometry)) throw batchError("CENTROID_OUTSIDE_GEOFENCE", `ERF centroid for ${row.meterNo} is outside or on the geofence boundary`);
    }
    const context = assessment.contexts.get(ids[0]), geometryHash = materialHash(geometry);
    const saveFingerprint = materialHash({ ...proofScope({ db, actor, intent }), wardPcode: assessment.wards[0], geometryHash, savedSalesIds: ids });
    if (existing.exists) {
      const fence = existing.data(); assertDedicatedFence(fence, intent, actor);
      if (fence.saveFingerprint !== saveFingerprint) throw batchError("GEOFENCE_IMMUTABLE", "This proposal already has a different saved fence or population; start a new proposal");
      return { success: true, geofenceId: fenceId, savedSalesIds: fence.savedSalesIds, scope: context.scope, reused: true };
    }
    const at = now(), bounds = batchGeometryBounds(geometry), ring = geometry.coordinates[0].slice(0, -1);
    const points = ring.map(([longitude, latitude], order) => ({ latitude, longitude, order }));
    tx.create(db.doc(`geo_fences/${fenceId}`), {
      id: fenceId, name: `Targeted Batch ${intent.tbId}`, description: "Dedicated Sales Targeted Batch geofence", purpose: "SALES_TARGETED_BATCH", status: "BATCH_ONLY", proposedTbId: intent.tbId, linkState: "UNLINKED", savedSalesIds: ids, saveFingerprint, geometryHash,
      geometry: { type: "Polygon", points, bbox: { minLatitude: bounds.minLat, maxLatitude: bounds.maxLat, minLongitude: bounds.minLng, maxLongitude: bounds.maxLng }, centroid: { latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length, longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length } },
      parents: { countryPcode: context.erf.admin?.country?.pcode || "ZA", provincePcode: context.erf.admin?.province?.pcode || "NAv", dmPcode: context.erf.admin?.districtMunicipality?.pcode || "NAv", lmPcode: intent.lmPcode, wardPcode: assessment.wards[0] },
      counts: { erfs: 0, premises: 0, meters: 0, salesMeters: 0 },
      metadata: { createdAt: at, createdByUid: actor.uid, createdByUser: actor.user, updatedAt: at, updatedByUid: actor.uid, updatedByUser: actor.user },
    });
    return { success: true, geofenceId: fenceId, savedSalesIds: ids, scope: context.scope, reused: false };
  });
}
export function confirmationMaterial(intent, assessment, fence) {
  return { tbId: intent.tbId, source: intent.source, lmPcode: intent.lmPcode, reason: intent.reason, salesPeriodFrom: intent.salesPeriodFrom ?? null, salesPeriodTo: intent.salesPeriodTo ?? null, retainedIds: intent.salesIds, includedIds: assessment.includedIds, leftOut: assessment.leftOut, material: assessment.material, geofenceId: fence.id, geometryHash: fence.geometryHash, fenceHash: materialHash(fence), rows: assessment.rows.filter(row => row.ready).map(row => ({ salesId: row.salesId, erfId: row.erfId, rowNo: fence.savedSalesIds.indexOf(row.salesId) + 1 })) };
}
export async function assessSalesBatch({ db, request, codec }) {
  const intent = requireBatchIntent(request.data);
  if (!nonblank(intent.reason)) throw batchError("REASON_REQUIRED", "Enter a selection reason before confirmation");
  return db.runTransaction(async tx => {
    const read = snapshotReader(tx), actor = await readBatchActor({ db, request, lmPcode: intent.lmPcode, read });
    const snapshot = await read(db.doc(`geo_fences/${salesBatchFenceId(intent.tbId)}`));
    const fence = snapshot.exists ? snapshot.data() : null; assertDedicatedFence(fence, intent, actor);
    const assessment = await readDraftAssessment({ db, request, intent, actor, codec, read, fence });
    if (assessment.wards.length !== 1) throw batchError("MIXED_OR_UNRESOLVED_WARDS", `Create requires one Ward. Wards: ${assessment.wards.join(", ") || "unresolved"}`);
    if (!assessment.includedIds.length) throw batchError("NO_READY_METERS", "No retained meter is ready for this saved geofence");
    const material = confirmationMaterial(intent, assessment, fence);
    const fingerprint = materialHash(material);
    const confirmationProof = codec.sign({ kind: "CONFIRMATION", ...proofScope({ db, actor, intent }), fingerprint, material });
    // No coordinates, raw Sales or signed geocode envelopes enter permanent documents.
    return { success: true, tbId: intent.tbId, fingerprint, confirmationProof, expiresAt: Math.min(codec.verify(confirmationProof).expiresAt, ...assessment.rows.filter(row => row.ready && row.expiresAt).map(row => row.expiresAt)), includedIds: assessment.includedIds, rows: assessment.rows.map(({ evidence: _evidence, ...row }) => row), leftOut: assessment.leftOut, scope: assessment.contexts.get(assessment.includedIds[0]).scope, materialIdentity: canonicalJson(material) };
  });
}
export const saveSalesTargetedBatchGeofenceCallable = onCall({ secrets: [salesBatchProofKey], timeoutSeconds: 180, memory: "1GiB" }, async request => {
  try { return await saveSalesBatchGeofence({ db: getFirestore(), request, codec: createProofCodec(salesBatchProofKey.value()) }); } catch (error) { return callableFailure(error); }
});
export const assessSalesTargetedBatchCallable = onCall({ secrets: [salesBatchProofKey], timeoutSeconds: 180, memory: "1GiB" }, async request => {
  try { return await assessSalesBatch({ db: getFirestore(), request, codec: createProofCodec(salesBatchProofKey.value()) }); } catch (error) { return callableFailure(error); }
});
