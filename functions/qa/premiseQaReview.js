import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import {
  getUserRole,
  getUserDisplayName,
  getUserServiceProviderId,
  isMncServiceProvider,
  isSubcServiceProvider,
  resolveServiceProviderMnc,
  getServiceProviderLmClients,
} from "../teams/helpers.js";
import { qaText } from "./model.js";
import { rebuildPremiseRegistryRow } from "../registry/premiseRegistryRowRebuild.js";

// Canonical Premise QA Failure Reasons catalog
export const PREMISE_QA_FAILURE_REASONS = Object.freeze([
  { code: "ADDRESS_INCORRECT", label: "Address Incorrect (wrong street number, name or type)" },
  { code: "ERF_MISMATCH", label: "ERF Mismatch (premise located on different ERF)" },
  { code: "PROPERTY_TYPE_INCORRECT", label: "Property Type Incorrect (wrong category, building name or unit)" },
  { code: "PHOTO_UNCLEAR", label: "Photo Unclear (premise/address photo blurred or dark)" },
  { code: "PHOTO_MISSING", label: "Photo Missing (required facade or street number photo missing)" },
  { code: "COORDINATES_INACCURATE", label: "Coordinates Inaccurate (GPS location does not match property position)" },
  { code: "OTHER", label: "Other (requires explanation)" },
]);

export function canonical(value) {
  if (value === null || typeof value !== "object") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

// Compute SHA-256 digest of substantive premise fields.
// Operational/system maintenance fields (services, meter counts, updatedAt, qa) do not alter this digest.
export function computePremiseDigest(premise = {}) {
  const substantive = {
    erfId: qaText(premise?.erfId),
    erfNo: qaText(premise?.erfNo),
    address: premise?.address || {},
    propertyType: premise?.propertyType || {},
    occupancy: premise?.occupancy || {},
    geometry: premise?.geometry || {},
    media: Array.isArray(premise?.media) ? premise.media : [],
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(substantive)))
    .digest("hex");
}

export function cleanId(value, label) {
  const text = qaText(value);
  if (!text || text.length > 180 || text.includes("/") || [".", ".."].includes(text)) {
    throw new HttpsError("invalid-argument", `${label} is invalid.`);
  }
  return text;
}

const upper = (value) => qaText(value).toUpperCase();

export const workbaseIds = (user) =>
  (Array.isArray(user?.access?.workbases) ? user.access.workbases : [])
    .flatMap((wb) =>
      typeof wb === "string"
        ? [wb]
        : [wb?.id, wb?.pcode, wb?.lmPcode, wb?.localMunicipalityId],
    )
    .map(qaText)
    .filter(Boolean);

// Review access verification for Premise QA
export function premiseReviewAccess({ actorUid, actor, providers, premise }, { checkReviewerConflict = true } = {}) {
  const refuse = (reason) => ({ allowed: false, reason });

  if (upper(actor?.accountStatus) !== "ACTIVE") {
    return refuse("Your account must be active to review premises.");
  }

  const role = upper(getUserRole(actor));
  if (!["MNG", "SPV", "SPU", "ADM"].includes(role)) {
    return refuse("Only managers and main-contractor supervisors may perform QA.");
  }

  // SPU and ADM have global platform authority
  if (["SPU", "ADM"].includes(role)) {
    // Check no-self-review even for admin if they submitted it
    const creatorUid = qaText(premise?.metadata?.createdByUid);
    const lastSubmitterUid = qaText(premise?.qa?.lastSubmittedByUid);
    if (checkReviewerConflict && (actorUid === creatorUid || (lastSubmitterUid && actorUid === lastSubmitterUid))) {
      return refuse("Another authorised reviewer must QA your own submission.");
    }
    return { allowed: true, reason: "" };
  }

  const actorSpId = qaText(getUserServiceProviderId(actor));
  const provider = providers.find((item) => item.id === actorSpId);
  if (
    !provider ||
    upper(provider.status) !== "ACTIVE" ||
    !isMncServiceProvider(provider) ||
    isSubcServiceProvider(provider)
  ) {
    return refuse("Only managers and supervisors at a main contractor may perform QA.");
  }

  const lm = qaText(premise?.parents?.lmPcode);
  if (!lm) {
    return refuse("This premise's workbase is unavailable and needs checking.");
  }

  const userWbs = workbaseIds(actor);
  const providerClients = getServiceProviderLmClients(provider).map((c) => qaText(c.id));
  if (!userWbs.includes(lm) || !providerClients.includes(lm)) {
    return refuse("This premise is outside your authorised workbases.");
  }

  // No-Self-Review: reviewer must NOT be the creator or last submitter
  const creatorUid = qaText(premise?.metadata?.createdByUid);
  const lastSubmitterUid = qaText(premise?.qa?.lastSubmittedByUid);
  if (checkReviewerConflict && (actorUid === creatorUid || (lastSubmitterUid && actorUid === lastSubmitterUid))) {
    return refuse("Another authorised reviewer must QA your own submission.");
  }

  return { allowed: true, reason: "" };
}

