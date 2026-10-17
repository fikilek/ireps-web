import { canMove } from "../meterLifecycle/trnStateMachine.js";
import { createHash } from "node:crypto";
import { FieldPath, Filter } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { getUserRole, getUserDisplayName, getUserServiceProviderId, resolveServiceProviderMnc, getServiceProviderLmClients } from "../teams/helpers.js";
import { projectMeterDiscoveryAstMedia } from "../meterDiscovery/astMedia.js";
import { canonical, cleanId, readContext, reviewAccess, sourceVersion, workbaseIds } from "./review.js";
import { fieldSubmitter, qaEligibility, qaState, qaText, workflowState, qaAlias } from "./model.js";
import { evidenceObjects, lockEvidence } from "./evidence.js";
import { at, same, changes, buildAmendedRecord, checkAmendedForm } from "./amendmentPolicy.js";
import { planQaNotices, writeQaNotices } from "./notifications.js";

const digest = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const nowIso = () => new Date().toISOString();
const upper = value => qaText(value).toUpperCase();
export function amendmentAccess(context, submitterUser = null) {
  const { actor, actorUid, providers, trn } = context;
  const denied = reason => ({ allowed: false, takeover: false, reason });
  if (upper(actor.accountStatus) !== "ACTIVE") return denied("An active account is required.");
  if (!canMove(workflowState(trn), "amend").ok) return denied("Only COMPLETED or QA FAIL can be amended. QA Pass is final.");
  if (!qaEligibility(trn).eligible) return denied("Only a submitted result can be amended.");
  const lm = qaText(trn.accessData?.parents?.lmPcode);
  if (!workbaseIds(actor).includes(lm)) return denied("This submission is outside your authorised workbases.");
  const workMnc = resolveServiceProviderMnc(qaText(trn.serviceProvider?.id), providers)?.id;
  const actorSp = qaText(getUserServiceProviderId(actor));
  const actorMnc = resolveServiceProviderMnc(actorSp, providers)?.id;
  if (!workMnc || workMnc !== actorMnc) return denied("This submission is outside your contractor's work.");
  if (upper(providers.find(item => item.id === actorSp)?.status) !== "ACTIVE"
    || !getServiceProviderLmClients(providers.find(item => item.id === workMnc)).some(client => qaText(client.id) === lm)) return denied("Your provider does not hold this workbase.");
  if (fieldSubmitter(trn).uid === actorUid) return { allowed: true, takeover: false, reason: "" };
  if (qaState(trn) !== "FAIL" || upper(getUserRole(actor)) !== "SPV" || actorSp !== workMnc) return denied("Only the original submitter may amend this record.");
  if (!reviewAccess(context, { checkReviewerConflict: false }).allowed) return denied("You are not authorised to take over this failed submission.");
  if (!submitterUser) return denied("The original submitter's account needs checking before takeover.");
  const currentSp = qaText(getUserServiceProviderId(submitterUser));
  const currentMnc = resolveServiceProviderMnc(currentSp, providers)?.id;
  const left = upper(submitterUser.accountStatus) === "DISABLED" || (currentMnc && currentMnc !== workMnc);
  if (!left) return denied("Takeover requires the submitter to have left; their current account still belongs to this contractor.");
  return { allowed: true, takeover: true, reason: "Record why you are taking over and confirm that the original submitter has left." };
}

async function amendmentContext(reader, db, uid, trnId) {
  const context = await readContext(reader, db, uid, trnId);
  const submitterUid = fieldSubmitter(context.trn).uid;
  const submitter = submitterUid ? await reader.get(db.doc(`users/${submitterUid}`)) : null;
  return { ...context, access: amendmentAccess(context, submitter?.exists ? submitter.data() : null) };
}
function assertAllowed(context) {
  if (!context.access.allowed) throw new HttpsError("permission-denied", context.access.reason);
}
export function amendmentAstId(trn) {
  if (trn.accessData?.access?.hasAccess === "no") return "";
  return qaText(trn.ast?.astData?.astId) || (["METER_DISCOVERY", "METER_INSTALLATION"].includes(trn.accessData?.trnType) ? qaText(trn.id) : "");
}
const versionRecord = (trnId, snapshot, evidence, uid, now) => ({ trnId, snapshot, evidence,
  sourceVersion: sourceVersion(snapshot), recordedByUid: uid, recordedAt: now,
  lmPcode: qaText(snapshot.accessData?.parents?.lmPcode) || null, wardPcode: qaText(snapshot.accessData?.parents?.wardPcode) || null });

