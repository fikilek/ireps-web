// Targeted Batch rules TB-R060 (1.3.62): a supervisor (SPV) or a manager (MNG) takes a meter out of a batch,
// with the same authority as Unallocate (TB-R048): the batch's Local Municipality must be their active
// workbase, they must belong to the main service provider and not a subcontractor, and the batch's own TEAM
// or SP must sit inside that main service provider. Without that, a supervisor of another service provider
// could free another provider's allocated work and hand it to their own team (TB-R059).
// The meter is then free: anybody may work on it and it may be batched again. One transaction per meter,
// each settled on its own, so one refused meter never stops the rest.
// The policy lives in takeOutOfBatch.js; this file reads the facts, applies the writes and reports plainly.
import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { SALES_BATCH_ID, SALES_BATCH_MAX, SALES_ID, validDocumentId } from "../salesAllMeters/sales-batch-policy.js";
import { batchError, callableFailure, readBatchActor, snapshotReader } from "./sales-batch-resolution.js";
import { actorMncId, assertTargetWithinMnc } from "./unallocateCallable.js";
import { batchAllocation, explicitlyUnallocated } from "./batch-work-guard.js";
import { ACTOR_ROLES, DECISIONS, RULE, buildTakeOutOfBatchWrites, decideTakeOutOfBatch, inspectReasonText, refusalMessage, runIdOf } from "./takeOutOfBatch.js";

const text = value => String(value ?? "").trim();
const withId = snap => ({ ...snap.data(), id: snap.id, ...(snap.data().id !== undefined && snap.data().id !== snap.id ? { idConflict: true } : {}) });

// A refusal of the whole request, in this rule's own plain words. `authority` marks the ones that are about
// the person rather than the meter: the per-meter loop lets those stop everything, because no meter of this
// batch is theirs to take out.
const refuse = (code, batch) => Object.assign(batchError(code, refusalMessage(code, { batch })), { authority: true });
// What Unallocate's authority throws, said in this action's words. A batch the person may not touch is
// answered exactly like a batch that is not there, so nobody learns which batches another LM holds.
const AUTHORITY_REFUSALS = Object.freeze({
  PERMISSION_DENIED: "PARENT_MISSING",
  ACTOR_NAME_MISSING: "ACTOR_INCOMPLETE",
  ACTOR_MNC_SERVICE_PROVIDER_MISSING: "ACTOR_NO_SERVICE_PROVIDER",
  UNALLOCATE_TARGET_NOT_FOUND: "TARGET_UNREADABLE",
  UNALLOCATE_TARGET_OUTSIDE_MNC: "TARGET_OUTSIDE_MNC",
});

// Who is calling, before one word about the batch is read or told: signed in, with a role the rule names.
export async function readTakeOutRole({ db, request }) {
  const uid = request?.auth?.uid;
  if (!validDocumentId(uid)) throw batchError("UNAUTHENTICATED", "Sign in to take a meter out of a batch.");
  const snapshot = await db.doc(`users/${uid}`).get();
  if (!snapshot.exists) throw batchError("PERMISSION_DENIED", "Your user profile is unavailable.");
  const profile = snapshot.data();
  const role = text(profile.employment?.role || profile.profile?.employment?.role || profile.role);
  if (!ACTOR_ROLES.includes(role)) throw refuse("ACTOR_ROLE");
  return role;
}

// The rest of the authority, against the batch as it has just been read: Unallocate's own test (TB-R048),
// and then the batch's own TEAM or SP inside the actor's main service provider. `read` lets this run inside
// the per-meter transaction as well as before it.
export async function readTakeOutAuthority({ db, request, parent, tbId, read = snapshotReader() }) {
  try {
    const actor = await readBatchActor({ db, request, lmPcode: parent?.scope?.lmPcode, read });
    const allocation = batchAllocation(parent || {});
    // A batch nobody has been given the work of names no TEAM or SP, so there is nothing more to test.
    if (!explicitlyUnallocated(allocation)) {
      if (!["TEAM", "SP"].includes(allocation.type) || !validDocumentId(allocation.id)) throw batchError("UNALLOCATE_TARGET_NOT_FOUND", "The batch names no readable TEAM or SP");
      await assertTargetWithinMnc({ db, read, targetType: allocation.type, targetId: allocation.id, mncId: actorMncId(actor.profile) });
    }
    return { uid: actor.uid, user: actor.user, role: actor.role };
  } catch (error) {
    const code = AUTHORITY_REFUSALS[text(error?.code)];
    if (code) throw refuse(code, tbId);
    throw error;
  }
}

// Everything that decides one meter, read through the transaction (reads only; every write comes after).
export async function gatherTakeOutFacts({ db, get, tbId, salesId }) {
  const salesSnapshot = await get(db.doc(`sales-all-meters/${salesId}`));
  const facts = { tbId, salesId, sales: salesSnapshot.exists ? salesSnapshot.data() : null };
  if (!facts.sales) return facts;
  const parentSnapshot = await get(db.doc(`tb_uploads/${tbId}`));
  facts.parent = parentSnapshot.exists ? parentSnapshot.data() : null;
  if (!facts.parent) return facts;
  facts.rows = (await get(db.collection("tb_rows").where("tbId", "==", tbId))).docs.map(withId);
  const own = facts.rows.filter(row => row.salesAllMeterId === salesId);
  if (own.length !== 1) return facts;
  const row = own[0];
  facts.row = row;
  // The deterministic history this change would create: an existing one means it already happened.
  const exists = async path => (await get(db.doc(path))).exists;
  facts.history = {
    rowRemoved: await exists(`tb_uploads/${tbId}/history/ROW_REMOVED__${row.id}`),
    salesRemoved: await exists(`sales-all-meters/${salesId}/batchHistory/${tbId}__REMOVED_FROM_BATCH`),
  };
  // Records that point at the row stay as they are; the removal history lists them (TB-R053).
  const ids = async collection => (await get(db.collection(collection).where("targetedBatchContext.rowId", "==", row.id))).docs.map(doc => doc.id).sort();
  facts.pointing = { trnIds: await ids("trns"), premiseIds: await ids("premises") };
  return facts;
}

