import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { batchStatsErfIds, summarizeBatchStats } from "./batch-stats.js";
import { chunks, inGroups } from "./sales-map-fence.js";

// Targeted Batch rules TB-R057 (1.3.55): Batch Stats is counted here, live, each time the page opens
// or Refresh is clicked, so the page receives only the totals. It only reads; nothing is stored.
const MANAGEMENT_ROLES = new Set(["SPU", "ADM", "MNG", "SPV"]);
const BATCH_FIELDS = ["scope.lmPcode", "status", "selection.planningMode", "source.type", "allocation"];
const ROW_FIELDS = ["tbId", "salesAllMeterId", "execution.status"];
const ERF_READ_CHUNK = 300;
const workbaseId = value => (typeof value === "string" ? value : value?.id || value?.pcode || value?.lmPcode || "");
const withIds = snapshot => snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));

export async function countBatchStats({ db, lmPcode }) {
  // The Sales meters are read whole: the batch checks read many of their fields.
  const [batchSnapshot, salesSnapshot, fenceSnapshot] = await Promise.all([
    db.collection("tb_uploads").where("scope.lmPcode", "==", lmPcode).select(...BATCH_FIELDS).get(),
    db.collection("sales-all-meters").where("lmPcode", "==", lmPcode).get(),
    db.collection("geo_fences").where("parents.lmPcode", "==", lmPcode).get(),
  ]);
  const batches = withIds(batchSnapshot), salesDocs = withIds(salesSnapshot), fences = withIds(fenceSnapshot);
  const rowSnapshots = await inGroups(chunks(batches.map(batch => batch.id)), ids => db.collection("tb_rows").where("tbId", "in", ids).select(...ROW_FIELDS).get());
  const rows = rowSnapshots.flatMap(withIds);
  // Only the ERFs of GPS meters that reached the geofence test are read.
  const erfsById = new Map();
  // A reserved Firestore id (__like_this__) cannot be read; such a meter falls to "its ERF cannot be found".
  const erfIds = batchStatsErfIds({ lmPcode, batches, salesDocs }).filter(id => !/^__.*__$/.test(id));
  for (const ids of chunks(erfIds, ERF_READ_CHUNK)) {
    for (const erf of await db.getAll(...ids.map(id => db.doc(`ireps_erfs/${id}`)))) if (erf.exists) erfsById.set(erf.id, erf.data());
  }
  return summarizeBatchStats({ lmPcode, batches, rows, salesDocs, fences, erfsById, generatedAt: new Date().toISOString() });
}

export async function getBatchStats({ db, request }) {
  const uid = request?.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const lmPcode = String(request.data?.lmPcode || "").trim();
  if (!/^ZA[0-9]+$/.test(lmPcode)) throw new HttpsError("invalid-argument", "A valid LM is required.");
  const profileSnapshot = await db.doc(`users/${uid}`).get();
  const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
  const role = profile?.employment?.role || profile?.profile?.employment?.role || profile?.role;
  if (!MANAGEMENT_ROLES.has(role)) throw new HttpsError("permission-denied", "Only management users can see Batch Stats.");
  const workbases = [profile?.access?.activeWorkbase, ...(Array.isArray(profile?.access?.workbases) ? profile.access.workbases : [])].map(workbaseId);
  if (!workbases.includes(lmPcode)) throw new HttpsError("permission-denied", "The LM must be one of your workbases.");
  try { return await countBatchStats({ db, lmPcode }); }
  catch (error) {
    logger.error("Batch Stats could not be counted", { lmPcode, uid, message: error?.message });
    throw new HttpsError("internal", "Batch Stats could not be counted because the records could not be read. Try again.");
  }
}

// One count per instance (each reads every Sales meter of the LM), and a ceiling, so counts cannot pile up on one machine.
export const getBatchStatsCallable = onCall({ timeoutSeconds: 300, memory: "1GiB", concurrency: 1, maxInstances: 5 }, async request => getBatchStats({ db: getFirestore(), request }));