// Project Premise QA result onto linked Targeted Batch row with rigorous bidirectional validation
export async function readPremiseQaTbRow(tx, db, premiseId, premise) {
  const tbContext = premise?.targetedBatchContext;
  if (!tbContext || !tbContext.tbId || !tbContext.rowId) {
    return { canProject: false, reason: "NO_TB_CONTEXT" };
  }

  const rowRef = db.collection("tb_rows").doc(tbContext.rowId);
  const rowSnap = await tx.get(rowRef);

  if (!rowSnap.exists) {
    return { canProject: false, reason: "ROW_NOT_FOUND" };
  }

  const row = rowSnap.data() || {};

  // Safeguard: Verify row's refs.premiseId matches this premiseId and tbId matches
  if (row.refs?.premiseId !== premiseId) {
    return { canProject: false, reason: "ROW_PREMISE_ID_MISMATCH" };
  }
  if (row.tbId !== tbContext.tbId) {
    return { canProject: false, reason: "ROW_TB_ID_MISMATCH" };
  }

  return { canProject: true, rowRef, rowId: tbContext.rowId, row };
}

export function calculateTbQaStatus(premiseStatus, meterStatus, executionStatus = null) {
  const norm = (s) => String(s || "").trim().toUpperCase().replace(/ /g, "_");
  if (norm(executionStatus) !== "COMPLETED") return "QA_NAv";
  const p = norm(premiseStatus);
  const m = norm(meterStatus);

  if (p === "QA_FAIL" || m === "QA_FAIL") {
    return "QA_FAIL";
  }
  if (p === "QA_PASS" && m === "QA_PASS") {
    return "QA_PASS";
  }
  if (
    (p === "QA_PENDING" && m === "QA_PENDING") ||
    (p === "QA_PASS" && m === "QA_PENDING") ||
    (p === "QA_PENDING" && m === "QA_PASS")
  ) {
    return "QA_PENDING";
  }
  return "QA_NAv";
}

export function applyPremiseQaTbRowProjection(tx, tbRowPlan, qaState, reviewerDetails = {}) {
  if (!tbRowPlan?.canProject || !tbRowPlan?.rowRef) {
    return { projected: false, reason: tbRowPlan?.reason || "CANNOT_PROJECT" };
  }

  const nowIso = new Date().toISOString();
  const calculatedTbStatus = calculateTbQaStatus(qaState, tbRowPlan.row?.qa?.meterStatus, tbRowPlan.row?.execution?.status);

  const updateData = {
    "qa.premiseStatus": qaState,
    "qa.premiseReviewedAt": reviewerDetails.reviewedAt || null,
    "qa.premiseReviewedByUser": reviewerDetails.reviewedByUser || null,
    "qa.premiseReasonCode": reviewerDetails.reasonCode || null,
    "qa.premiseReasonLabel": reviewerDetails.reasonLabel || null,
    "qa.tbStatus": calculatedTbStatus,
    "metadata.updatedAt": nowIso,
    "metadata.updatedByUid": reviewerDetails.reviewedByUid || "SYSTEM",
    "metadata.updatedByUser": reviewerDetails.reviewedByUser || "SYSTEM",
  };

  tx.update(tbRowPlan.rowRef, updateData);
  return { projected: true, rowId: tbRowPlan.rowId, tbStatus: calculatedTbStatus };
}

export async function projectPremiseQaToTbRow(tx, db, premiseId, premise, qaState, reviewerDetails = {}) {
  const plan = await readPremiseQaTbRow(tx, db, premiseId, premise);
  return applyPremiseQaTbRowProjection(tx, plan, qaState, reviewerDetails);
}

