// Targeted Batch rules 1.3.52, TB-R056: a batch row follows its Sales meter.
// A trigger on the Sales record runs when master.visibility changes to VISIBLE. One transaction re-reads everything,
// decides (rowFollowsSales.js) and writes. A repeat finds its own history, or a completed row, or a meter no longer in
// the batch, and writes nothing. Its own Sales write is VISIBLE -> VISIBLE, which the trigger ignores, so it cannot loop.
// Anything it cannot decide is logged with a clear code and nothing is written.
// A temporary Firestore failure is thrown, and the trigger is retried (retry: true) for up to a day: a repeat is safe.
// Some cases wait on the batch (allocated but not yet accepted, allocation still settling): when the batch's allocation or
// acceptance changes, a second trigger runs the rule again for the batch's VISIBLE meters whose rows are still open.
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { resolveSalesTargetedBatchMembership, nonblank } from "../salesAllMeters/sales-batch-policy.js";
import { becameVisible, decideRowFollowsSales, buildRowFollowsSalesWrites, runIdOf, rowStatus, DECISIONS, RULE } from "./rowFollowsSales.js";

const withId = snap => ({ ...snap.data(), id: snap.id, ...(snap.data().id !== undefined && snap.data().id !== snap.id ? { idConflict: true } : {}) });

// Everything that decides one meter, read through the transaction (reads only; every write comes after).
// namedScan: { tbId, ids } from scanSalesNamingBatch, read before the transaction (see applyRowFollowsSales).
export async function gatherRowFollowsSalesFacts({ db, get, salesId, namedScan = null }) {
  const salesSnap = await get(db.doc(`sales-all-meters/${salesId}`));
  const sales = salesSnap.exists ? salesSnap.data() : null;
  const facts = { salesId, sales };
  if (!sales || sales.master?.visibility !== "VISIBLE") return facts;
  const membership = resolveSalesTargetedBatchMembership(sales);
  if (membership.state !== "MEMBER") return facts;
  const tbId = membership.tbId;
  const parentSnap = await get(db.doc(`tb_uploads/${tbId}`));
  facts.parent = parentSnap.exists ? parentSnap.data() : null;
  if (!facts.parent) return facts;
  facts.rows = (await get(db.collection("tb_rows").where("tbId", "==", tbId))).docs.map(withId);
  const own = facts.rows.filter(r => r.salesAllMeterId === salesId);
  if (own.length !== 1 || (own[0].execution?.status || "NOT_STARTED") === "COMPLETED") return facts;
  const row = own[0];

  // Who found it: the AST meter_master links, its TRN, the worker's profile and team periods (TM-R001).
  const mmSnap = await get(db.doc(`meter_master/${salesId}`));
  facts.meterMaster = mmSnap.exists ? mmSnap.data() : null;
  const astId = facts.meterMaster?.refs?.asts?.id;
  if (nonblank(astId)) {
    const astSnap = await get(db.doc(`asts/${astId}`));
    facts.ast = astSnap.exists ? withId(astSnap) : null;
  }
  if (facts.ast) {
    const trnSnap = await get(db.doc(`trns/${nonblank(facts.ast.trnId) ? facts.ast.trnId : facts.ast.id}`));
    facts.trn = trnSnap.exists ? withId(trnSnap) : null;
    const uid = facts.ast.metadata?.createdByUid;
    if (nonblank(uid)) {
      const profileSnap = await get(db.doc(`users/${uid}`));
      facts.finderProfile = profileSnap.exists ? profileSnap.data() : null;
      facts.memberHistory = (await get(db.collection("team_member_history").where("userUid", "==", uid))).docs.map(withId);
    }
  }

  // The deterministic history a change would create: any existing one means it already happened (or something is wrong).
  const exists = async path => (await get(db.doc(path))).exists;
  const trnId = facts.trn?.id;
  facts.history = {
    rowClosed: await exists(`tb_uploads/${tbId}/history/ROW_CLOSED__${row.id}`),
    rowRemoved: await exists(`tb_uploads/${tbId}/history/ROW_REMOVED__${row.id}`),
    salesRemoved: await exists(`sales-all-meters/${salesId}/batchHistory/${tbId}__REMOVED_FROM_BATCH`),
    batchDeleted: nonblank(trnId) ? await exists(`tb_uploads/${tbId}/history/BATCH_DELETED__${runIdOf(trnId)}`) : false,
  };
  // The batch's last row: no other Sales record may still name the batch before it is deleted (as deleteCallable.js).
  // array-contains matches only a whole tbRef, so a tbRef with other keys (rowId, fieldWork) or another date is found by
  // a scan of the LM's Sales records before the transaction (as the clean-up tool's salesNamingBatches); its hits are
  // re-read here. Without that scan the batch is not deleted: the caller scans and runs again.
  const createdAt = facts.parent.metadata?.createdAt;
  facts.namedByOthers = null;
  if (facts.rows.length === 1 && createdAt) {
    if (namedScan?.tbId === tbId) {
      const col = db.collection("sales-all-meters");
      const hits = new Set();
      for (const query of [col.where("targetedBatchId", "==", tbId).limit(1001), col.where("tbRefs", "array-contains", { id: tbId, date: createdAt }).limit(1001), col.where("tbRefs", "array-contains", { tbId, date: createdAt }).limit(1001)]) {
        (await get(query)).docs.forEach(doc => { if (doc.id !== salesId) hits.add(doc.id); });
      }
      for (const id of namedScan.ids) {
        if (id === salesId || hits.has(id)) continue;
        const snap = await get(db.doc(`sales-all-meters/${id}`));
        if (snap.exists && salesNamesBatch(snap.data(), tbId)) hits.add(id);
      }
      facts.namedByOthers = [...hits].sort();
    } else if (nonblank(facts.parent.scope?.lmPcode)) facts.needsNamedScan = facts.parent.scope.lmPcode;
  }
  // Records that point at the row stay as they are; a removal lists them in its history.
  const ids = async collection => (await get(db.collection(collection).where("targetedBatchContext.rowId", "==", row.id))).docs.map(doc => doc.id).sort();
  facts.pointing = { trnIds: await ids("trns"), premiseIds: await ids("premises") };
  return facts;
}