export async function getQaAmendment(db, uid, input, { bucket } = {}) {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to correct your work.");
  const trnId = cleanId(input.trnId, "Transaction ID");
  const context = await amendmentContext({ get: ref => ref.get() }, db, uid, trnId);
  assertAllowed(context);
  const beforeVersion = sourceVersion(context.trn);
  const ref = db.doc(`trns/${trnId}/qaVersions/${beforeVersion}`);
  let version = await ref.get();
  if (!version.exists) {
    if (!bucket) throw new HttpsError("unavailable", "Evidence protection is unavailable.");
    const evidence = await lockEvidence({ db, bucket, trnId, trn: context.trn, actorUid: uid });
    await db.runTransaction(async tx => {
      const fresh = await amendmentContext(tx, db, uid, trnId); assertAllowed(fresh);
      const existing = await tx.get(ref);
      if (sourceVersion(fresh.trn) !== beforeVersion || qaState(fresh.trn) !== qaState(context.trn)
        || fresh.trn.qa?.reviewId !== context.trn.qa?.reviewId) throw new HttpsError("aborted", "The submission changed. Open it again.");
      if (!existing.exists) tx.create(ref, versionRecord(trnId, fresh.trn, evidence, uid, nowIso()));
    });
    version = await ref.get();
  }
  const astId = amendmentAstId(context.trn);
  const meter = astId ? await db.doc(`asts/${cleanId(astId, "Meter ID")}`).get() : null;
  return { trnId, state: qaState(context.trn), workflowState: workflowState(context.trn), snapshot: context.trn, evidence: version.data().evidence,
    sourceVersion: beforeVersion, previousReviewId: context.trn.qa?.reviewId || null,
    meter: meter?.exists ? meter.data() : null, meterVersion: meter?.exists ? digest(meter.data()) : null,
    takeover: context.access.takeover, submitter: fieldSubmitter(context.trn) };
}

export async function listQaAmendments(db, uid, input = {}) {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to see returned work.");
  const [user, providerDocs] = await Promise.all([db.doc(`users/${uid}`).get(), db.collection("serviceProviders").get()]);
  if (!user.exists || upper(user.data().accountStatus) !== "ACTIVE") throw new HttpsError("permission-denied", "An active account is required.");
  const providers = providerDocs.docs.map(doc => ({ ...doc.data(), id: doc.id }));
  const takeover = input.takeover === true;
  let query = takeover ? db.collection("trns").where(Filter.or(Filter.where("workflow.state", "==", "QA FAIL"), Filter.where("qa.state", "==", "FAIL")))
    : db.collection("trns").where(Filter.or(Filter.where("workflow.completedByUid", "==", uid), Filter.where("metadata.createdOnDeviceByUid", "==", uid), Filter.where("metadata.createdByUid", "==", uid)));
  query = query.orderBy(FieldPath.documentId()).limit(100);
  if (input.cursor) query = query.startAfter(cleanId(input.cursor, "Page cursor"));
  const docs = await query.get();
  const result = [];
  for (const doc of docs.docs) {
    const trn = { ...doc.data(), id: doc.id };
    if (!takeover && fieldSubmitter(trn).uid !== uid) continue;
    let original = null;
    if (takeover && fieldSubmitter(trn).uid) { const found = await db.doc(`users/${fieldSubmitter(trn).uid}`).get(); original = found.exists ? found.data() : null; }
    const access = amendmentAccess({ actorUid: uid, actor: user.data(), providers, trn }, original);
    if (!access.allowed || access.takeover !== takeover) continue;
    result.push({ trnId: doc.id, state: qaState(trn), trnType: trn.accessData?.trnType, meterNo: trn.ast?.astData?.astNo || null,
      address: trn.accessData?.premise?.address || null, reason: trn.qa?.reasonLabel || null, comment: trn.qa?.comment || null,
      reviewedAt: canonical(trn.qa?.reviewedAt) || null,
      reviewedByUid: qaText(trn.qa?.reviewedByUid) || null,
      reviewedByUser: qaText(trn.qa?.reviewedByUser) || null,
      updatedAt: canonical(trn.metadata?.updatedAt) || null, submitter: fieldSubmitter(trn), takeover });
  }
  return { items: result, nextCursor: docs.size === 100 ? docs.docs.at(-1).id : null };
}

