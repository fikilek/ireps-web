import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { inspectSavedErfDecision, resolveSalesTargetedBatchMembership } from "../salesAllMeters/sales-batch-policy.js";
import { buildTargetedBatchParentDoc, buildTargetedBatchRowDoc } from "./documentFactory.js";
import { buildTbRowId } from "./helpers.js";
import { batchError, canonicalJson, materialHash, requireBatchIntent, readBatchActor, snapshotReader, proofScope, readDraftAssessment, salesMetadataUpdate } from "./sales-batch-resolution.js";
import { salesBatchFenceId, assertDedicatedFence, confirmationMaterial } from "./sales-batch-geofence.js";
import { buildSalesBatchHistory } from "./sales-batch-history.js";

export const MAX_DOCUMENT_BYTES = 900_000;
export const MAX_MUTATION_BYTES = 8_000_000;
export function assertMutationSizes(documents) {
  let bytes = 0;
  for (const document of documents) {
    const size = Buffer.byteLength(canonicalJson(document));
    if (size > MAX_DOCUMENT_BYTES) throw batchError("DOCUMENT_TOO_LARGE", "A batch document or retained audit exceeds the supported size");
    bytes += size;
  }
  if (bytes > MAX_MUTATION_BYTES) throw batchError("TRANSACTION_TOO_LARGE", "The complete batch exceeds the supported transaction size");
}
export function creationPayload(intent, scope, count, geofenceId) {
  return { tbId: intent.tbId, expectedRows: count, geofenceId, creationGroupId: intent.tbId.replace(/^TGB_/, "TBCG_"), creationGroupBatchCount: 1, source: { type: intent.source, label: intent.source === "PREPAID_SALES" ? "GPS Sales" : "Non-GPS Sales", sourceId: null, fileName: null }, scope, selection: { reason: intent.reason, salesPeriodFrom: intent.salesPeriodFrom ?? null, salesPeriodTo: intent.salesPeriodTo ?? null, planningMode: intent.source === "PREPAID_SALES" ? "WARD_ERF" : "ERF_GEOFENCE" }, validation: { status: "PASSED", fileDecision: null, errors: [], warnings: [] } };
}
export async function createSalesBatch({ db, request, codec, now = () => Timestamp.now() }) {
  const intent = requireBatchIntent(request.data);
  const expected = { kind: "CONFIRMATION", project: db.projectId, actorUid: request.auth?.uid, tbId: intent.tbId, lmPcode: intent.lmPcode, source: intent.source };
  const confirmed = codec.verify(intent.confirmationProof, expected, { allowExpired: true });
  if (materialHash(confirmed.material) !== confirmed.fingerprint || intent.fingerprint !== confirmed.fingerprint || canonicalJson(intent.includedIds) !== canonicalJson(confirmed.material.includedIds) || canonicalJson(intent.salesIds) !== canonicalJson(confirmed.material.retainedIds) || intent.reason !== confirmed.material.reason || (intent.salesPeriodFrom ?? null) !== confirmed.material.salesPeriodFrom || (intent.salesPeriodTo ?? null) !== confirmed.material.salesPeriodTo) throw batchError("CONFIRMATION_INTENT_CHANGED", "The request differs from the exact confirmed meter list or intent");
  return db.runTransaction(async tx => {
    const read = snapshotReader(tx), actor = await readBatchActor({ db, request, lmPcode: intent.lmPcode, read });
    const parentRef = db.doc(`tb_uploads/${intent.tbId}`), parentSnapshot = await read(parentRef);
    const fenceRef = db.doc(`geo_fences/${salesBatchFenceId(intent.tbId)}`), fenceSnapshot = await read(fenceRef);
    const fence = fenceSnapshot.exists ? fenceSnapshot.data() : null;
    if (parentSnapshot.exists) {
      const parent = parentSnapshot.data();
      assertDedicatedFence(fence, intent, actor, { linked: true });
      if (parent.schemaVersion !== "0.3.0" || parent.creation?.state !== "READY" || parent.creation.fingerprint !== confirmed.fingerprint || parent.id !== intent.tbId || parent.geofenceId !== fence.id) throw batchError("BATCH_IDENTITY_CONFLICT", "The batch identity already has a different committed intent");
      return { success: true, code: "TARGETED_BATCH_CREATED", creationState: "READY", tbId: intent.tbId, rowCount: parent.counts.totalRows, reused: true };
    }
    assertDedicatedFence(fence, intent, actor);
    codec.verify(intent.confirmationProof, { ...expected, ...proofScope({ db, actor, intent }) });
    const assessment = await readDraftAssessment({ db, request, intent, actor, codec, read, fence });
    if (assessment.wards.length !== 1 || !assessment.includedIds.length || materialHash(confirmationMaterial(intent, assessment, fence)) !== confirmed.fingerprint) throw batchError("CONFIRMATION_STALE", "Sales, ERF, Ward, fence or eligibility changed after confirmation; no batch was created");
    const included = assessment.rows.filter(row => row.ready);
    const identities = [];
    for (const row of included) {
      const rowNo = fence.savedSalesIds.indexOf(row.salesId) + 1, rowId = buildTbRowId(intent.tbId, rowNo);
      const rowRef = db.doc(`tb_rows/${rowId}`), historyRef = db.doc(`sales-all-meters/${row.salesId}/batchHistory/${intent.tbId}__BATCHED`);
      const rowSnapshot = await read(rowRef), historySnapshot = await read(historyRef);
      if (rowSnapshot.exists || historySnapshot.exists) throw batchError("BATCH_ARTIFACT_CONFLICT", "A row or immutable history event already occupies this identity");
      identities.push({ row, rowNo, rowId, rowRef, historyRef });
    }
    const at = now(), payload = creationPayload(intent, assessment.contexts.get(included[0].salesId).scope, included.length, fence.id);
    const parent = buildTargetedBatchParentDoc({ payload, fingerprint: confirmed.fingerprint, creationDate: at, actorUid: actor.uid, actorName: actor.user });
    const writes = [];
    for (const { row, rowNo, rowId, rowRef, historyRef } of identities) {
      const sales = assessment.salesById.get(row.salesId), saved = inspectSavedErfDecision(sales), context = assessment.contexts.get(row.salesId);
      const membership = resolveSalesTargetedBatchMembership(sales);
      if (membership.state !== "NONE") throw batchError("SALES_ALREADY_BATCHED", `${row.meterNo} already belongs to a batch`);
      const erfNo = context.erf.sg?.parcelNo ? `${context.erf.sg.parcelNo}${Number(context.erf.sg.portion) > 0 ? `/${context.erf.sg.portion}` : ""}` : null;
      const rowDoc = buildTargetedBatchRowDoc({ payload, salesSource: sales, erfReference: { erfId: row.erfId, erfNo }, salesAllMeterId: row.salesId, rowNo, creationDate: at, actorUid: actor.uid, actorName: actor.user });
      const patch = { targetedBatchId: intent.tbId, tbRefs: [...(sales.tbRefs || []), { id: intent.tbId, date: at }], ...salesMetadataUpdate(sales, actor, at) };
      let revision = saved.established ? saved.resolution.revision : null;
      if (intent.source === "PREPAID_SALES_NON_GPS" && !saved.established) {
        if (!row.evidence) throw batchError("GEOCODE_EVIDENCE_MISSING", "Exact geocoding evidence is required for first ERF establishment");
        revision = 1;
        patch.erfId = row.erfId;
        patch.erfResolution = { version: 1, revision, method: "GEOCODED", evidenceRefs: [`ireps_erfs/${row.erfId}`], geocode: { latitude: row.evidence.point.latitude, longitude: row.evidence.point.longitude, matchLevel: "EXACT_STREET_NUMBER", geocodedAddress: row.evidence.address, provider: row.evidence.provider, geocodedAt: Timestamp.fromMillis(row.evidence.geocodedAt) }, confirmedByUid: actor.uid, confirmedByUser: actor.user, confirmedAt: at, tbId: intent.tbId };
      }
      if (intent.source === "PREPAID_SALES_NON_GPS" && Object.hasOwn(sales, "erfLookup")) patch.erfLookup = FieldValue.delete();
      const history = buildSalesBatchHistory({ type: "BATCHED", tbId: intent.tbId, rowId, salesId: row.salesId, geofenceId: fence.id, erfId: row.erfId, membershipSource: membership.source || "LEGACY_TBREFS", actor, at, revision });
      writes.push({ rowRef, rowDoc, historyRef, history, salesRef: db.doc(`sales-all-meters/${row.salesId}`), patch });
    }
    assertMutationSizes([parent, ...writes.flatMap(write => [write.rowDoc, write.history, { ...assessment.salesById.get(write.rowDoc.salesAllMeterId), ...write.patch }]), fence]);
    // All authoritative reads and checks complete before the first write. 3N+2 writes.
    tx.create(parentRef, parent);
    for (const write of writes) { tx.create(write.rowRef, write.rowDoc); tx.create(write.historyRef, write.history); tx.update(write.salesRef, write.patch); }
    tx.update(fenceRef, { linkState: "LINKED", "metadata.updatedAt": at, "metadata.updatedByUid": actor.uid, "metadata.updatedByUser": actor.user });
    return { success: true, code: "TARGETED_BATCH_CREATED", creationState: "READY", tbId: intent.tbId, rowCount: included.length, reused: false };
  });
}