// A Sales record names a batch by its targetedBatchId or by any tbRef, whatever the tbRef's other keys or date.
export const salesNamesBatch = (sales, tbId) => sales?.targetedBatchId === tbId || (Array.isArray(sales?.tbRefs) && sales.tbRefs.some(ref => ref && (ref.id === tbId || ref.tbId === tbId)));
// Every Sales record of the LM that names the batch (only the two fields are read).
export async function scanSalesNamingBatch({ db, lmPcode, tbId }) {
  const snap = await db.collection("sales-all-meters").where("lmPcode", "==", lmPcode).select("tbRefs", "targetedBatchId").get();
  return { tbId, ids: snap.docs.filter(doc => salesNamesBatch(doc.data(), tbId)).map(doc => doc.id).sort() };
}

// Firestore failures that pass: contention, a deadline, the service briefly unavailable or overloaded.
const TRANSIENT_CODES = new Set([10, 14, 4, 8, 13, "aborted", "unavailable", "deadline-exceeded", "resource-exhausted", "internal", "ABORTED", "UNAVAILABLE", "DEADLINE_EXCEEDED", "RESOURCE_EXHAUSTED", "INTERNAL"]);
export const isTransientError = error => TRANSIENT_CODES.has(error?.code);

// One transaction for one meter. Returns the decision (without the writes' data).
// rethrowTransient: a temporary Firestore failure is logged and thrown, so a trigger with retry: true runs again.
export async function applyRowFollowsSales({ db, salesId, log = logger, rethrowTransient = false }) {
  let result;
  let namedScan = null;
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      result = await db.runTransaction(async tx => {
        const facts = await gatherRowFollowsSalesFacts({ db, get: ref => tx.get(ref), salesId, namedScan });
        const plan = decideRowFollowsSales(facts);
        // The batch's last row: scan the LM's Sales records first, then decide again.
        if (plan.code === "DELETE_UNVERIFIABLE" && facts.needsNamedScan && !namedScan) return { ...plan, scanLm: facts.needsNamedScan };
        if (![DECISIONS.CLOSE, DECISIONS.REMOVE].includes(plan.decision)) return plan;
        // Built in full before the first write: if anything throws, nothing is written.
        const writes = buildRowFollowsSalesWrites(plan, facts, { ts: ms => Timestamp.fromMillis(ms), now: Timestamp.now(), serverTime: FieldValue.serverTimestamp() });
        for (const write of writes) {
          const ref = db.doc(write.path);
          if (write.op === "create") tx.create(ref, write.data);
          else if (write.op === "update") tx.update(ref, write.data);
          else if (write.op === "delete") tx.delete(ref);
          else throw new Error(`Unknown write ${write.op}`);
        }
        return { ...plan, writes: writes.map(w => `${w.op} ${w.path}`) };
      });
      if (!result.scanLm) break;
      namedScan = await scanSalesNamingBatch({ db, lmPcode: result.scanLm, tbId: result.tbId });
      const { scanLm: _scanned, ...unscanned } = result;
      result = unscanned;
    }
  } catch (error) {
    if (rethrowTransient && isTransientError(error)) {
      log.warn("TB-R056 a batch row follows its Sales meter: a temporary failure, tried again", { rule: RULE, code: "TB_R056_TEMPORARY_FAILURE", salesId, errorCode: error.code, detail: error.message });
      throw error;
    }
    result = { decision: DECISIONS.LOG, code: "UNEXPECTED_ERROR", salesId, detail: error.message };
  }
  const summary = { rule: RULE, code: `TB_R056_${result.code}`, decision: result.decision, salesId, tbId: result.tbId ?? null, rowId: result.rowId ?? null,
    trnId: result.trnId ?? null, finder: result.finder ? { uid: result.finder.uid, user: result.finder.user, teamId: result.finder.teamId, spId: result.finder.spId } : null,
    detail: result.detail ?? null, parentAfter: result.after ? (result.after.action === "DELETE" ? "DELETED" : result.after.status) : null, warnings: result.after?.warnings ?? [] };
  if (result.decision === DECISIONS.LOG) log.warn("TB-R056 a batch row follows its Sales meter: nothing changed, for the office", summary);
  else if (result.decision === DECISIONS.NONE) log.info("TB-R056 a batch row follows its Sales meter: nothing to do", summary);
  else log.info(`TB-R056 a batch row follows its Sales meter: row ${result.decision === DECISIONS.CLOSE ? "closed as Completed" : "taken out of the batch"}`, { ...summary, writes: result.writes });
  return result;
}