function checkedInput(input) {
  const explanation = qaText(input.explanation), takeoverReason = qaText(input.takeoverReason);
  if (explanation.length > 4000 || takeoverReason.length > 4000) throw new HttpsError("invalid-argument", "Correction or takeover text cannot exceed 4,000 characters.");
  return { trnId: cleanId(input.trnId, "Transaction ID"), requestId: cleanId(input.requestId, "Amendment request ID"),
    sourceVersion: input.sourceVersion || null, previousReviewId: input.previousReviewId || null,
    meterVersion: input.meterVersion || null, fields: input.fields, explanation, takeoverReason,
    retainNewerMeterFacts: input.retainNewerMeterFacts === true };
}
const eventTime = trn => {
  const value = canonical(trn.metadata?.createdOnDevice || trn.workflow?.completedAt || trn.metadata?.createdAt);
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
};
export async function saveQaAmendment(db, uid, raw, { bucket } = {}) {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to correct your work.");
  const input = checkedInput(raw), requestHash = digest(input);
  const { trnId, requestId } = input;
  const eventRef = db.doc(`trns/${trnId}/qaAmendments/${requestId}`);
  const context = await amendmentContext({ get: ref => ref.get() }, db, uid, trnId);
  const previous = await eventRef.get();
  if (previous.exists) {
    if (previous.data().byUid !== uid || previous.data().requestHash !== requestHash) throw new HttpsError("already-exists", "This request ID belongs to another amendment.");
    return { success: true, idempotent: true, amendment: { ...previous.data(), state: qaAlias(previous.data().state) || previous.data().state }, workflowState: workflowState(context.trn) };
  }
  assertAllowed(context);
  if (context.access.takeover && !input.takeoverReason) throw new HttpsError("invalid-argument", "Explain the takeover and confirm the submitter has left.");
  if (sourceVersion(context.trn) !== input.sourceVersion || (context.trn.qa?.reviewId || null) !== input.previousReviewId) throw new HttpsError("aborted", "The submission changed. Reload it before correcting it.");
  const { after } = buildAmendedRecord(context.trn, input.fields);
  const oldVersionRef = db.doc(`trns/${trnId}/qaVersions/${input.sourceVersion}`);
  const oldVersion = await oldVersionRef.get();
  if (!oldVersion.exists) throw new HttpsError("failed-precondition", "Open the saved form before amending it.");
  if (!bucket) throw new HttpsError("unavailable", "Evidence protection is unavailable.");
  const previousObjects = evidenceObjects(context.trn, bucket.name);
  for (const item of evidenceObjects(after, bucket.name)) {
    if (!previousObjects.some(old => old.path === item.path) && !item.path.startsWith(`qa-amendments/${uid}/${requestId}/`)) {
      throw new HttpsError("permission-denied", "New evidence must belong to your amendment upload.");
    }
  }
  const afterEvidence = await lockEvidence({ db, bucket, trnId, trn: after, actorUid: uid });
  if (afterEvidence.some(file => !file.available && !previousObjects.some(old => old.path === file.path))) throw new HttpsError("failed-precondition", "A new evidence upload is missing. Upload it before submitting.");
  return db.runTransaction(async tx => {
    const fresh = await amendmentContext(tx, db, uid, trnId);
    const existing = await tx.get(eventRef);
    if (existing.exists) {
      if (existing.data().byUid !== uid || existing.data().requestHash !== requestHash) throw new HttpsError("already-exists", "This request ID belongs to another amendment.");
      return { success: true, idempotent: true, amendment: { ...existing.data(), state: qaAlias(existing.data().state) || existing.data().state }, workflowState: workflowState(fresh.trn) };
    }
    assertAllowed(fresh);
    if (fresh.access.takeover && !input.takeoverReason) throw new HttpsError("invalid-argument", "Explain the takeover and confirm the submitter has left.");
    if (sourceVersion(fresh.trn) !== input.sourceVersion || (fresh.trn.qa?.reviewId || null) !== input.previousReviewId) throw new HttpsError("aborted", "The submission changed. Reload it before correcting it.");
    const { after: next, changed } = buildAmendedRecord(fresh.trn, input.fields);
    const astId = amendmentAstId(fresh.trn);
    const meterRef = astId ? db.doc(`asts/${cleanId(astId, "Meter ID")}`) : null;
    const meterSnap = meterRef ? await tx.get(meterRef) : null;
    const meter = meterSnap?.exists ? meterSnap.data() : null;
    if ((meter ? digest(meter) : null) !== input.meterVersion) throw new HttpsError("aborted", "The meter changed while this form was open. Reload it; your local amendment is retained.");
    const checked = checkAmendedForm(next, meter || {});
    let beforeCheck = null;
    try { beforeCheck = checkAmendedForm(fresh.trn, meter || {}); } catch { /* Invalid old facts are retained in history, not invented. */ }
    // Readings/details may be corrected, but the completed work's physical
    // outcome and meter-state transition cannot turn into a different event.
    const physicalOutcome = result => result && { outcome: result.executionOutcome?.outcome,
      success: result.executionOutcome?.success, commissioningPassed: result.commissioningPassed,
      nextAstState: result.nextAstState };
    if (beforeCheck && !same(physicalOutcome(beforeCheck), physicalOutcome(checked))) throw new HttpsError("failed-precondition", "An amendment cannot change the visit's physical outcome.");
    if (next.accessData.trnType === "METER_READING" && checked.executionOutcome) {
      // Derived reading totals belong to this visit and use its preserved
      // previous reading, never a more recent meter reading.
      const oldOutcome = fresh.trn.executionOutcome || {};
      const reading = Number(checked.executionOutcome.currentReading);
      const previous = oldOutcome.previousReading;
      next.executionOutcome = { ...oldOutcome, currentReading: checked.executionOutcome.currentReading,
        consumption: previous == null ? null : reading - Number(previous) };
      changed.push(...changes(fresh.trn.executionOutcome, next.executionOutcome, "executionOutcome"));
    }
    const projection = { appliedPaths: [], retainedPaths: [], laterEventIds: [] };
    const meterPatch = {};
    if (meterRef && meter) {
      const events = await tx.get(db.collection("trns").where("ast.astData.astId", "==", astId));
      const captured = eventTime(fresh.trn);
      projection.laterEventIds = events.docs.filter(doc => doc.id !== trnId && qaEligibility(doc.data()).eligible
        && (!captured || !eventTime(doc.data()) || eventTime(doc.data()) >= captured)).map(doc => doc.id);
      const oldPatch = beforeCheck?.astPatch || {};
      const nextPatch = checked.astPatch || {};
      // Expand whole-AST registration patches to leaf changes. Lifecycle validators
      // already return dotted paths; their caches remain one atomic value.
      const registration = ["METER_DISCOVERY", "METER_INSTALLATION"].includes(next.accessData.trnType);
      const candidates = registration
        ? changes(fresh.trn.ast || {}, next.ast || {}).map(path => [`ast.${path}`, at(fresh.trn.ast, path), at(next.ast, path)])
        : Object.entries(nextPatch).filter(([path, value]) => !same(oldPatch[path], value)).map(([path, value]) => [path, oldPatch[path], value]);
      // A lifecycle reading cache contains many visits. Amend only this visit's
      // existing entry, retaining its capture identity and original baseline.
      if (!registration) {
        for (const key of ["mreadings", "treadings"]) {
          const index = candidates.findIndex(([path]) => path === key);
          if (index < 0) continue;
          const valueKey = key === "mreadings" ? "reading" : "tokenReading";
          const oldEntry = oldPatch[key]?.find(row => row.trnId === trnId);
          const nextEntry = nextPatch[key]?.find(row => row.trnId === trnId);
          const savedEntry = meter[key]?.find(row => row.trnId === trnId);
          if (!oldEntry || !nextEntry || !savedEntry || !same(savedEntry[valueKey], oldEntry[valueKey])) {
            candidates.splice(index, 1);
            projection.retainedPaths.push(key);
          } else {
            const corrected = { ...savedEntry, [valueKey]: nextEntry[valueKey] };
            if (key === "mreadings" && "consumption" in savedEntry) corrected.consumption = savedEntry.previousReading == null ? null : Number(nextEntry.reading) - Number(savedEntry.previousReading);
            candidates[index] = [key, meter[key], meter[key].map(row => row.trnId === trnId ? corrected : row)];
          }
        }
      }
      if (registration) {
        for (const key of ["mreadings", "treadings"]) if (!same(fresh.trn[key], next[key])) candidates.push([key, fresh.trn[key], next[key]]);
        const oldMedia = projectMeterDiscoveryAstMedia(fresh.trn.media), nextMedia = projectMeterDiscoveryAstMedia(next.media);
        if (!same(oldMedia, nextMedia)) candidates.push(["media", oldMedia, nextMedia]);
      }
      for (const [path, oldValue, value] of candidates) {
        if ((!registration && !beforeCheck) || projection.laterEventIds.length || !same(at(meter, path), oldValue) || value === undefined) projection.retainedPaths.push(path);
        else { meterPatch[path] = value; projection.appliedPaths.push(path); }
      }
    } else if (meterRef && changed.some(path => path.startsWith("ast.") || path.startsWith("inspection."))) {
      projection.retainedPaths.push("meter record unavailable");
    }
    if (projection.retainedPaths.length && !input.retainNewerMeterFacts) throw new HttpsError("failed-precondition", "Newer or different meter facts must be retained. Confirm that this correction applies to the historical transaction only for those fields.", { kind: "RETAIN_METER_FACTS", ...projection });
    const now = nowIso(), byUser = getUserDisplayName(fresh.actor);
    const move = canMove(workflowState(fresh.trn), "amend");
    if (!move.ok) throw new HttpsError("failed-precondition", move.message);
    next.workflow = { ...fresh.trn.workflow, state: move.to, completedAt: now, completedByUid: uid, completedByUser: byUser };
    next.metadata = { ...fresh.trn.metadata, updatedAt: now, updatedByUid: uid, updatedByUser: byUser };
    const afterVersion = sourceVersion(next), newVersionRef = db.doc(`trns/${trnId}/qaVersions/${afterVersion}`);
    const newVersion = await tx.get(newVersionRef);
    const state = move.to;
    const amendment = { id: requestId, trnId, requestHash, beforeVersion: input.sourceVersion, afterVersion,
      lmPcode: qaText(next.accessData?.parents?.lmPcode) || null, wardPcode: qaText(next.accessData?.parents?.wardPcode) || null,
      previousState: workflowState(fresh.trn), state, previousReviewId: input.previousReviewId,
      byUid: uid, byUser, at: now, explanation: input.explanation, takeoverReason: fresh.access.takeover ? input.takeoverReason : null,
      changedPaths: changed, meterProjection: projection, retainedNewerMeterFacts: input.retainNewerMeterFacts };
    const lastAmendment = { id: requestId, beforeVersion: input.sourceVersion, afterVersion, byUid: uid, byUser, at: now };
    const { state: _legacyState, ...qaFacts } = fresh.trn.qa || {};
    next.qa = { ...qaFacts, lastAmendment,
      amendedByUids: [...new Set([...(fresh.trn.qa?.amendedByUids || []), uid])] };
    const notices = qaAlias(state) === "UPDATED" ? await planQaNotices(tx, db, { context: fresh, trn: next, trnId, eventId: requestId, kind: "UPDATED", at: now }) : [];
    if (!newVersion.exists) tx.create(newVersionRef, versionRecord(trnId, next, afterEvidence, uid, now));
    tx.create(eventRef, amendment);
    tx.set(db.doc(`trns/${trnId}`), next);
    if (Object.keys(meterPatch).length) tx.update(meterRef, { ...meterPatch, "metadata.updatedAt": now, "metadata.updatedByUid": uid, "metadata.updatedByUser": byUser });
    writeQaNotices(tx, db, notices);
    return { success: true, idempotent: false, amendment: { ...amendment, state: qaAlias(state) }, workflowState: state };
  });
}
