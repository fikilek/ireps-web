import { onCall } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { nonblank, validDocumentId } from "../salesAllMeters/sales-batch-policy.js";
import { polygonFromPoints, normalizeBatchGeometry, strictlyInside, strictlyWithinWard } from "../geofences/sales-batch-geometry.js";
import { assertCanCreateGeoFence, buildGeoFenceDocument } from "../geofences/helpers.js";
import { findDuplicateGeofence, duplicateGeofenceNameMessage } from "../geofences/geofence-name.js";
import { batchError, canonicalJson, materialHash, requireBatchIntent, readBatchActor, snapshotReader, proofScope, readDraftAssessment, createProofCodec, salesBatchProofKey, callableFailure } from "./sales-batch-resolution.js";
import { latestSalesCategoryMonth } from "../salesAllMeters/sales-category-month.js";
import { findSalesMapFenceMeters, salesMapFenceProblem } from "./sales-map-fence.js";

export function requireSalesBatchFenceId(intent) {
  if (!validDocumentId(intent.geofenceId)) throw batchError("GEOFENCE_REQUIRED", "Create a new geofence for this draft");
  return intent.geofenceId;
}
export function assertDedicatedFence(fence, intent, actor, { linked = false } = {}) {
  if (!fence || fence.status !== "ACTIVE" || !fence.targetedBatch) throw batchError("GEOFENCE_REQUIRED", "Create a new geofence for this draft; the earlier fence model cannot be used");
  const link = fence.targetedBatch;
  if (fence.id !== requireSalesBatchFenceId(intent) || link.tbId !== intent.tbId || fence.metadata?.createdByUid !== actor.uid || fence.parents?.lmPcode !== intent.lmPcode || link.linkState !== (linked ? "LINKED" : "UNLINKED")) throw batchError("GEOFENCE_OWNERSHIP_CONFLICT", "The geofence is missing, already consumed or belongs to another proposal or actor");
  if (!Array.isArray(link.salesIds) || link.salesIds.length < 1 || link.salesIds.length > 30 || new Set(link.salesIds).size !== link.salesIds.length || materialHash(normalizeBatchGeometry(fence.geometry)) !== link.geometryHash) throw batchError("GEOFENCE_INTEGRITY_INVALID", "Saved geofence geometry or population is invalid");
}
export async function createSalesBatchGeofence({ db, request, codec, name, description, parents, rawPoints }) {
  const intent = requireBatchIntent(request.data.targetedBatch), geometry = polygonFromPoints(rawPoints);
  if (parents.lmPcode !== intent.lmPcode) throw batchError("GEOFENCE_SCOPE_INVALID", "The geofence and draft must have the same LM");
  // Targeted Batch rules TB-R055: a geofence drawn on the GPS Sales map never holds more than 30
  // meters that can be batched, counted the same way as on the map.
  if (request.data.salesMapFence === true) {
    if (intent.source !== "PREPAID_SALES") throw batchError("SALES_MAP_FENCE_GPS_ONLY", "Only GPS Sales are batched from the GPS Sales map");
    const categoryMonth = await latestSalesCategoryMonth(db, intent.lmPcode);
    const insideIds = await findSalesMapFenceMeters({ db, geometry, lmPcode: intent.lmPcode, wardPcode: parents.wardPcode, categoryMonth });
    const problem = salesMapFenceProblem({ insideIds, sentIds: intent.salesIds });
    if (problem) throw batchError(problem.code, problem.message);
  }
  const geometryHash = materialHash(geometry), ref = db.collection("geo_fences").doc();
  return db.runTransaction(async tx => {
    const read = snapshotReader(tx), actor = await readBatchActor({ db, request, lmPcode: intent.lmPcode, read });
    const spId = actor.profile.employment?.serviceProvider?.id;
    const sp = actor.profile.employment?.role === "SPV" && validDocumentId(spId) ? await read(db.doc(`serviceProviders/${spId}`)) : null;
    await assertCanCreateGeoFence({ actorUserDoc: actor.profile, allServiceProviders: sp?.exists ? [{ ...sp.data(), id: sp.id }] : [] });
    // A transactional query protects the uniqueness predicate as well as existing documents.
    // Contention/retries are covered by the emulator, including initially empty results.
    const existing = await read(db.collection("geo_fences").where("targetedBatch.tbId", "==", intent.tbId).limit(2));
    const parent = await read(db.doc(`tb_uploads/${intent.tbId}`));
    if (parent.exists) throw batchError("BATCH_ALREADY_EXISTS", "The proposed batch already exists");
    const fingerprint = materialHash({ ...proofScope({ db, actor, intent }), parents, name, description, geometryHash, salesIds: [...intent.salesIds].sort() });
    if (existing.docs.length) {
      const fence = existing.docs[0].data();
      assertDedicatedFence(fence, { ...intent, geofenceId: existing.docs[0].id }, actor);
      if (existing.docs.length !== 1 || fence.targetedBatch.fingerprint !== fingerprint) throw batchError("GEOFENCE_IMMUTABLE", "This proposal already has a different saved fence or population; start a new draft");
      return { success: true, geofenceId: fence.id, savedSalesIds: fence.targetedBatch.salesIds, counts: fence.counts, reused: true };
    }
    const assessment = await readDraftAssessment({ db, request, intent, actor, codec, read });
    if (assessment.wards.length !== 1) throw batchError("MIXED_OR_UNRESOLVED_WARDS", "Exactly one Ward is required");
    const wardPcode = assessment.wards[0];
    if (parents.wardPcode !== wardPcode) throw batchError("GEOFENCE_SCOPE_INVALID", "The geofence must use the draft's authoritative Ward");
    // Geofences rules GF-R002: a new batch geofence may not take an active geofence's name in the Ward.
    // (Saving again for the same batch returned the saved geofence above.)
    const wardFences = await read(db.collection("geo_fences").where("parents.wardPcode", "==", wardPcode));
    const duplicate = findDuplicateGeofence(name, wardFences.docs.map(doc => doc.data()));
    if (duplicate) throw batchError("GEOFENCE_NAME_TAKEN", duplicateGeofenceNameMessage(duplicate));
    const context = [...assessment.contexts.values()][0];
    if (!strictlyWithinWard(geometry, context.wardGeometry)) throw batchError("GEOFENCE_OUTSIDE_WARD", "The complete geofence must lie strictly inside the Ward, without touching its boundary");
    const ids = assessment.rows.filter(row => row.ready && strictlyInside(assessment.contexts.get(row.salesId).centroid, geometry)).map(row => row.salesId).sort();
    if (!ids.length) throw batchError("NO_READY_METERS", "The geofence must contain at least one complete draft meter's ERF centroid");
    const points = geometry.coordinates[0].slice(0, -1).map(([longitude, latitude], order) => ({ latitude, longitude, order }));
    const document = buildGeoFenceDocument({ id: ref.id, name, description, parents: {
      countryPcode: context.erf.admin?.country?.pcode || "ZA", provincePcode: context.erf.admin?.province?.pcode || "NAv",
      dmPcode: context.erf.admin?.districtMunicipality?.pcode || "NAv", lmPcode: intent.lmPcode, wardPcode,
    }, points, actorUid: actor.uid, actorName: actor.user, now: new Date().toISOString() });
    document.targetedBatch = { tbId: intent.tbId, linkState: "UNLINKED", salesIds: ids, fingerprint, geometryHash };
    tx.create(ref, document);
    return { success: true, geofenceId: ref.id, savedSalesIds: ids, scope: context.scope, counts: document.counts, reused: false };
  });
}
export function confirmationMaterial(intent, assessment, fence) {
  return { tbId: intent.tbId, source: intent.source, lmPcode: intent.lmPcode, reason: intent.reason, salesPeriodFrom: intent.salesPeriodFrom ?? null, salesPeriodTo: intent.salesPeriodTo ?? null, retainedIds: intent.salesIds, includedIds: assessment.includedIds, leftOut: assessment.leftOut, material: assessment.material, geofenceId: fence.id, geometryHash: fence.targetedBatch.geometryHash, fenceHash: materialHash({ id: fence.id, status: fence.status, parents: fence.parents, geometry: fence.geometry, targetedBatch: fence.targetedBatch, owner: fence.metadata.createdByUid }), rows: assessment.rows.filter(row => row.ready).map(row => ({ salesId: row.salesId, erfId: row.erfId, rowNo: fence.targetedBatch.salesIds.indexOf(row.salesId) + 1 })) };
}
export async function assessSalesBatch({ db, request, codec }) {
  const intent = requireBatchIntent(request.data);
  if (!nonblank(intent.reason)) throw batchError("REASON_REQUIRED", "Enter a selection reason before confirmation");
  return db.runTransaction(async tx => {
    const read = snapshotReader(tx), actor = await readBatchActor({ db, request, lmPcode: intent.lmPcode, read });
    const snapshot = await read(db.doc(`geo_fences/${requireSalesBatchFenceId(intent)}`));
    const fence = snapshot.exists ? snapshot.data() : null; assertDedicatedFence(fence, intent, actor);
    const assessment = await readDraftAssessment({ db, request, intent, actor, codec, read, fence });
    if (assessment.wards.length !== 1) throw batchError("MIXED_OR_UNRESOLVED_WARDS", `Create requires one Ward. Wards: ${assessment.wards.join(", ") || "unresolved"}`);
    if (!assessment.includedIds.length) throw batchError("NO_READY_METERS", "No retained meter is ready for this saved geofence");
    const material = confirmationMaterial(intent, assessment, fence);
    const fingerprint = materialHash(material);
    const confirmationProof = codec.sign({ kind: "CONFIRMATION", ...proofScope({ db, actor, intent }), fingerprint, material });
    // No coordinates, raw Sales or signed geocode envelopes enter permanent documents.
    return { success: true, tbId: intent.tbId, fingerprint, confirmationProof, includedIds: assessment.includedIds, rows: assessment.rows.map(({ evidence: _evidence, ...row }) => row), leftOut: assessment.leftOut, scope: assessment.contexts.get(assessment.includedIds[0]).scope, materialIdentity: canonicalJson(material) };
  });
}
export const assessSalesTargetedBatchCallable = onCall({ secrets: [salesBatchProofKey], timeoutSeconds: 180, memory: "1GiB" }, async request => {
  try { return await assessSalesBatch({ db: getFirestore(), request, codec: createProofCodec(salesBatchProofKey.value()) }); } catch (error) { return callableFailure(error); }
});
