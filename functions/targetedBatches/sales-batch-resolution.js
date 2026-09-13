import crypto from "node:crypto";
import { defineSecret } from "firebase-functions/params";
import { onCall } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { SALES_BATCH_ID, SALES_ID, SALES_BATCH_MAX, GEOCODING_PROVIDER, LOOKUP_OUTCOMES, composeSalesGeocodingAddress, evaluateSalesBatchability, inspectSavedErfDecision, singlePipelineErf, salesStreetAddress, nonblank, validDocumentId, exactKeys, isTimestamp } from "../salesAllMeters/sales-batch-policy.js";
import { normalizeBatchGeometry, pointCoordinates, strictlyInside, strictlyWithinWard, MAX_GEOMETRY_BYTES } from "../geofences/sales-batch-geometry.js";
import { geocodeSalesAddress, googleGeocodingApiKey } from "./sales-batch-geocoding.js";
import { isSubcontractorServiceProvider } from "./helpers.js";

export const salesBatchProofKey = defineSecret("SALES_TARGETED_BATCH_PROOF_KEY");
export const MAX_ERF_CANDIDATES = 200;
export const PROOF_TTL_MS = 15 * 60 * 1000;
export function batchError(code, message) { const error = new Error(message); error.code = code; return error; }
export function canonicalJson(value) {
  const normalize = item => {
    if (item?.toMillis) return { seconds: item.seconds, nanoseconds: item.nanoseconds };
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") return Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, normalize(item[key])]));
    return item;
  };
  return JSON.stringify(normalize(value));
}
export const materialHash = value => crypto.createHash("sha256").update(canonicalJson(value)).digest("hex").toUpperCase();
export function createProofCodec(key, now = () => Date.now()) {
  if (typeof key !== "string" || key.length < 32) throw batchError("PROOF_CONFIGURATION_REQUIRED", "The Targeted Batch proof key must be configured");
  return {
    sign(data) {
      const encoded = Buffer.from(canonicalJson({ ...data, expiresAt: now() + PROOF_TTL_MS })).toString("base64url");
      return `${encoded}.${crypto.createHmac("sha256", key).update(encoded).digest("base64url")}`;
    },
    verify(token, expected = {}, { allowExpired = false } = {}) {
      if (typeof token !== "string" || token.length > 200000) throw batchError("INVALID_PROOF", "Resolution or confirmation evidence is missing");
      const parts = token.split(".");
      if (parts.length !== 2) throw batchError("INVALID_PROOF", "Invalid evidence");
      const signature = Buffer.from(parts[1], "base64url");
      const actual = crypto.createHmac("sha256", key).update(parts[0]).digest();
      if (signature.length !== actual.length || !crypto.timingSafeEqual(signature, actual)) throw batchError("INVALID_PROOF", "Evidence signature is invalid");
      let data;
      try { data = JSON.parse(Buffer.from(parts[0], "base64url").toString()); } catch { throw batchError("INVALID_PROOF", "Invalid evidence"); }
      if (!Number.isFinite(data.expiresAt) || (!allowExpired && data.expiresAt <= now())) throw batchError("PROOF_EXPIRED", "Resolution expired; reassessing the retained draft is required");
      for (const [name, value] of Object.entries(expected)) if (data[name] !== value) throw batchError("PROOF_SCOPE_MISMATCH", "Evidence belongs to another actor, scope or proposal");
      return data;
    },
  };
}
export function requireBatchIntent(data = {}) {
  if (!SALES_BATCH_ID.test(data.tbId || "") || !/^ZA[0-9]+$/.test(data.lmPcode || "") || !["PREPAID_SALES", "PREPAID_SALES_NON_GPS"].includes(data.source)) throw batchError("INVALID_BATCH_INTENT", "A valid batch ID, LM and Sales source are required");
  const ids = data.salesIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > SALES_BATCH_MAX || ids.some(id => typeof id !== "string" || !SALES_ID.test(id)) || new Set(ids).size !== ids.length) throw batchError("INVALID_SALES_POPULATION", "Supply 1–30 distinct canonical Sales IDs");
  if (data.reason !== undefined && (!nonblank(data.reason) || data.reason.length > 1000)) throw batchError("INVALID_REASON", "A selection reason of up to 1000 characters is required");
  for (const key of ["salesPeriodFrom", "salesPeriodTo"]) if (data[key] !== undefined && data[key] !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(data[key])) throw batchError("INVALID_SALES_PERIOD", "Sales periods must use YYYY-MM");
  return { ...data, salesIds: [...ids] };
}
export const snapshotReader = transaction => transaction ? target => transaction.get(target) : target => target.get();
export async function readBatchActor({ db, request, lmPcode, read = snapshotReader() }) {
  const uid = request?.auth?.uid;
  if (!validDocumentId(uid)) throw batchError("UNAUTHENTICATED", "Sign in to continue");
  const profileSnapshot = await read(db.doc(`users/${uid}`));
  if (!profileSnapshot.exists) throw batchError("PERMISSION_DENIED", "Your user profile is unavailable");
  const profile = profileSnapshot.data();
  const role = profile.employment?.role || profile.profile?.employment?.role || profile.role;
  if (!["MNG", "SPV"].includes(role)) throw batchError("PERMISSION_DENIED", "Only MNG and SPV(MNC) may plan Targeted Batches");
  const active = profile.access?.activeWorkbase;
  const workbaseId = value => typeof value === "string" ? value : value?.id || value?.pcode || value?.lmPcode;
  const assigned = Array.isArray(profile.access?.workbases) ? profile.access.workbases : [];
  if (workbaseId(active) !== lmPcode || !assigned.some(value => workbaseId(value) === lmPcode)) throw batchError("PERMISSION_DENIED", "The batch LM must be your active assigned workbase");
  if (role === "SPV") {
    const spId = profile.employment?.serviceProvider?.id || profile.profile?.employment?.serviceProvider?.id || profile.serviceProvider?.id;
    if (!validDocumentId(spId)) throw batchError("PERMISSION_DENIED", "Supervisor service provider is unavailable");
    const sp = await read(db.doc(`serviceProviders/${spId}`));
    if (!sp.exists || isSubcontractorServiceProvider(sp.data())) throw batchError("PERMISSION_DENIED", "Only a main service-provider supervisor may create a batch");
  }
  const user = profile.profile?.displayName || profile.displayName || profile.name || profile.profile?.personal?.fullName || request.auth.token?.name || request.auth.token?.email;
  if (!nonblank(user)) throw batchError("ACTOR_NAME_MISSING", "The authenticated actor has no display name");
  return { uid, user, role, profile };
}
export function salesMetadataUpdate(sales, actor, at) {
  const metadata = sales.metadata;
  if (!exactKeys(metadata, ["createdAt", "createdByUid", "createdByUser", "updatedAt", "updatedByUid", "updatedByUser"]) || !isTimestamp(metadata.createdAt) || !isTimestamp(metadata.updatedAt) || ![metadata.createdByUid, metadata.createdByUser, metadata.updatedByUid, metadata.updatedByUser].every(nonblank)) throw batchError("SALES_METADATA_INVALID", "Sales creation metadata is incomplete");
  return { "metadata.updatedAt": at, "metadata.updatedByUid": actor.uid, "metadata.updatedByUser": actor.user };
}
export function proofScope({ db, actor, intent }) {
  return { project: db.projectId, actorUid: actor.uid, tbId: intent.tbId, lmPcode: intent.lmPcode, source: intent.source };
}
export async function findContainingErf({ db, point, lmPcode, read = snapshotReader() }) {
  const [lng, lat] = pointCoordinates(point);
  const query = db.collection("ireps_erfs").where("admin.localMunicipality.pcode", "==", lmPcode)
    .where("bbox.minLat", "<=", lat).where("bbox.maxLat", ">=", lat)
    .where("bbox.minLng", "<=", lng).where("bbox.maxLng", ">=", lng).limit(MAX_ERF_CANDIDATES + 1);
  let snapshot;
  try { snapshot = await read(query); } catch { throw batchError("ERF_QUERY_INCOMPLETE", "ERF lookup is incomplete; check the required LM/bbox index and query access"); }
  if (snapshot.docs.length > MAX_ERF_CANDIDATES) throw batchError("ERF_QUERY_INCOMPLETE", "ERF candidate limit exceeded");
  const matches = []; let bytes = 0;
  for (const doc of snapshot.docs) {
    const erf = doc.data(); bytes += Buffer.byteLength(canonicalJson(erf.geometry));
    if (bytes > MAX_GEOMETRY_BYTES) throw batchError("ERF_QUERY_INCOMPLETE", "ERF geometry budget exceeded");
    try { if (strictlyInside(point, erf.geometry)) matches.push(doc); } catch { throw batchError("ERF_GEOMETRY_INVALID", "A candidate ERF geometry is invalid; lookup is incomplete"); }
  }
  return matches.length === 1 ? { ok: true, snapshot: matches[0] } : { ok: false, code: matches.length > 1 ? "MULTIPLE_ERFS" : "NO_ERF" };
}
export async function readErfContext({ db, erfId, lmPcode, read = snapshotReader() }) {
  if (!validDocumentId(erfId)) throw batchError("ERF_ID_INVALID", "The ERF identity is invalid");
  const snapshot = await read(db.doc(`ireps_erfs/${erfId}`));
  if (!snapshot.exists) throw batchError("ERF_MISSING", `ERF ${erfId} is unavailable`);
  const erf = snapshot.data();
  const wardPcode = erf.admin?.ward?.pcode;
  if ((erf.erfId && erf.erfId !== erfId) || erf.admin?.localMunicipality?.pcode !== lmPcode || !/^ZA[0-9]+$/.test(wardPcode || "")) throw batchError("ERF_SCOPE_INVALID", `ERF ${erfId} has invalid LM or Ward authority`);
  const wardSnapshot = await read(db.doc(`wards/${wardPcode}`));
  if (!wardSnapshot.exists) throw batchError("WARD_MISSING", `Ward ${wardPcode} is unavailable`);
  const ward = wardSnapshot.data();
  if (ward.parents?.localMunicipalityId !== lmPcode || (ward.pcode && ward.pcode !== wardPcode) || !nonblank(ward.name) || !/^\d+$/.test(String(ward.code || "")) || Number(ward.code) < 1) throw batchError("WARD_SCOPE_INVALID", "Ward identity or municipality is invalid");
  const wardNumber = String(Number(ward.code));
  const erfWardNumber = String(erf.admin.ward.name || "").replace(/^Ward\s*/i, "").trim();
  if (erfWardNumber && (!/^\d+$/.test(erfWardNumber) || Number(erfWardNumber) !== Number(wardNumber))) throw batchError("ERF_WARD_CONFLICT", "The ERF and Ward disagree");
  const centroid = pointCoordinates(erf.centroid);
  const geometry = normalizeBatchGeometry(erf.geometry), wardGeometry = normalizeBatchGeometry(ward.geometry);
  if (!nonblank(erf.admin.localMunicipality.name)) throw batchError("LM_NAME_MISSING", "The authoritative LM name is unavailable");
  return { erfId, erf, ward, geometry, wardGeometry, centroid: { latitude: centroid[1], longitude: centroid[0] }, scope: { lmPcode, lmName: erf.admin.localMunicipality.name, wardPcode, wardNumber, wardName: ward.name }, geometryHash: materialHash(geometry), wardHash: materialHash(wardGeometry) };
}
export async function recordFailedLookup({ db, request, intent, salesId, address, outcome, now = () => Timestamp.now() }) {
  if (!LOOKUP_OUTCOMES.includes(outcome)) throw batchError("INVALID_LOOKUP_OUTCOME", "Only an actual completed failed lookup may be recorded");
  await db.runTransaction(async tx => {
    const read = snapshotReader(tx);
    const actor = await readBatchActor({ db, request, lmPcode: intent.lmPcode, read });
    const ref = db.doc(`sales-all-meters/${salesId}`), snapshot = await read(ref);
    if (!snapshot.exists) throw batchError("SALES_MISSING", "Sales meter disappeared before recording the lookup");
    const sales = snapshot.data();
    if (!composeSalesGeocodingAddress(sales)) throw batchError("GEOCODING_CONFIGURATION_ERROR", "The Sales LM has no configured province for geocoding; no failed-lookup flag was written");
    if (composeSalesGeocodingAddress(sales) !== address) throw batchError("SALES_ADDRESS_CHANGED", "Sales address changed during lookup");
    const policy = evaluateSalesBatchability(sales, { salesId, lmPcode: intent.lmPcode, source: intent.source });
    if (!policy.batchable && policy.code !== "NEEDS_MANUAL_ERFING") throw batchError(policy.code, policy.reason);
    if (inspectSavedErfDecision(sales).established) throw batchError("ERF_ALREADY_ESTABLISHED", "The ERF decision was established during lookup");
    const at = now();
    tx.update(ref, { erfLookup: { version: 1, outcome, address, provider: GEOCODING_PROVIDER, attemptedAt: at, attemptedByUid: actor.uid, attemptedByUser: actor.user }, ...salesMetadataUpdate(sales, actor, at) });
  });
}
export async function resolveSalesBatch({ db, request, codec, geocode, now = () => Timestamp.now() }) {
  const intent = requireBatchIntent(request.data);
  const actor = await readBatchActor({ db, request, lmPcode: intent.lmPcode });
  const rows = [];
  // Bounded sequential provider calls avoid request bursts and keep no shared result cache.
  for (const salesId of intent.salesIds) {
    let sales = null, known = {};
    try {
      const snapshot = await db.doc(`sales-all-meters/${salesId}`).get();
      if (!snapshot.exists) throw batchError("SALES_MISSING", "Sales meter is unavailable");
      sales = snapshot.data();
      if (!composeSalesGeocodingAddress(sales)) throw batchError("GEOCODING_CONFIGURATION_ERROR", "The Sales LM has no configured province for geocoding; no failed-lookup flag was written");
      const policy = evaluateSalesBatchability(sales, { salesId, lmPcode: intent.lmPcode, source: intent.source });
      const saved = inspectSavedErfDecision(sales);
      const existingPipeline = intent.source === "PREPAID_SALES" ? singlePipelineErf(sales) : null;
      const existingErfId = saved.established ? saved.erfId : existingPipeline?.ok ? existingPipeline.erfId : null;
      if (existingErfId) {
        const context = await readErfContext({ db, erfId: existingErfId, lmPcode: intent.lmPcode });
        known = { erfId: existingErfId, point: saved.established ? saved.point : existingPipeline.point, scope: context.scope, centroid: context.centroid,
          pointSource: saved.established ? "GEOCODED" : "PIPELINE" };
      }
      if (!policy.batchable) throw batchError(policy.code, policy.reason);
      let erfId, point, evidence = null;
      if (saved.established) { erfId = saved.erfId; point = saved.point; }
      else if (intent.source === "PREPAID_SALES") {
        const pipeline = singlePipelineErf(sales); erfId = pipeline.erfId; point = pipeline.point;
      }
      else {
        const result = await geocode(sales);
        let found = result;
        if (result.ok) found = await findContainingErf({ db, point: result.point, lmPcode: intent.lmPcode });
        if (!found.ok) {
          if (LOOKUP_OUTCOMES.includes(found.code)) await recordFailedLookup({ db, request, intent, salesId, address: composeSalesGeocodingAddress(sales), outcome: found.code, now });
          throw batchError(found.code, LOOKUP_OUTCOMES.includes(found.code) ? `Needs manual ERFing — ${found.code}` : "Geocoding is unavailable; no failed-lookup flag was written");
        }
        erfId = found.snapshot.id; point = result.point;
        evidence = { point, address: composeSalesGeocodingAddress(sales), geocodedAt: now().toMillis(), provider: GEOCODING_PROVIDER };
      }
      const context = await readErfContext({ db, erfId, lmPcode: intent.lmPcode });
      if (!nonblank(salesStreetAddress(sales)) || !nonblank(sales.town)) throw batchError("ROW_ADDRESS_INCOMPLETE", "The draft address is incomplete");
      const proof = codec.sign({ kind: "RESOLUTION", ...proofScope({ db, actor, intent }), salesId, salesHash: materialHash(sales), erfId, geometryHash: context.geometryHash, wardHash: context.wardHash, point, evidence });
      rows.push({ salesId, meterNo: sales.meterNo, address: composeSalesGeocodingAddress(sales), ready: true, code: "RESOLVED", reason: "Coordinates and ERF resolved", erfId, point, pointSource: saved.established || evidence ? "GEOCODED" : "PIPELINE", scope: context.scope, centroid: context.centroid, expiresAt: codec.verify(proof).expiresAt, proof });
    } catch (error) {
      rows.push({ salesId, meterNo: sales?.meterNo || salesId, address: sales ? composeSalesGeocodingAddress(sales) : "", ready: false, code: error.code || "RESOLUTION_INCOMPLETE", reason: error.code ? error.message : "Resolution is incomplete", point: null, erfId: null, ...known, proof: null });
    }
  }
  return { success: true, tbId: intent.tbId, rows };
}
export async function readDraftAssessment({ db, intent, codec, actor, read = snapshotReader(), fence = null }) {
  const rows = [], contexts = new Map(), salesById = new Map(), material = [];
  for (const salesId of intent.salesIds) {
    const snapshot = await read(db.doc(`sales-all-meters/${salesId}`));
    const sales = snapshot.exists ? snapshot.data() : null;
    salesById.set(salesId, sales); material.push([salesId, sales ? materialHash(sales) : null]);
    let row = { salesId, meterNo: sales?.meterNo || salesId, address: sales ? composeSalesGeocodingAddress(sales) : "", ready: false, code: "SALES_MISSING", reason: "Sales meter is unavailable", erfId: null, point: null };
    if (sales) {
      const policy = evaluateSalesBatchability(sales, { salesId, lmPcode: intent.lmPcode, source: intent.source });
      row = { ...row, code: policy.code, reason: policy.reason };
      // Establish Ward even for an occupied/ineligible retained row. It cannot hide a second Ward.
      try {
        if (!composeSalesGeocodingAddress(sales)) throw batchError("GEOCODING_CONFIGURATION_ERROR", "The Sales LM has no configured province for geocoding; no failed-lookup flag was written");
        const saved = inspectSavedErfDecision(sales);
        const pipeline = intent.source === "PREPAID_SALES" ? singlePipelineErf(sales) : null;
        let evidence = null, erfId = saved.established ? saved.erfId : pipeline?.ok ? pipeline.erfId : null;
        let point = saved.established ? saved.point : pipeline?.point;
        const token = intent.resolutionProofs?.[salesId];
        let proof = null, proofError = null;
        if (token) {
          try {
            proof = codec.verify(token, { kind: "RESOLUTION", ...proofScope({ db, actor, intent }), salesId });
            if (proof.salesHash !== materialHash(sales)) throw batchError("SALES_CHANGED", "Sales data changed; resolution must be reassessed");
            if (erfId && proof.erfId !== erfId) throw batchError("ERF_CHANGED", "The confirmed ERF changed");
            erfId = proof.erfId; point = proof.point; evidence = proof.evidence;
          } catch (error) { proofError = error; }
        }
        if (!erfId) throw batchError(policy.batchable ? "RESOLUTION_REQUIRED" : policy.code, policy.batchable ? "Coordinates and ERF must be resolved" : policy.reason);
        const context = await readErfContext({ db, erfId, lmPcode: intent.lmPcode, read }); contexts.set(salesId, context);
        material.push([salesId, "ERF", materialHash(context.erf), "WARD", materialHash(context.ward)]);
        row = { ...row, erfId, point, scope: context.scope, centroid: context.centroid, evidence, expiresAt: proof?.expiresAt ?? null };
        if (proofError) throw proofError;
        if (!policy.batchable) throw batchError(policy.code, policy.reason);
        if (!proof && !saved.established && intent.source !== "PREPAID_SALES") throw batchError("RESOLUTION_REQUIRED", "Verified geocoding evidence is required");
        if (proof && (proof.geometryHash !== context.geometryHash || proof.wardHash !== context.wardHash)) throw batchError("SPATIAL_EVIDENCE_CHANGED", "ERF or Ward geometry changed; resolution must be reassessed");
        if (evidence) {
          const found = await findContainingErf({ db, point, lmPcode: intent.lmPcode, read });
          if (!found.ok || found.snapshot.id !== erfId) throw batchError("SPATIAL_EVIDENCE_CHANGED", "The confirmed point no longer falls in exactly its confirmed ERF");
        }
        if (!point || !nonblank(salesStreetAddress(sales)) || !nonblank(sales.town)) throw batchError("ROW_INCOMPLETE", "Meter number, address, coordinates and ERF are required");
        if (fence) {
          if (!fence.targetedBatch.salesIds.includes(salesId)) throw batchError("OUTSIDE_SAVED_POPULATION", "Not in the saved geofence population; start a new proposal to add this meter");
          if (context.scope.wardPcode !== fence.parents?.wardPcode || !strictlyWithinWard(fence.geometry, context.wardGeometry)) throw batchError("FENCE_WARD_INVALID", "The saved geofence is not strictly inside the authoritative Ward");
          if (!strictlyInside(context.centroid, fence.geometry)) throw batchError("CENTROID_OUTSIDE_GEOFENCE", "ERF centroid is outside or on the geofence boundary");
        }
        row = { ...row, ready: true, code: "READY", reason: "Ready for this batch" };
      } catch (error) { row = { ...row, ready: false, code: error.code || "RESOLUTION_INCOMPLETE", reason: error.code ? error.message : "Spatial evidence is incomplete" }; }
    }
    rows.push(row);
  }
  const wards = [...new Set(rows.map(row => row.scope?.wardPcode).filter(Boolean))];
  return { rows, contexts, salesById, wards, material, includedIds: rows.filter(row => row.ready).map(row => row.salesId), leftOut: rows.filter(row => !row.ready).map(row => ({ salesId: row.salesId, code: row.code, reason: row.reason })) };
}
export function callableFailure(error) { return { success: false, code: error.code || "TARGETED_BATCH_FAILED", message: error.code ? error.message : "Targeted Batch processing failed; retained draft is unchanged" }; }
export const resolveSalesTargetedBatchCallable = onCall({ secrets: [googleGeocodingApiKey, salesBatchProofKey], timeoutSeconds: 540, memory: "1GiB" }, async request => {
  try {
    const db = getFirestore(), codec = createProofCodec(salesBatchProofKey.value());
    return await resolveSalesBatch({ db, request, codec, geocode: sales => geocodeSalesAddress({ sales, apiKey: googleGeocodingApiKey.value() }) });
  } catch (error) { return callableFailure(error); }
});
