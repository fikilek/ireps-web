import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import {
  getUserRole, getUserDisplayName, getUserServiceProviderId,
  isMncServiceProvider, isSubcServiceProvider, resolveServiceProviderMnc,
  getServiceProviderLmClients,
} from "../teams/helpers.js";
import { fieldSubmitter, qaEligibility, qaState, qaText } from "./model.js";
import { lockEvidence } from "./evidence.js";
import { planQaNotices, writeQaNotices } from "./notifications.js";

// The catalog is returned by the server; clients do not define a second list.
export const QA_FAILURE_REASONS = Object.freeze([
  { code: "PHOTO_UNCLEAR", label: "Unclear photo" },
  { code: "PHOTO_MISSING", label: "Missing photo" },
  { code: "METER_NUMBER", label: "Wrong meter number" },
  { code: "METER_DETAILS", label: "Wrong meter details" },
  { code: "READING", label: "Wrong reading" },
  { code: "GPS", label: "Wrong GPS" },
  { code: "PREMISE", label: "Wrong premise or ERF" },
  { code: "ANOMALY", label: "Wrong anomaly" },
  { code: "ILLEGAL_CONNECTION_EVIDENCE", label: "Illegal connection evidence not clearly showing on photo(s)" },
  { code: "NO_ACCESS_EVIDENCE", label: "Insufficient No Access evidence" },
  { code: "OTHER", label: "Other" },
]);

export function canonical(value) {
  if (value === null || typeof value !== "object") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

export function sourceVersion(trn) {
  const { qa: _qa, ...record } = trn;
  const { updatedAt: _updatedAt, updatedByUid: _updatedByUid, updatedByUser: _updatedByUser, ...metadata } = record.metadata || {};
  return createHash("sha256").update(JSON.stringify(canonical({ ...record, metadata }))).digest("hex");
}

const upper = value => qaText(value).toUpperCase();
export const workbaseIds = user => (Array.isArray(user.access?.workbases) ? user.access.workbases : [])
  .flatMap(wb => typeof wb === "string" ? [wb] : [wb?.id, wb?.pcode, wb?.lmPcode, wb?.localMunicipalityId])
  .map(qaText).filter(Boolean);

export function reviewAccess({ actorUid, actor, providers, trn }, { checkReviewerConflict = true } = {}) {
  const refuse = reason => ({ allowed: false, reason });
  if (upper(actor.accountStatus) !== "ACTIVE") return refuse("Your account must be active to review transactions.");
  if (!["MNG", "SPV"].includes(upper(getUserRole(actor)))) return refuse("Only managers and main-contractor supervisors may perform QA.");
  const actorSpId = qaText(getUserServiceProviderId(actor));
  const provider = providers.find(item => item.id === actorSpId);
  if (!provider || upper(provider.status) !== "ACTIVE" || !isMncServiceProvider(provider) || isSubcServiceProvider(provider)) {
    return refuse("Only managers and supervisors at a main contractor may perform QA.");
  }
  const lm = qaText(trn.accessData?.parents?.lmPcode);
  if (!lm) return refuse("This transaction's workbase is unavailable and needs checking.");
  if (!workbaseIds(actor).includes(lm) || !getServiceProviderLmClients(provider).some(client => qaText(client.id) === lm)) {
    return refuse("This transaction is outside your authorised workbases.");
  }
  const workSpId = qaText(trn.serviceProvider?.id);
  if (!workSpId) return refuse("This transaction's service provider is unavailable and needs checking.");
  const mnc = resolveServiceProviderMnc(workSpId, providers);
  if (mnc?.id !== actorSpId) return refuse("This transaction belongs to another main contractor's work.");
  const submitter = fieldSubmitter(trn);
  if (!submitter.uid) return refuse("The original field submitter is unavailable and needs checking.");
  if (checkReviewerConflict && submitter.uid === actorUid) return refuse("Another authorised reviewer must QA your own submission.");
  if (checkReviewerConflict && (trn.qa?.amendedByUids || []).includes(actorUid)) return refuse("Another authorised reviewer must QA a transaction you amended.");
  const eligibility = qaEligibility(trn);
  if (!eligibility.eligible) return refuse(eligibility.label);
  return { allowed: true, reason: "" };
}

function assertReadable({ actorUid, actor, providers, trn }) {
  if (upper(actor.accountStatus) !== "ACTIVE") throw new HttpsError("permission-denied", "An active account is required.");
  const role = upper(getUserRole(actor));
  if (["SPU", "ADM"].includes(role)) return;
  if (fieldSubmitter(trn).uid === actorUid) return;
  // Review eligibility is narrower than read authority (including self-review).
  const spId = qaText(getUserServiceProviderId(actor));
  const workSpId = qaText(trn.serviceProvider?.id);
  const lm = qaText(trn.accessData?.parents?.lmPcode);
  if (!["MNG", "SPV"].includes(role) || !workbaseIds(actor).includes(lm)) {
    throw new HttpsError("permission-denied", "This transaction is outside your authorised work.");
  }
  const provider = providers.find(item => item.id === spId);
  const own = spId && workSpId === spId;
  const mncWork = provider && isMncServiceProvider(provider) && !isSubcServiceProvider(provider)
    && resolveServiceProviderMnc(workSpId, providers)?.id === spId;
  if (!own && !mncWork) throw new HttpsError("permission-denied", "This transaction is outside your authorised work.");
}

export function cleanId(value, label) {
  const text = qaText(value);
  if (!text || text.length > 180 || text.includes("/") || [".", ".."].includes(text)) {
    throw new HttpsError("invalid-argument", `${label} is invalid.`);
  }
  return text;
}

export async function readContext(reader, db, actorUid, trnId) {
  const [user, providersSnapshot, transaction] = await Promise.all([
    reader.get(db.doc(`users/${actorUid}`)),
    reader.get(db.collection("serviceProviders")),
    reader.get(db.doc(`trns/${trnId}`)),
  ]);
  if (!user.exists) throw new HttpsError("permission-denied", "Your user profile is unavailable.");
  if (!transaction.exists) throw new HttpsError("not-found", "This transaction no longer exists.");
  const context = { actorUid, actor: user.data(), providers: providersSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })), trn: transaction.data() };
  assertReadable(context);
  return context;
}