// Fetch Premise QA review context
export async function getPremiseQaReview(db, actorUid, input = {}) {
  if (!actorUid) {
    throw new HttpsError("unauthenticated", "Sign in to review a premise.");
  }

  const premiseId = cleanId(input.premiseId, "Premise ID");
  const [userSnap, providersSnap, premiseSnap] = await Promise.all([
    db.doc(`users/${actorUid}`).get(),
    db.collection("serviceProviders").get(),
    db.doc(`premises/${premiseId}`).get(),
  ]);

  if (!userSnap.exists) {
    throw new HttpsError("permission-denied", "Your user profile is unavailable.");
  }
  if (!premiseSnap.exists) {
    throw new HttpsError("not-found", "This premise does not exist.");
  }

  const actor = userSnap.data();
  const providers = providersSnap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  const premise = premiseSnap.data();

  const access = premiseReviewAccess({ actorUid, actor, providers, premise });
  const currentDigest = computePremiseDigest(premise);

  const historySnap = await db
    .collection(`premises/${premiseId}/qaHistory`)
    .orderBy("timestamp", "desc")
    .get();

  const history = historySnap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));

  return {
    premiseId,
    state: premise.qa?.status || "QA_NAv",
    qa: premise.qa || null,
    media: Array.isArray(premise.media) ? premise.media : [],
    premise: {
      address: premise.address || null,
      addressText: premise.addressText || premise.address?.formatted || null,
      propertyType: premise.propertyType || null,
      occupancy: premise.occupancy || null,
      targetedBatchContext: premise.targetedBatchContext || null,
      services: premise.services || null,
      metadata: premise.metadata || null,
      erfNo: premise.erfNo || null,
      erfId: premise.erfId || null,
    },
    sourceVersion: currentDigest,
    mayReview: access.allowed,
    reason: access.reason || "",
    reasons: PREMISE_QA_FAILURE_REASONS,
    history,
  };
}