// A retried event older than this is dropped with an error log (the office then sees it), so it never retries for days.
export const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;
function tooOld(event, nowMs, log, what) {
  const at = Date.parse(event?.time ?? "");
  if (!Number.isFinite(at) || nowMs - at <= MAX_EVENT_AGE_MS) return false;
  log.error(`TB-R056 a batch row follows its Sales meter: ${what} kept failing for a day and was dropped, for the office`, { rule: RULE, code: "TB_R056_RETRY_EXPIRED", eventTime: event.time, params: event.params ?? null });
  return true;
}

// The Sales record changed. db: a getter, so an event that does nothing never touches Firestore.
export async function handleSalesVisibleEvent(event, { db = () => getFirestore(), log = logger, nowMs = Date.now() } = {}) {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!becameVisible(before, after)) return null;
  if (tooOld(event, nowMs, log, `meter ${event.params?.salesId}`)) return null;
  const result = await applyRowFollowsSales({ db: db(), salesId: event.params.salesId, log, rethrowTransient: true });
  return { decision: result.decision, code: result.code };
}

export const onSalesMeterVisibleBatchRow = onDocumentUpdated({ document: "sales-all-meters/{salesId}", retry: true }, event => handleSalesVisibleEvent(event));

// ---------------------------------------------------------------- when the batch settles
// A find by the batch's own team while the batch is allocated but not yet accepted, or while its allocation is still
// settling, is held (PARENT_NOT_ACCEPTED, ALLOCATION_STATE_UNCLEAR). When the batch's allocation or acceptance changes,
// the rule runs again for each of its VISIBLE meters whose row is still open, one meter per transaction. The rule's own
// writes to the batch never change its allocation or acceptance, so this cannot loop.
const allocationKey = parent => [parent?.allocation?.status ?? null, parent?.allocation?.targetType ?? null, parent?.allocation?.targetId ?? null, parent?.acceptance?.status ?? null].join("|");
export const batchStateChanged = (before, after) => Boolean(before && after) && allocationKey(before) !== allocationKey(after);

export async function reapplyRowFollowsSalesForBatch({ db, tbId, log = logger, rethrowTransient = false }) {
  const rows = (await db.collection("tb_rows").where("tbId", "==", tbId).get()).docs.map(doc => doc.data());
  const salesIds = [...new Set(rows.filter(row => rowStatus(row) !== "COMPLETED" && nonblank(row.salesAllMeterId)).map(row => row.salesAllMeterId))].sort();
  const results = [];
  // One meter after another: every transaction writes the same batch.
  for (const salesId of salesIds) {
    const sales = await db.doc(`sales-all-meters/${salesId}`).get();
    if (sales.data()?.master?.visibility !== "VISIBLE") continue;
    const result = await applyRowFollowsSales({ db, salesId, log, rethrowTransient });
    results.push({ salesId, decision: result.decision, code: result.code });
  }
  return results;
}

export async function handleBatchStateEvent(event, { db = () => getFirestore(), log = logger, nowMs = Date.now() } = {}) {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!batchStateChanged(before, after)) return null;
  if (tooOld(event, nowMs, log, `batch ${event.params?.tbId}`)) return null;
  return reapplyRowFollowsSalesForBatch({ db: db(), tbId: event.params.tbId, log, rethrowTransient: true });
}

export const onTargetedBatchStateRowFollowsSales = onDocumentUpdated({ document: "tb_uploads/{tbId}", retry: true }, event => handleBatchStateEvent(event));