export async function getQaReview(db, actorUid, input, { bucket } = {}) {
  if (!actorUid) throw new HttpsError("unauthenticated", "Sign in to review a transaction.");
  const trnId = cleanId(input.trnId, "Transaction ID");
  const context = await readContext({ get: ref => ref.get() }, db, actorUid, trnId);
  const history = await db.doc(`trns/${trnId}`).collection("qaHistory").orderBy("reviewedAt", "desc").get();
  const amendments = await db.doc(`trns/${trnId}`).collection("qaAmendments").orderBy("at", "desc").get();
  const state = qaState(context.trn);
  const access = reviewAccess(context);
  const mayReview = access.allowed && ["DRAFT", "UPDATED"].includes(state);
  const digest = sourceVersion(context.trn);
  let version = null;
  if (input.version) {
    if (!/^[a-f0-9]{64}$/.test(input.version)) throw new HttpsError("invalid-argument", "Invalid version.");
    const saved = await db.doc(`trns/${trnId}/qaVersions/${input.version}`).get();
    if (!saved.exists) throw new HttpsError("not-found", "The preserved version was not found.");
    version = saved.data();
  } else if (mayReview) {
    if (!bucket) throw new HttpsError("unavailable", "Evidence protection is unavailable.");
    const versionRef = db.doc(`trns/${trnId}/qaVersions/${digest}`);
    const existing = await versionRef.get();
    if (existing.exists) version = existing.data();
    else {
      const evidence = await lockEvidence({ db, bucket, trnId, trn: context.trn, actorUid });
      version = await db.runTransaction(async tx => {
        const current = await readContext(tx, db, actorUid, trnId);
        const saved = await tx.get(versionRef);
        if (!reviewAccess(current).allowed || sourceVersion(current.trn) !== digest || qaState(current.trn) !== state || current.trn.qa?.reviewId !== context.trn.qa?.reviewId) {
          throw new HttpsError("aborted", "The record or your authority changed. Open the review again.");
        }
        if (saved.exists) return saved.data();
        const snapshot = { trnId, sourceVersion: digest, snapshot: current.trn, evidence,
          recordedAt: new Date().toISOString(), recordedByUid: actorUid,
          lmPcode: qaText(current.trn.accessData?.parents?.lmPcode) || null,
          wardPcode: qaText(current.trn.accessData?.parents?.wardPcode) || null };
        tx.create(versionRef, snapshot);
        return snapshot;
      });
    }
  } else if (context.trn.qa?.lastAmendment || context.trn.qa?.sourceVersion) {
    const saved = await db.doc(`trns/${trnId}/qaVersions/${context.trn.qa.lastAmendment?.afterVersion || context.trn.qa.sourceVersion}`).get();
    version = saved.exists ? saved.data() : null;
  }
  return {
    trnId, state, eligibility: qaEligibility(context.trn),
    qa: context.trn.qa || null, sourceVersion: sourceVersion(context.trn),
    previousReviewId: context.trn.qa?.reviewId || null,
    mayReview: mayReview && !input.version, reason: access.reason || (!mayReview ? "This version has already been reviewed." : ""),
    snapshot: version?.snapshot || context.trn, evidence: version?.evidence || [],
    displayedVersion: version?.sourceVersion || digest,
    submitter: fieldSubmitter(context.trn),
    reasons: QA_FAILURE_REASONS,
    history: history.docs.map(doc => ({ ...doc.data(), id: doc.id })),
    amendments: amendments.docs.map(doc => ({ ...doc.data(), id: doc.id })),
  };
}