// Save authorized Premise QA review decision
export async function savePremiseQaReview(db, actorUid, input = {}) {
  if (!actorUid) {
    throw new HttpsError("unauthenticated", "Sign in to review a premise.");
  }

  const premiseId = cleanId(input.premiseId, "Premise ID");
  const requestId = cleanId(input.requestId, "Review request ID");
  const state = upper(input.state);

  if (!["PASS", "FAIL"].includes(state)) {
    throw new HttpsError("invalid-argument", "Choose QA Pass or QA Fail.");
  }

  const comment = typeof input.comment === "string" ? input.comment.trim() : "";
  if (comment.length > 4000) {
    throw new HttpsError("invalid-argument", "Keep the QA comment within 4,000 characters.");
  }

  const reason = state === "FAIL"
    ? PREMISE_QA_FAILURE_REASONS.find((item) => item.code === input.reasonCode)
    : null;

  if (state === "FAIL" && !reason) {
    throw new HttpsError(
      "invalid-argument",
      "A QA failure requires a reason from the approved failure-reason list.",
    );
  }

  const premiseRef = db.doc(`premises/${premiseId}`);
  const historyRef = premiseRef.collection("qaHistory").doc(requestId);
  const registryRef = db.doc(`registry_premises/${premiseId}`);

  return db.runTransaction(async (tx) => {
    const [userSnap, providersSnap, premiseSnap, historySnap] = await Promise.all([
      tx.get(db.doc(`users/${actorUid}`)),
      tx.get(db.collection("serviceProviders")),
      tx.get(premiseRef),
      tx.get(historyRef),
    ]);

    if (!userSnap.exists) {
      throw new HttpsError("permission-denied", "Your user profile is unavailable.");
    }
    if (!premiseSnap.exists) {
      throw new HttpsError("not-found", "This premise does not exist.");
    }

    const actor = userSnap.data();
    const providers = providersSnap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
    const premise = premiseSnap.data();

    // Read TB row before any writes to adhere to Firestore transaction requirement (all reads before writes)
    const tbRowPlan = await readPremiseQaTbRow(tx, db, premiseId, premise);

    // Idempotency: check if requestId was already processed
    if (historySnap.exists) {
      const saved = historySnap.data();
      if (
        saved.actorUid !== actorUid ||
        saved.newStatus !== `QA_${state}` ||
        saved.comment !== comment ||
        saved.reasonCode !== (reason?.code || null)
      ) {
        throw new HttpsError(
          "already-exists",
          "This review request ID was already used for a different decision.",
        );
      }
      return { success: true, idempotent: true, qa: premise.qa };
    }

    // Authorization & Governance
    const access = premiseReviewAccess({ actorUid, actor, providers, premise });
    if (!access.allowed) {
      throw new HttpsError("permission-denied", access.reason);
    }

    // Stale Review Prevention: sourceVersion must match current digest
    const currentVersion = computePremiseDigest(premise);
    if (input.sourceVersion && input.sourceVersion !== currentVersion) {
      throw new HttpsError(
        "aborted",
        "This premise changed while you were reviewing it. Close this window and review the current record.",
      );
    }

    const nowIso = new Date().toISOString();
    const reviewerDisplayName = getUserDisplayName(actor);
    const reviewerRole = upper(getUserRole(actor));

    const qaStateName = `QA_${state}`;
    const previousStatus = premise.qa?.status || "QA_PENDING";

    const updatedQa = {
      status: qaStateName,
      reviewId: requestId,
      sourceVersion: currentVersion,
      reasonCode: reason?.code || null,
      reasonLabel: reason?.label || null,
      comment: comment || null,
      reviewedAt: nowIso,
      reviewedByUid: actorUid,
      reviewedByUser: reviewerDisplayName,
      resubmissionCount: premise.qa?.resubmissionCount || 0,
      lastSubmittedAt: premise.qa?.lastSubmittedAt || premise.metadata?.createdAt || nowIso,
      lastSubmittedByUid: premise.qa?.lastSubmittedByUid || premise.metadata?.createdByUid || actorUid,
      lastSubmittedByUser: premise.qa?.lastSubmittedByUser || premise.metadata?.createdByUser || reviewerDisplayName,
      ruleVersion: 1,
    };

    const historyEntry = {
      eventId: requestId,
      premiseId,
      action: qaStateName,
      previousStatus,
      newStatus: qaStateName,
      sourceVersion: currentVersion,
      reasonCode: reason?.code || null,
      reasonLabel: reason?.label || null,
      comment: comment || null,
      actorUid,
      actorName: reviewerDisplayName,
      actorRole: reviewerRole,
      timestamp: nowIso,
      lmPcode: premise.parents?.lmPcode || null,
      wardPcode: premise.parents?.wardPcode || null,
    };

    // 1. Write immutable audit history
    tx.create(historyRef, historyEntry);

    // 2. Update canonical Premise document
    tx.update(premiseRef, {
      qa: updatedQa,
      "metadata.updatedAt": nowIso,
      "metadata.updatedByUid": actorUid,
      "metadata.updatedByUser": reviewerDisplayName,
    });

    // 3. Update server-maintained registry projection
    tx.set(
      registryRef,
      {
        qa: {
          status: qaStateName,
          reviewedAt: nowIso,
          reviewedByUser: reviewerDisplayName,
          reasonCode: reason?.code || null,
          reasonLabel: reason?.label || null,
        },
        metadata: {
          updatedAt: nowIso,
          updatedByUid: actorUid,
          updatedByUser: reviewerDisplayName,
        },
      },
      { merge: true },
    );

    // 4. Project onto linked Targeted Batch row (under linkage guards)
    applyPremiseQaTbRowProjection(tx, tbRowPlan, qaStateName, {
      reviewedAt: nowIso,
      reviewedByUser: reviewerDisplayName,
      reviewedByUid: actorUid,
      reasonCode: reason?.code || null,
      reasonLabel: reason?.label || null,
    });

    return {
      success: true,
      idempotent: false,
      qa: updatedQa,
    };
  });
}