// One meter, one transaction: it re-reads everything, decides and writes. Returns the decision.
// The batch is read again in here, and the authority is taken from that reading (1.3.62): the LM and the
// TEAM or SP as they stand at the moment of writing, not as they stood when the request came in.
export async function takeOneMeterOutOfBatch({ db, request, tbId, salesId, actor, reasonText }) {
  return db.runTransaction(async tx => {
    const facts = await gatherTakeOutFacts({ db, get: ref => tx.get(ref), tbId, salesId });
    // Every read comes before the first write. A batch that has gone in the meantime is refused by the
    // policy below, with the outer actor only so it can say so.
    const authorised = facts.parent
      ? await readTakeOutAuthority({ db, request, parent: facts.parent, tbId, read: snapshotReader(tx) })
      : actor;
    const plan = decideTakeOutOfBatch({ ...facts, actor: authorised, reasonText });
    if (plan.decision !== DECISIONS.REMOVE) return plan;
    // Built in full before the first write: if anything throws, nothing is written.
    const writes = buildTakeOutOfBatchWrites(plan, facts, { ts: ms => Timestamp.fromMillis(ms), now: Timestamp.now(), serverTime: FieldValue.serverTimestamp() });
    for (const write of writes) {
      const ref = db.doc(write.path);
      if (write.op === "create") tx.create(ref, write.data);
      else if (write.op === "update") tx.update(ref, write.data);
      else if (write.op === "delete") tx.delete(ref);
      else throw new Error(`Unknown write ${write.op}`);
    }
    return { ...plan, writes: writes.map(write => `${write.op} ${write.path}`) };
  });
}

export async function takeOutOfBatch({ db, request, log = logger }) {
  const data = request?.data || {};
  // Signed in before anything is read, so nothing is learned about a batch by calling this.
  if (!validDocumentId(request?.auth?.uid)) throw batchError("UNAUTHENTICATED", "Sign in to take a meter out of a batch.");
  const tbId = text(data.tbId);
  if (!SALES_BATCH_ID.test(tbId)) throw batchError("INVALID_BATCH_INTENT", "A valid batch ID is required.");
  const meterNos = [...new Set((Array.isArray(data.meterNos) ? data.meterNos : []).map(text).filter(Boolean))];
  if (!meterNos.length || meterNos.length > SALES_BATCH_MAX || meterNos.some(meterNo => !SALES_ID.test(meterNo))) throw batchError("INVALID_METERS", `Choose 1 to ${SALES_BATCH_MAX} meters of the batch.`);
  const reason = inspectReasonText(data.reasonText);
  if (!reason.ok) throw batchError(reason.code, refusalMessage(reason.code));
  // Who is calling is settled before the batch is read, so a caller who may not do this never learns
  // whether the batch exists (1.3.62).
  await readTakeOutRole({ db, request });
  const parentSnapshot = await db.doc(`tb_uploads/${tbId}`).get();
  if (!parentSnapshot.exists) throw refuse("PARENT_MISSING", tbId);
  const actor = await readTakeOutAuthority({ db, request, parent: parentSnapshot.data(), tbId });

  const takenOut = [], refused = [];
  for (const meterNo of meterNos) {
    let result;
    try {
      result = await takeOneMeterOutOfBatch({ db, request, tbId, salesId: meterNo, actor, reasonText: reason.reasonText });
    } catch (error) {
      // Authority is about the person, not the meter: if the batch moved out of their reach while this ran,
      // no meter of it is theirs and the whole request says so in the same words.
      if (error?.authority) throw error;
      // One meter failing leaves the others alone; its own transaction wrote nothing.
      const code = text(error.code) || "TAKE_OUT_FAILED";
      log.error("TB-R060 taking a meter out of a batch failed", { rule: RULE, tbId, meterNo, code, detail: error.message });
      refused.push({ meterNo, code, message: `Meter ${meterNo} could not be taken out of batch ${tbId}. Nothing was changed for it. Please try again.` });
      continue;
    }
    if (result.decision === DECISIONS.REMOVE) {
      takenOut.push({ meterNo, rowId: result.rowId, rowNo: result.rowNo, batchStatusAfter: result.after.branch === "UNCHANGED" ? null : result.after.status });
      log.info("TB-R060 a meter was taken out of a batch", { rule: RULE, tbId, meterNo, rowId: result.rowId, runId: runIdOf(result.rowId), actorUid: actor.uid, role: actor.role, writes: result.writes });
    } else {
      refused.push({ meterNo, code: result.code, message: result.message });
      log.warn("TB-R060 a meter was not taken out of a batch", { rule: RULE, tbId, meterNo, code: result.code, detail: result.detail ?? null, actorUid: actor.uid });
    }
  }
  return { success: true, code: "METERS_TAKEN_OUT_OF_BATCH", tbId, requested: meterNos.length, takenOut, refused };
}

export const onTakeMeterOutOfBatchCallable = onCall({ timeoutSeconds: 300, memory: "512MiB" }, async request => {
  try { return await takeOutOfBatch({ db: getFirestore(), request }); } catch (error) { return callableFailure(error); }
});