export async function saveQaReview(db, actorUid, input) {
  if (!actorUid) throw new HttpsError("unauthenticated", "Sign in to review a transaction.");
  const trnId = cleanId(input.trnId, "Transaction ID");
  const requestId = cleanId(input.requestId, "Review request ID");
  const state = upper(input.state);
  if (!["PASS", "FAIL"].includes(state)) throw new HttpsError("invalid-argument", "Choose QA Pass or QA Fail.");
  const comment = typeof input.comment === "string" ? input.comment.trim() : "";
  if (comment.length > 4000) throw new HttpsError("invalid-argument", "Keep the QA comment within 4,000 characters.");
  const reason = state === "FAIL" ? QA_FAILURE_REASONS.find(item => item.code === input.reasonCode) : null;
  if (state === "FAIL" && (!reason || !comment)) throw new HttpsError("invalid-argument", "A QA failure requires a reason and a written explanation.");
  const trnRef = db.doc(`trns/${trnId}`);
  const historyRef = trnRef.collection("qaHistory").doc(requestId);
  return db.runTransaction(async tx => {
    const context = await readContext(tx, db, actorUid, trnId);
    const access = reviewAccess(context);
    if (!access.allowed) throw new HttpsError("permission-denied", access.reason);
    const previous = await tx.get(historyRef);
    if (previous.exists) {
      const saved = previous.data();
      if (saved.reviewedByUid !== actorUid || saved.state !== state || saved.comment !== comment
        || saved.reasonCode !== (reason?.code || null) || saved.sourceVersion !== input.sourceVersion
        || saved.previousReviewId !== (input.previousReviewId || null)) {
        throw new HttpsError("already-exists", "This review request was already used for a different decision.");
      }
      return { success: true, idempotent: true, qa: saved };
    }
    const trn = context.trn;
    const currentVersion = sourceVersion(trn);
    const previousState = qaState(trn);
    if (input.sourceVersion !== currentVersion || (input.previousReviewId || null) !== (trn.qa?.reviewId || null)) {
      throw new HttpsError("aborted", "This transaction changed while you were reviewing it. Close this window and review the current record.");
    }
    if (!["DRAFT", "UPDATED"].includes(previousState)) throw new HttpsError("failed-precondition", "This version has already been reviewed.");
    const versionRef = trnRef.collection("qaVersions").doc(currentVersion);
    const version = await tx.get(versionRef);
    if (!version.exists || version.data().sourceVersion !== currentVersion) throw new HttpsError("failed-precondition", "Open and inspect the protected review before saving a decision.");
    const now = new Date().toISOString();
    const qa = { state, reviewId: requestId, sourceVersion: currentVersion,
      reasonCode: reason?.code || null, reasonLabel: reason?.label || null, comment,
      reviewedAt: now, reviewedByUid: actorUid, reviewedByUser: getUserDisplayName(context.actor), ruleVersion: 1,
      ...(trn.qa?.lastAmendment ? { lastAmendment: trn.qa.lastAmendment, amendedByUids: trn.qa.amendedByUids || [] } : {}) };
    const location = { lmPcode: qaText(trn.accessData?.parents?.lmPcode) || null, wardPcode: qaText(trn.accessData?.parents?.wardPcode) || null };
    const notices = state === "FAIL" ? await planQaNotices(tx, db, { context, trn, trnId, eventId: requestId, kind: "RETURNED", at: now }) : [];
    tx.create(historyRef, { ...qa, action: `QA_${state}`, trnId, ...location, previousState, previousReviewId: trn.qa?.reviewId || null });
    tx.update(trnRef, { qa, "metadata.updatedAt": now, "metadata.updatedByUid": actorUid,
      "metadata.updatedByUser": qa.reviewedByUser });
    writeQaNotices(tx, db, notices);
    return { success: true, idempotent: false, qa };
  });
}