// Save FWR correction and resubmit back to QA_PENDING
export async function savePremiseCorrection(db, actorUid, input = {}) {
  if (!actorUid) {
    throw new HttpsError("unauthenticated", "Sign in to correct a premise.");
  }

  const premiseId = cleanId(input.premiseId, "Premise ID");
  const payload = input.payload || {};
  const explanation = typeof input.explanation === "string" ? input.explanation.trim() : "";
  const requestId = cleanId(input.requestId, "Request ID");
  const expectedSourceVersion = qaText(input.sourceVersion);

  const premiseRef = db.doc(`premises/${premiseId}`);
  const registryRef = db.doc(`registry_premises/${premiseId}`);

  return db.runTransaction(async (tx) => {
    const [userSnap, premiseSnap] = await Promise.all([
      tx.get(db.doc(`users/${actorUid}`)),
      tx.get(premiseRef),
    ]);

    if (!userSnap.exists) {
      throw new HttpsError("permission-denied", "Your user profile is unavailable.");
    }
    if (!premiseSnap.exists) {
      throw new HttpsError("not-found", "This premise does not exist.");
    }

    const actor = userSnap.data();
    const premise = premiseSnap.data();
    const effectivePremise = {
      ...premise,
      targetedBatchContext: premise.targetedBatchContext || payload.targetedBatchContext || null,
    };

    // Read TB row before any writes to adhere to Firestore transaction requirement (all reads before writes)
    const tbRowPlan = await readPremiseQaTbRow(tx, db, premiseId, effectivePremise);

    // Authority check: user must be the creator, last submitter, or an authorized FWR/SPV
    const creatorUid = qaText(premise.metadata?.createdByUid);
    const lastSubmitterUid = qaText(premise.qa?.lastSubmittedByUid);
    const actorRole = upper(getUserRole(actor));

    if (
      !["FWR", "SPV", "MNG", "SPU", "ADM"].includes(actorRole)
    ) {
      throw new HttpsError("permission-denied", "You are not authorized to correct this premise.");
    }

    const historyRef = premiseRef.collection("qaHistory").doc(`SUBMIT_${requestId}`);
    const historySnap = await tx.get(historyRef);
    if (historySnap.exists) {
      return { success: true, idempotent: true, premiseId, qa: premise.qa };
    }
    if (!expectedSourceVersion || expectedSourceVersion !== qaText(premise.qa?.sourceVersion)) {
      throw new HttpsError("failed-precondition", "This Premise has changed. Reopen the latest Premise before saving.", { currentPremise: premise });
    }
    const nowIso = new Date().toISOString();
    const actorDisplayName = getUserDisplayName(actor);

    // Merge substantive changes
    const updatedSubstantive = {
      ...premise,
      ...(payload.address ? { address: payload.address } : {}),
      ...(payload.propertyType ? { propertyType: payload.propertyType } : {}),
      ...(payload.occupancy ? { occupancy: payload.occupancy } : {}),
      ...(payload.geometry ? { geometry: payload.geometry } : {}),
      ...(payload.media ? { media: payload.media } : {}),
    };

    const newDigest = computePremiseDigest(updatedSubstantive);
    const resubmissionCount = (premise.qa?.resubmissionCount || 0) + 1;

    const resetQa = {
      status: "QA_PENDING",
      reviewId: null,
      sourceVersion: newDigest,
      reasonCode: null,
      reasonLabel: null,
      comment: null,
      reviewedAt: null,
      reviewedByUid: null,
      reviewedByUser: null,
      resubmissionCount,
      lastSubmittedAt: nowIso,
      lastSubmittedByUid: actorUid,
      lastSubmittedByUser: actorDisplayName,
      ruleVersion: 1,
    };

    const historyEntry = {
      eventId: `SUBMIT_${requestId}`,
      premiseId,
      action: "PREMISE_SUBMITTED",
      previousStatus: premise.qa?.status || null,
      newStatus: "QA_PENDING",
      sourceVersion: newDigest,
      reasonCode: null,
      reasonLabel: null,
      comment: explanation || "Premise details corrected and resubmitted by fieldworker",
      actorUid,
      actorName: actorDisplayName,
      actorRole,
      timestamp: nowIso,
      requestId,
      lmPcode: premise.parents?.lmPcode || null,
      wardPcode: premise.parents?.wardPcode || null,
    };

    // 1. Create history record
    tx.create(historyRef, historyEntry);

    // 2. Update premise document
    tx.update(premiseRef, {
      ...(payload.address ? { address: payload.address } : {}),
      ...(payload.propertyType ? { propertyType: payload.propertyType } : {}),
      ...(payload.occupancy ? { occupancy: payload.occupancy } : {}),
      ...(payload.geometry ? { geometry: payload.geometry } : {}),
      ...(payload.media ? { media: payload.media } : {}),
      ...(payload.context ? { context: payload.context } : {}),
      qa: resetQa,
      "metadata.updatedAt": nowIso,
      "metadata.updatedByUid": actorUid,
      "metadata.updatedByUser": actorDisplayName,
    });

    // 3. Update registry projection
    tx.set(
      registryRef,
      {
        ...(payload.address ? { address: payload.address } : {}),
        ...(payload.propertyType ? { propertyType: payload.propertyType } : {}),
        ...(payload.occupancy ? { occupancy: payload.occupancy } : {}),
        ...(payload.geometry ? { geometry: payload.geometry } : {}),
        ...(payload.context ? { context: payload.context } : {}),
        qa: {
          status: "QA_PENDING",
          reviewedAt: null,
          reviewedByUser: null,
          reasonCode: null,
          reasonLabel: null,
        },
        metadata: {
          updatedAt: nowIso,
          updatedByUid: actorUid,
          updatedByUser: actorDisplayName,
        },
      },
      { merge: true },
    );

    // 4. Update TB row projection
    applyPremiseQaTbRowProjection(tx, tbRowPlan, "QA_PENDING", {
      reviewedAt: null,
      reviewedByUser: null,
      reviewedByUid: actorUid,
      reasonCode: null,
      reasonLabel: null,
    });

    return {
      success: true,
      premiseId,
      qa: resetQa,
    };
  });
}

// Invalidate QA_PASS or return QA_FAIL to QA_PENDING if substantive fields changed
export async function invalidatePremiseQaIfSubstantive(db, beforeData, afterData, premiseId, actorUid = "SYSTEM", actorName = "System") {
  const currentStatus = beforeData?.qa?.status;
  if (currentStatus !== "QA_PASS" && currentStatus !== "QA_FAIL") {
    return { invalidated: false };
  }

  const digestBefore = computePremiseDigest(beforeData);
  const digestAfter = computePremiseDigest(afterData);

  if (digestBefore === digestAfter) {
    return { invalidated: false };
  }

  const premiseRef = db.doc(`premises/${premiseId}`);
  const registryRef = db.doc(`registry_premises/${premiseId}`);
  const nowIso = new Date().toISOString();
  const eventId = `${currentStatus === "QA_PASS" ? "INVAL" : "RESUB"}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const action = currentStatus === "QA_PASS" ? "QA_INVALIDATED" : "QA_RESUBMISSION";
  const comment = currentStatus === "QA_PASS"
    ? "Substantive premise edit invalidated prior QA PASS"
    : "Premise details corrected and resubmitted by fieldworker";

  await db.runTransaction(async (tx) => {
    const currentSnap = await tx.get(premiseRef);
    if (!currentSnap.exists) return;
    const current = currentSnap.data() || {};
    if (current.qa?.status !== currentStatus) return;

    const resubmissionCount = (current.qa?.resubmissionCount || 0) + (currentStatus === "QA_FAIL" ? 1 : 0);
    const resetQa = {
      ...current.qa,
      status: "QA_PENDING",
      reviewId: null,
      sourceVersion: digestAfter,
      reasonCode: null,
      reasonLabel: null,
      comment: currentStatus === "QA_PASS" ? "Previous QA approval invalidated due to substantive premise modification" : null,
      reviewedAt: null,
      reviewedByUid: null,
      reviewedByUser: null,
      resubmissionCount,
      lastSubmittedAt: nowIso,
      lastSubmittedByUid: actorUid,
      lastSubmittedByUser: actorName,
    };

    const historyRef = premiseRef.collection("qaHistory").doc(eventId);
    tx.create(historyRef, {
      eventId,
      premiseId,
      action,
      previousStatus: currentStatus,
      newStatus: "QA_PENDING",
      sourceVersion: digestAfter,
      comment,
      actorUid,
      actorName,
      actorRole: currentStatus === "QA_PASS" ? "SYSTEM" : "FWR",
      timestamp: nowIso,
      lmPcode: current.parents?.lmPcode || null,
      wardPcode: current.parents?.wardPcode || null,
    });

    tx.update(premiseRef, {
      qa: resetQa,
      "metadata.updatedAt": nowIso,
      "metadata.updatedByUid": actorUid,
      "metadata.updatedByUser": actorName,
    });

    tx.set(
      registryRef,
      {
        qa: {
          status: "QA_PENDING",
          reviewedAt: null,
          reviewedByUser: null,
          reasonCode: null,
          reasonLabel: null,
        },
      },
      { merge: true },
    );

    await projectPremiseQaToTbRow(tx, db, premiseId, current, "QA_PENDING", {
      reviewedAt: null,
      reviewedByUser: null,
      reviewedByUid: actorUid,
      reasonCode: null,
      reasonLabel: null,
    });
  });

  return { invalidated: true };
}
