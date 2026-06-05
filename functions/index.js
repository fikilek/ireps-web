/* eslint-disable no-undef */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";

import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

import { onTrnWritten } from "./reports/trnReports.js";

import { rebuildMeterRegistryRow } from "./registry/meterRegistryRowRebuild.js";
import { rebuildMeterRegistryRowCallable } from "./registry/meterCallable.js";

import { rebuildPremiseRegistryRow } from "./registry/premiseRegistryRowRebuild.js";
import { rebuildPremiseMeterCounts } from "./registry/premiseMeterCountsRebuild.js";
import { rebuildPremiseRegistryRowCallable } from "./registry/premiseCallable.js";

import { rebuildErfPremiseCount } from "./registry/erfPremiseCountRebuild.js";
import { rebuildErfMeterCounts } from "./registry/erfMeterCountsRebuild.js";
import { rebuildErfTrnCount } from "./registry/erfTrnCountRebuild.js";

import { rebuildWardRegistryForLmCallable } from "./registry/wardCallable.js";
import { startWardRegistrySyncCallable } from "./registry/wardSyncCallable.js";
import { onWardRegistryJobCreated } from "./registry/wardSyncTrigger.js";

import { rebuildWorkbaseRegistryRowCallable } from "./registry/workbaseCallable.js";
import { startWorkbaseRegistrySyncCallable } from "./registry/workbaseSyncCallable.js";
import { onWorkbaseRegistryJobCreated } from "./registry/workbaseSyncTrigger.js";

import { onCreateMeterCommissioningCallable } from "./commissioning/callable.js";
import { onMeterCommissioningTrnCreated } from "./commissioning/trigger.js";

import { createGeoFence } from "./geofences/callables.js";
import { onGeoFenceCreated } from "./geofences/triggers.js";

import { onUploadAndValidateTcCallable } from "./tcUploads/callables.js";
import { onRefreshTcUploadGeofenceReadinessCallable } from "./tcUploads/refreshCallable.js";
import { onDeleteTcUploadCallable } from "./tcUploads/deleteCallable.js";
import {
  getActiveSameOperationLifecycle,
  getEligibilityResult,
} from "./tcUploads/helpers.js";
import {
  applyTcRowBgoReadiness,
  isTcRowUsedByBgo,
  normalizeTcGeoFenceRefs,
  refreshTcUploadSummariesForTcIds,
} from "./tcUploads/readiness.js";

import {
  createTeam,
  renameTeam,
  addTeamMember,
  removeTeamMember,
  deleteTeam,
} from "./teams/callables.js";

import {
  extractPremisePoint,
  extractAstPoint,
  doesEntityBelongToGeoFence,
  normalizeGeoFenceRefs,
} from "./geofences/helpers.js";

import { recomputeGeoFenceCounts } from "./geofences/membership.js";

import { onMeterLifecycleTrnCallable } from "./meterLifecycle/callables.js";
import { onCreateMeterLifecycleInstructionCallable } from "./meterLifecycle/instructionCallable.js";
import { onAcceptRejectLifecycleInstructionCallable } from "./meterLifecycle/acceptRejectCallable.js";
import { onManageLifecycleInstructionCallable } from "./meterLifecycle/manageInstructionCallable.js";

import { onCreateBgoCallable } from "./bgo/callables.js";
import {
  onAcceptRejectBgoBatchCallable,
  onReverseBgoBatchAcceptanceCallable,
} from "./bgo/acceptanceCallable.js";
import { onDeleteUnacceptedBgoCallable } from "./bgo/deleteCallable.js";
import { onBgoChildTrnExecutionSummaryWritten } from "./bgo/executionSummaryTrigger.js";

import {
  onIrepsSelectOptionsCallable,
  onIrepsSelectLookupAdminCallable,
} from "./lookups/index.js";

import { onCreateAccountDataCallable } from "./dataCleansing/callables.js";
import {
  onFieldAccountDataWritten,
  onAccountMasterWritten,
} from "./dataCleansing/triggers.js";

initializeApp();
const auth = getAuth();
const db = getFirestore();

export {
  rebuildWardRegistryForLmCallable,
  startWardRegistrySyncCallable,
  onWardRegistryJobCreated,
  rebuildWorkbaseRegistryRowCallable,
  startWorkbaseRegistrySyncCallable,
  onWorkbaseRegistryJobCreated,
  rebuildPremiseRegistryRowCallable,
  rebuildMeterRegistryRowCallable,
  onTrnWritten,
  createTeam,
  renameTeam,
  addTeamMember,
  removeTeamMember,
  deleteTeam,
  createGeoFence,
  onGeoFenceCreated,
  onMeterLifecycleTrnCallable,
  onCreateMeterLifecycleInstructionCallable,
  onAcceptRejectLifecycleInstructionCallable,
  onManageLifecycleInstructionCallable,
  onCreateMeterCommissioningCallable,
  onMeterCommissioningTrnCreated,
  onIrepsSelectOptionsCallable,
  onIrepsSelectLookupAdminCallable,
  onUploadAndValidateTcCallable,
  onRefreshTcUploadGeofenceReadinessCallable,
  onDeleteTcUploadCallable,
  onCreateBgoCallable,
  onAcceptRejectBgoBatchCallable,
  onReverseBgoBatchAcceptanceCallable,
  onDeleteUnacceptedBgoCallable,
  onBgoChildTrnExecutionSummaryWritten,
  onCreateAccountDataCallable,
  onFieldAccountDataWritten,
  onAccountMasterWritten,
};

function buildPremiseUpdateMetadata(agentUid = "SYSTEM", agentName = "SYSTEM") {
  const serverTimestamp = new Date().toISOString();

  return {
    updatedAt: serverTimestamp,
    updatedByUid: agentUid,
    updatedByUser: agentName,
  };
}

/* ------------------------------------------------
     1. PREMISE UPDATE HELPERS
  ------------------------------------------------ */

function getServiceBucketFromMeterType({ meterType, trnId }) {
  const rawMeterType = String(meterType || "").toLowerCase();
  const rawTrnId = String(trnId || "").toUpperCase();

  if (
    rawMeterType === "water" ||
    rawMeterType === "wtr" ||
    rawTrnId.includes("_WTR_")
  ) {
    return "waterMeters";
  }

  if (
    rawMeterType === "electricity" ||
    rawMeterType === "elec" ||
    rawMeterType === "elc" ||
    rawTrnId.includes("_ELC_") ||
    rawTrnId.includes("_ELEC_")
  ) {
    return "electricityMeters";
  }

  return null;
}

function normalizePremiseServiceSnapshotItem(item) {
  if (!item) return null;

  // Temporary compatibility for old string arrays:
  // ["TRN_..."] -> [{ trnId, status, updatedAt }]
  if (typeof item === "string") {
    return {
      trnId: item,
      status: "RECORDED",
      updatedAt: null,
    };
  }

  return {
    trnId: item?.trnId || item?.id || "NAv",
    status: String(item?.status || "RECORDED").toUpperCase(),
    updatedAt: item?.updatedAt || null,
  };
}

function getMeterStatusState(astData = {}) {
  return String(
    astData?.status?.state || astData?.status || "FIELD",
  ).toUpperCase();
}

async function syncPremiseServiceSnapshotFromMeter({ astId, astData }) {
  const premiseId = astData?.accessData?.premise?.id || null;
  const meterType = astData?.meterType || null;
  const serviceBucket = getServiceBucketFromMeterType({
    meterType,
    trnId: astId,
  });

  if (!premiseId || premiseId === "NAv") {
    logger.warn("syncPremiseServiceSnapshotFromMeter -- missing premiseId", {
      astId,
      meterType,
    });
    return null;
  }

  if (!serviceBucket) {
    logger.warn(
      "syncPremiseServiceSnapshotFromMeter -- unknown service bucket",
      {
        astId,
        meterType,
      },
    );
    return null;
  }

  const metadata = astData?.metadata || {};
  const updatedAt = metadata?.updatedAt || new Date().toISOString();
  const updatedByUid =
    metadata?.updatedByUid || metadata?.createdByUid || "SYSTEM";
  const updatedByUser =
    metadata?.updatedByUser || metadata?.createdByUser || "SYSTEM";

  const nextServiceItem = {
    trnId: astId,
    status: getMeterStatusState(astData),
    updatedAt,
  };

  const premiseRef = db.collection("premises").doc(premiseId);

  await db.runTransaction(async (tx) => {
    const premiseSnap = await tx.get(premiseRef);

    if (!premiseSnap.exists) {
      logger.warn("syncPremiseServiceSnapshotFromMeter -- premise not found", {
        astId,
        premiseId,
      });
      return;
    }

    const premiseData = premiseSnap.data() || {};
    const services = premiseData?.services || {};

    const currentBucket = Array.isArray(services?.[serviceBucket])
      ? services[serviceBucket]
      : [];

    const normalizedBucket = currentBucket
      .map(normalizePremiseServiceSnapshotItem)
      .filter((item) => item?.trnId && item.trnId !== "NAv");

    const existingIndex = normalizedBucket.findIndex(
      (item) => item.trnId === astId,
    );

    if (existingIndex >= 0) {
      normalizedBucket[existingIndex] = {
        ...normalizedBucket[existingIndex],
        ...nextServiceItem,
      };
    } else {
      normalizedBucket.push(nextServiceItem);
    }

    tx.update(premiseRef, {
      [`services.${serviceBucket}`]: normalizedBucket,
      "metadata.updatedAt": updatedAt,
      "metadata.updatedByUid": updatedByUid,
      "metadata.updatedByUser": updatedByUser,
    });
  });

  logger.info("syncPremiseServiceSnapshotFromMeter -- SUCCESS", {
    premiseId,
    astId,
    serviceBucket,
    status: nextServiceItem.status,
  });

  return {
    premiseId,
    astId,
    serviceBucket,
    status: nextServiceItem.status,
  };
}

/* ------------------------------------------------
     
  ------------------------------------------------ */

export const createServiceProvider = onCall(async (request) => {
  console.log(" ");
  console.log("createServiceProvider ---- START");

  const { auth, data } = request;

  /* ------------------------------------------------
     1. AUTH & ROLE CHECK
     ------------------------------------------------ */
  if (!auth) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const role = auth.token.role;

  if (!["SPU", "ADM"].includes(role)) {
    throw new HttpsError(
      "permission-denied",
      "Only SPU or ADM may create Service Providers",
    );
  }

  const actorUid = auth.uid;
  const actorName =
    auth.token?.name ||
    auth.token?.email ||
    auth.token?.displayName ||
    actorUid ||
    "SYSTEM";

  /* ------------------------------------------------
     2. NORMALIZE INPUT
     ------------------------------------------------ */
  const profile = data.profile;
  const classification = "MNC"; // 🔒 enforced by backend
  const parentMncId = data.ownership?.parentMncId ?? null;
  const assignedWorkbases = data.workbases?.assigned ?? [];
  const lifecycle = data.status?.lifecycle ?? "DRAFT";

  console.log("createServiceProvider ---- normalized input", {
    profile,
    classification,
    parentMncId,
    assignedWorkbases,
    lifecycle,
  });

  /* ------------------------------------------------
     3. VALIDATION
     ------------------------------------------------ */
  if (!profile?.name) {
    throw new HttpsError(
      "invalid-argument",
      "Service Provider name is required",
    );
  }

  if (!Array.isArray(assignedWorkbases) || assignedWorkbases.length === 0) {
    throw new HttpsError(
      "invalid-argument",
      "At least one workbase must be assigned",
    );
  }

  /* ------------------------------------------------
     4. CREATE DOCUMENT
     ------------------------------------------------ */
  const ref = db.collection("serviceProviders").doc();
  const now = FieldValue.serverTimestamp();

  await ref.set({
    profile: {
      name: profile.name,
      classification, // always MNC here
    },

    ownership: {
      parentMncId, // null for MNC
    },

    workbases: {
      assigned: assignedWorkbases,
    },

    status: {
      lifecycle, // DRAFT
    },

    offices: [], // added later by MNG

    metadata: {
      createdAt: now,
      createdByUid: actorUid,
      createdByUser: actorName,
      updatedAt: now,
      updatedByUid: actorUid,
      updatedByUser: actorName,
    },
  });

  console.log("createServiceProvider ---- CREATED", ref.id);

  return {
    spId: ref.id,
    lifecycle,
  };
});

export const updateServiceProvider = onCall(async (request) => {
  console.log(" ");
  console.log(" ");
  console.log("updateServiceProvider ---- START");
  console.log("updateServiceProvider ---- START");

  const { data, auth } = request;

  console.log("updateServiceProvider ---- data", data);
  console.log("updateServiceProvider ---- auth", auth);

  /* -------------------------------------------
     1. AUTH CHECK
     ------------------------------------------- */
  if (!auth) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { spId, patch } = data;

  if (!spId || !patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new HttpsError("invalid-argument", "spId and patch are required");
  }

  const role = auth.token.role;
  const callerSpId = auth.token.spId || null;

  const actorUid = auth.uid;
  const actorName =
    auth.token?.name ||
    auth.token?.email ||
    auth.token?.displayName ||
    actorUid ||
    "SYSTEM";

  /* -------------------------------------------
     2. LOAD SERVICE PROVIDER
     ------------------------------------------- */
  const ref = db.doc(`serviceProviders/${spId}`);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Service Provider not found");
  }

  const existingData = snap.data() || {};
  const existingMetadata = existingData?.metadata || {};

  /* -------------------------------------------
     3. PERMISSION RULES
     ------------------------------------------- */

  // Managers may only edit their own SP
  if (role === "MNG" && callerSpId !== spId) {
    throw new HttpsError(
      "permission-denied",
      "Managers may only edit their own Service Provider",
    );
  }

  // Contract-level fields are Smars-only
  if (
    role === "MNG" &&
    (patch.workbases || patch.ownership || patch.profile?.classification)
  ) {
    throw new HttpsError(
      "permission-denied",
      "Managers may not edit contract-level fields",
    );
  }

  /* -------------------------------------------
     4. SANITIZE PATCH
     ------------------------------------------- */
  const safePatch = {
    ...patch,
  };

  // Backend owns metadata. Client must not write old or new metadata shapes.
  delete safePatch["meta"];
  delete safePatch.metadata;

  /* -------------------------------------------
     5. VALIDATION
     ------------------------------------------- */
  if (safePatch.offices) {
    validateOffices(safePatch.offices);
    safePatch.offices = normalizeHeadOffice(safePatch.offices);
  }

  /* -------------------------------------------
     6. APPLY UPDATE
     ------------------------------------------- */
  const now = FieldValue.serverTimestamp();

  safePatch.metadata = {
    createdAt: existingMetadata?.createdAt || now,
    createdByUid: existingMetadata?.createdByUid || actorUid,
    createdByUser: existingMetadata?.createdByUser || actorName,
    updatedAt: now,
    updatedByUid: actorUid,
    updatedByUser: actorName,
  };

  await ref.update(safePatch);

  return { ok: true };
});

export const createAdminUser = onCall(async (request) => {
  console.log("createAdminUser ---- START");
  console.log("createAdminUser ---- request", request);

  const { auth: caller, data } = request;
  console.log("createAdminUser ---- caller", caller);
  console.log("createAdminUser ---- data", data);

  if (!caller) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  // 🔒 SPU only
  if (caller.token.role !== "SPU") {
    throw new HttpsError("permission-denied", "SPU only");
  }

  const { email, name, surname } = data;

  if (!email || !name || !surname) {
    throw new HttpsError("invalid-argument", "Missing required fields");
  }

  const now = Timestamp.now();
  const actorName =
    caller.token?.name ||
    caller.token?.email ||
    caller.displayName ||
    caller.uid ||
    "SYSTEM";

  // 1️⃣ Create Auth user
  const userRecord = await auth.createUser({
    email,
    displayName: `${name} ${surname}`,
  });

  // 2️⃣ Set custom claim
  await auth.setCustomUserClaims(userRecord.uid, {
    role: "ADM",
    organization: "Smars",
  });

  // 3️⃣ Create Firestore user doc (NO workbase yet)
  await db.doc(`users/${userRecord.uid}`).set({
    auth: {
      uid: userRecord.uid,
      email,
    },

    role: "ADM",
    organization: "Smars",

    access: {
      scope: "GLOBAL",
      activeWorkbase: null,
    },

    onboarding: {
      status: "PENDING",
    },

    profile: {
      name,
      surname,
    },

    metadata: {
      createdAt: now,
      createdByUid: caller.uid,
      createdByUser: actorName,
      updatedAt: now,
      updatedByUid: caller.uid,
      updatedByUser: actorName,
    },
  });

  console.log("createAdminUser ---- SUCCESS", userRecord.uid);

  return { uid: userRecord.uid };
});

export const onPremiseCreated = onDocumentCreated(
  "premises/{premiseId}",
  async (event) => {
    const startedAtMs = Date.now();

    const logTime = (label, extra = {}) => {
      const elapsedSeconds = ((Date.now() - startedAtMs) / 1000).toFixed(2);

      logger.info(`⏱️ onPremiseCreated -- ${label}`, {
        elapsedSeconds,
        ...extra,
      });
    };

    logTime("START");

    const db = getFirestore();

    const snap = event.data;
    if (!snap?.exists) {
      logTime("no snapshot");
      return null;
    }

    const data = snap.data() || {};
    const premiseId = event.params.premiseId;

    const erfId = data?.erfId || null;
    const metadata = data?.metadata || {};

    const lmPcode = data?.parents?.lmPcode || null;
    const wardPcode = data?.parents?.wardPcode || null;

    const auditUid =
      metadata?.updatedByUid || metadata?.createdByUid || "unknown_uid";

    const auditUser =
      metadata?.updatedByUser || metadata?.createdByUser || "Unknown Agent";

    logger.info("onPremiseCreated -- context", {
      premiseId,
      erfId,
      lmPcode,
      wardPcode,
      auditUid,
      auditUser,
    });

    try {
      /* ------------------------------------------------
         1. REBUILD PREMISE REGISTRY ROW
         ------------------------------------------------ */
      const premiseRegistryStartedAtMs = Date.now();

      await rebuildPremiseRegistryRow(premiseId);

      logger.info("⏱️ onPremiseCreated -- rebuild premise registry row", {
        premiseId,
        elapsedSeconds: (
          (Date.now() - premiseRegistryStartedAtMs) /
          1000
        ).toFixed(2),
        totalElapsedSeconds: ((Date.now() - startedAtMs) / 1000).toFixed(2),
      });

      /* ------------------------------------------------
         2. KEEP EXISTING ERF BUBBLING BEHAVIOR
         ------------------------------------------------ */
      if (erfId) {
        const erfBubbleStartedAtMs = Date.now();

        const erfRef = db.collection("ireps_erfs").doc(erfId);

        await erfRef.update({
          premises: FieldValue.arrayUnion(premiseId),
          "metadata.updatedAt": new Date().toISOString(),
          "metadata.updatedByUid": auditUid,
          "metadata.updatedByUser": auditUser,
        });

        logger.info("⏱️ onPremiseCreated -- ERF premise array update", {
          premiseId,
          erfId,
          elapsedSeconds: ((Date.now() - erfBubbleStartedAtMs) / 1000).toFixed(
            2,
          ),
          totalElapsedSeconds: ((Date.now() - startedAtMs) / 1000).toFixed(2),
        });

        const erfPremiseCountStartedAtMs = Date.now();

        await rebuildErfPremiseCount(erfId);

        logger.info("⏱️ onPremiseCreated -- rebuild ERF premise count", {
          premiseId,
          erfId,
          elapsedSeconds: (
            (Date.now() - erfPremiseCountStartedAtMs) /
            1000
          ).toFixed(2),
          totalElapsedSeconds: ((Date.now() - startedAtMs) / 1000).toFixed(2),
        });
      } else {
        logTime("no erfId, skipping ERF bubbling", { premiseId });
      }

      /* ------------------------------------------------
         3. RESOLVE GEOFENCE MEMBERSHIP FOR THIS PREMISE
         ------------------------------------------------ */
      if (!lmPcode || !wardPcode) {
        logTime("no lm/ward scope, skipping geofence sync", { premiseId });
        return null;
      }

      const premisePointStartedAtMs = Date.now();
      const premisePoint = extractPremisePoint(data);

      logger.info("⏱️ onPremiseCreated -- extract premise point", {
        premiseId,
        elapsedSeconds: ((Date.now() - premisePointStartedAtMs) / 1000).toFixed(
          2,
        ),
        totalElapsedSeconds: ((Date.now() - startedAtMs) / 1000).toFixed(2),
        hasPoint: Boolean(premisePoint),
      });

      if (!premisePoint) {
        logTime("no valid premise point, skipping geofence sync", {
          premiseId,
        });
        return null;
      }

      const geoFenceQueryStartedAtMs = Date.now();

      const geoFenceSnapshot = await db
        .collection("geo_fences")
        .where("parents.lmPcode", "==", lmPcode)
        .where("parents.wardPcode", "==", wardPcode)
        .where("status", "==", "ACTIVE")
        .get();

      logger.info("⏱️ onPremiseCreated -- geofence query", {
        premiseId,
        elapsedSeconds: (
          (Date.now() - geoFenceQueryStartedAtMs) /
          1000
        ).toFixed(2),
        totalElapsedSeconds: ((Date.now() - startedAtMs) / 1000).toFixed(2),
        candidateCount: geoFenceSnapshot.size,
      });

      const geofenceMatchStartedAtMs = Date.now();
      const matchedGeoFences = [];

      for (const geoFenceDoc of geoFenceSnapshot.docs) {
        const geoFence = geoFenceDoc.data() || {};
        const bbox = geoFence?.geometry?.bbox || null;
        const polygonPoints = geoFence?.geometry?.points || [];

        const belongs = doesEntityBelongToGeoFence({
          point: premisePoint,
          bbox,
          polygonPoints,
        });

        if (!belongs) continue;

        matchedGeoFences.push({
          id: geoFenceDoc.id,
          name: geoFence?.name || geoFence?.description || geoFenceDoc.id,
        });
      }

      logger.info("⏱️ onPremiseCreated -- geofence match loop", {
        premiseId,
        elapsedSeconds: (
          (Date.now() - geofenceMatchStartedAtMs) /
          1000
        ).toFixed(2),
        totalElapsedSeconds: ((Date.now() - startedAtMs) / 1000).toFixed(2),
        matchedCount: matchedGeoFences.length,
      });

      const nextGeoFenceRefs = normalizeGeoFenceRefs(matchedGeoFences);

      const premiseGeofenceUpdateStartedAtMs = Date.now();

      await snap.ref.update({
        geofenceRefs: nextGeoFenceRefs,
        "metadata.updatedAt": new Date().toISOString(),
        "metadata.updatedByUid": auditUid || "Unknown Uid",
        "metadata.updatedByUser": auditUser || "Unknown Agent",
      });

      logger.info("⏱️ onPremiseCreated -- premise geofence refs update", {
        premiseId,
        elapsedSeconds: (
          (Date.now() - premiseGeofenceUpdateStartedAtMs) /
          1000
        ).toFixed(2),
        totalElapsedSeconds: ((Date.now() - startedAtMs) / 1000).toFixed(2),
        geofenceRefsCount: nextGeoFenceRefs.length,
      });

      /* ------------------------------------------------
         4. RECOMPUTE COUNTS FOR MATCHED GEOFENCES
         ------------------------------------------------ */
      const allGeofenceCountsStartedAtMs = Date.now();

      for (const geoFenceRef of nextGeoFenceRefs) {
        const geoFenceId = geoFenceRef.id;
        const singleGeofenceStartedAtMs = Date.now();

        const counts = await recomputeGeoFenceCounts({
          db,
          geoFenceId,
          lmPcode,
          wardPcode,
        });

        await db
          .collection("geo_fences")
          .doc(geoFenceId)
          .update({
            counts,
            "metadata.updatedAt": new Date().toISOString(),
            "metadata.updatedByUid": auditUid || "Unknown Uid",
            "metadata.updatedByUser": auditUser || "Unknown Agent",
          });

        logger.info("⏱️ onPremiseCreated -- single geofence counts update", {
          premiseId,
          geoFenceId,
          elapsedSeconds: (
            (Date.now() - singleGeofenceStartedAtMs) /
            1000
          ).toFixed(2),
          totalElapsedSeconds: ((Date.now() - startedAtMs) / 1000).toFixed(2),
        });
      }

      logger.info("⏱️ onPremiseCreated -- all geofence counts done", {
        premiseId,
        elapsedSeconds: (
          (Date.now() - allGeofenceCountsStartedAtMs) /
          1000
        ).toFixed(2),
        totalElapsedSeconds: ((Date.now() - startedAtMs) / 1000).toFixed(2),
        geofenceCount: nextGeoFenceRefs.length,
      });

      logTime("SUCCESS END", { premiseId });

      return null;
    } catch (error) {
      logTime("ERROR END", {
        premiseId,
        message: error?.message || String(error),
      });

      logger.error("onPremiseCreated -- ERROR", {
        premiseId,
        message: error?.message || String(error),
        stack: error?.stack || "NAv",
      });

      return null;
    }
  },
);

export const onPremiseUpdated = onDocumentUpdated(
  "premises/{premiseId}",
  async (event) => {
    const dataAfter = event.data.after.data() || {};
    const dataBefore = event.data.before.data() || {};
    const premiseId = event.params.premiseId;
    const erfId = dataAfter.erfId;
    const metadata = dataAfter.metadata || {};

    // only pulse if meaningful premise timestamp changed
    if (dataAfter?.metadata?.updatedAt === dataBefore?.metadata?.updatedAt) {
      return null;
    }

    try {
      await rebuildPremiseRegistryRow(premiseId);

      if (!erfId) return null;

      const erfRef = db.collection("ireps_erfs").doc(erfId);

      await erfRef.update({
        "metadata.updatedAt": new Date().toISOString(),
        "metadata.updatedByUid": metadata?.updatedByUid || "Unknown Uid",
        "metadata.updatedByUser": metadata?.updatedByUser || "Unknown Agent",
      });

      return null;
    } catch (error) {
      logger.error("onPremiseUpdated ---- ERROR", {
        premiseId,
        message: error?.message || String(error),
      });
      return null;
    }
  },
);

function normalizeMeterNo(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
}

function buildFlatRootMetadataFromSource({
  sourceMetadata = {},
  fallbackUid = "SYSTEM",
  fallbackUser = "SYSTEM",
  fallbackAt = null,
} = {}) {
  const now = fallbackAt || new Date().toISOString();

  const createdAt = sourceMetadata?.createdAt || now;
  const createdByUid = sourceMetadata?.createdByUid || fallbackUid;
  const createdByUser = sourceMetadata?.createdByUser || fallbackUser;

  const updatedAt = sourceMetadata?.updatedAt || createdAt;
  const updatedByUid = sourceMetadata?.updatedByUid || createdByUid;
  const updatedByUser = sourceMetadata?.updatedByUser || createdByUser;

  return {
    createdAt,
    createdByUid,
    createdByUser,
    updatedAt,
    updatedByUid,
    updatedByUser,
  };
}

function deriveMasterVisibility(masterData) {
  const astId = masterData?.refs?.asts?.id || null;
  const salesId = masterData?.refs?.sales?.id || null;
  return astId && salesId ? "VISIBLE" : "INVISIBLE";
}

async function syncSalesAllMetersFromMaster({
  tx,
  normalizedMeterNo,
  masterData,
  salesSnap,
  updatedAt,
  updatedByUid,
  updatedByUser,
}) {
  const salesRef = db.collection("sales-all-meters").doc(normalizedMeterNo);
  const salesId = masterData?.refs?.sales?.id || null;
  const visibility = deriveMasterVisibility(masterData);

  if (salesSnap.exists) {
    tx.update(salesRef, {
      "master.id": normalizedMeterNo,
      "master.visibility": visibility,
      "metadata.updatedAt": updatedAt,
      "metadata.updatedByUid": updatedByUid,
      "metadata.updatedByUser": updatedByUser,
    });
  } else if (salesId) {
    logger.warn(
      "syncSalesAllMetersFromMaster ---- sales link exists but sales-all-meters doc missing",
      {
        normalizedMeterNo,
        salesId,
      },
    );
  }

  return visibility;
}

export const onMeterDiscoveryCreated = onDocumentCreated(
  "trns/{trnId}",
  async (event) => {
    logger.log("onMeterDiscoveryCreated ---- START");

    const trnId = event.params.trnId;
    const snap = event.data;
    if (!snap) return null;

    const trnData = snap.data() || {};
    const { accessData, ast, meterType } = trnData;

    if (accessData?.trnType !== "METER_DISCOVERY") return null;
    if (accessData?.access?.hasAccess !== "yes") return null;
    if (!ast) return null;

    const rawMeterNo = ast?.astData?.astNo || "";
    const normalizedMeterNo = normalizeMeterNo(rawMeterNo);

    const premiseId = accessData?.premise?.id || null;
    const erfId = accessData?.erfId || null;
    const lmPcode = accessData?.parents?.lmPcode || null;

    if (!normalizedMeterNo) {
      logger.warn("onMeterDiscoveryCreated ---- missing meter number", {
        trnId,
      });
      return null;
    }

    if (!premiseId) {
      logger.warn("onMeterDiscoveryCreated ---- missing premiseId", {
        trnId,
      });
      return null;
    }

    const premiseRef = db.collection("premises").doc(premiseId);
    const premiseSnap = await premiseRef.get();

    if (!premiseSnap.exists) {
      logger.error("onMeterDiscoveryCreated ---- premise missing", {
        trnId,
        premiseId,
      });
      return null;
    }

    const sourceMetadata = buildFlatRootMetadataFromSource({
      sourceMetadata: trnData?.metadata || {},
      fallbackUid: "SYSTEM",
      fallbackUser: "SYSTEM",
    });

    const {
      createdAt,
      createdByUid,
      createdByUser,
      updatedAt,
      updatedByUid,
      updatedByUser,
    } = sourceMetadata;

    const agentUid = updatedByUid;
    const agentName = updatedByUser;

    const astId = trnId;
    const astRef = db.collection("asts").doc(astId);
    const masterRef = db.collection("meter_master").doc(normalizedMeterNo);
    const salesRef = db.collection("sales-all-meters").doc(normalizedMeterNo);
    const trnRef = db.collection("trns").doc(trnId);
    const erfRef = erfId ? db.collection("ireps_erfs").doc(erfId) : null;

    if (meterType !== "water" && meterType !== "electricity") {
      logger.warn("onMeterDiscoveryCreated ---- invalid meterType", {
        trnId,
        meterType,
      });
      return null;
    }

    try {
      await db.runTransaction(async (tx) => {
        const astSnap = await tx.get(astRef);
        const masterSnap = await tx.get(masterRef);
        const salesSnap = await tx.get(salesRef);

        if (astSnap.exists) {
          logger.log("onMeterDiscoveryCreated ---- AST already exists", {
            trnId,
            astId,
          });
          return;
        }

        const masterBefore = masterSnap.exists ? masterSnap.data() : null;
        const existingAstId = masterBefore?.refs?.asts?.id || null;

        if (existingAstId && existingAstId !== astId) {
          throw new Error(
            `MASTER conflict: meter ${normalizedMeterNo} already linked to AST ${existingAstId}`,
          );
        }

        const serviceProvider = trnData?.serviceProvider || {
          id: "NAv",
          name: "NAv",
        };

        const nextMasterData = masterSnap.exists
          ? {
              ...masterBefore,
              refs: {
                ...(masterBefore?.refs || {}),
                asts: {
                  ...(masterBefore?.refs?.asts || {}),
                  id: astId,
                },
              },
              serviceProvider,
              metadata: {
                ...(masterBefore?.metadata || {}),
                updatedAt,
                updatedByUid: agentUid,
                updatedByUser: agentName,
              },
            }
          : {
              lmPcode,
              meterNo: {
                raw: rawMeterNo,
                normalized: normalizedMeterNo,
              },
              meterType: meterType || null,
              customerNo: null,
              accountNo: null,
              refs: {
                asts: {
                  id: astId,
                },
                sales: {
                  id: null,
                  provider: null,
                },
              },
              serviceProvider,
              metadata: {
                createdAt,
                createdByUid,
                createdByUser,
                updatedAt,
                updatedByUid: agentUid,
                updatedByUser: agentName,
              },
            };

        const visibility = deriveMasterVisibility(nextMasterData);

        const statusPayload = trnData?.status || null;

        const astPayload = {
          ...(ast || {}),
          astData: {
            ...(ast?.astData || {}),
            astId,
          },
        };

        // 1. CREATE AST
        tx.set(astRef, {
          accessData,
          ast: astPayload,
          media: trnData.media || [],
          meterType,
          trnId,
          master: {
            id: normalizedMeterNo,
            visibility,
          },
          metadata: {
            createdAt,
            createdByUid,
            createdByUser,
            updatedAt,
            updatedByUid: agentUid,
            updatedByUser: agentName,
          },
          status: statusPayload,
          serviceProvider,
        });

        // 2. UPSERT MASTER
        if (masterSnap.exists) {
          tx.update(masterRef, {
            "refs.asts.id": astId,
            "metadata.updatedAt": updatedAt,
            "metadata.updatedByUid": agentUid,
            "metadata.updatedByUser": agentName,
          });
        } else {
          tx.set(masterRef, nextMasterData);
        }

        // 2.5 SYNC SALES-ALL-METERS FROM MASTER TRUTH
        await syncSalesAllMetersFromMaster({
          tx,
          normalizedMeterNo,
          masterData: nextMasterData,
          salesSnap,
          updatedAt,
          updatedByUid: agentUid,
          updatedByUser: agentName,
        });

        // 3. UPDATE PREMISE
        const premiseMetadataPatch = buildPremiseUpdateMetadata(
          agentUid,
          agentName,
        );

        tx.update(premiseRef, {
          "occupancy.status": "Accessed",
          "metadata.updatedAt": premiseMetadataPatch.updatedAt,
          "metadata.updatedByUid": premiseMetadataPatch.updatedByUid,
          "metadata.updatedByUser": premiseMetadataPatch.updatedByUser,
        });

        // 4. MARK TRN AS DERIVED
        tx.set(
          trnRef,
          {
            derived: {
              astId,
              master: {
                id: normalizedMeterNo,
                visibility,
              },
              processedAt: updatedAt,
            },
          },
          { merge: true },
        );

        // 5. BUBBLE TO ERF
        if (erfRef) {
          tx.update(erfRef, {
            "metadata.updatedAt": updatedAt,
            "metadata.updatedByUid": agentUid,
            "metadata.updatedByUser": agentName,
          });
        }
      });

      // ✅ Rebuild ONLY ERF meter counts AFTER transaction succeeds
      if (erfId && erfId !== "NAv") {
        await rebuildErfMeterCounts(erfId);
        await rebuildErfTrnCount(erfId);
      }

      if (premiseId && premiseId !== "NAv") {
        await rebuildPremiseMeterCounts(premiseId);
        await rebuildPremiseRegistryRow(premiseId);
      }

      logger.log("onMeterDiscoveryCreated ---- SUCCESS", {
        trnId,
        astId,
        normalizedMeterNo,
      });

      return { success: true };
    } catch (error) {
      logger.error("onMeterDiscoveryCreated ---- FATAL ERROR:", error);
      return null;
    }
  },
);

export const onNoAccessRecorded = onDocumentCreated(
  "trns/{trnId}",
  async (event) => {
    logger.log("onNoAccessRecorded ---- START");

    const trnData = event.data.data() || {};
    const trnId = event.params.trnId;
    const { accessData } = trnData;

    if (accessData?.access?.hasAccess !== "no") {
      logger.log("onNoAccessRecorded ---- Access was granted. Standing down.");
      return null;
    }

    const premiseId = accessData?.premise?.id || null;
    const metadata = trnData?.metadata || {};
    const erfId = accessData?.erfId || null;

    if (!premiseId) {
      logger.error("onNoAccessRecorded ---- ERROR: No Premise ID found.");
      return null;
    }

    try {
      const premiseRef = db.collection("premises").doc(premiseId);

      const agentName =
        metadata?.updatedByUser || metadata?.createdByUser || "NAv";

      const agentUid =
        metadata?.updatedByUid || metadata?.createdByUid || "NAv";

      const premiseMetadataPatch = buildPremiseUpdateMetadata(
        agentUid,
        agentName,
      );

      await premiseRef.update({
        noAccessTrnIds: FieldValue.arrayUnion(trnId),
        "metadata.updatedAt": premiseMetadataPatch.updatedAt,
        "metadata.updatedByUid": premiseMetadataPatch.updatedByUid,
        "metadata.updatedByUser": premiseMetadataPatch.updatedByUser,
      });

      logger.log(
        `onNoAccessRecorded ---- SUCCESS: Recorded NA [${trnId}] for Premise [${premiseId}]`,
      );

      if (erfId) {
        await db.collection("ireps_erfs").doc(erfId).update({
          "metadata.updatedAt": new Date().toISOString(),
          "metadata.updatedByUid": agentUid,
          "metadata.updatedByUser": agentName,
        });

        await rebuildErfTrnCount(erfId);
      }

      return { success: true };
    } catch (error) {
      logger.error("onNoAccessRecorded ---- FATAL ERROR:", error);
      return null;
    }
  },
);

function normalizeName(value) {
  const str = String(value || "")
    .trim()
    .toLowerCase();
  if (!str) return "NAv";

  return str.charAt(0).toUpperCase() + str.slice(1);
}

function normalizeWorkbases(workbases = []) {
  const seenIds = new Set();

  return (Array.isArray(workbases) ? workbases : [])
    .map((item) => ({
      id: String(item?.id || "").trim(),
      name: String(item?.name || "").trim() || "NAv",
    }))
    .filter((item) => {
      if (!item.id || seenIds.has(item.id)) return false;
      seenIds.add(item.id);
      return true;
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function getServiceProviderLmClients(serviceProvider) {
  const clients = Array.isArray(serviceProvider?.clients)
    ? serviceProvider.clients
    : [];

  return clients.filter(
    (client) =>
      client?.clientType === "LM" &&
      client?.relationshipType === "MNC" &&
      client?.id &&
      client?.name,
  );
}

function getServiceProviderParentSpClient(serviceProvider) {
  const clients = Array.isArray(serviceProvider?.clients)
    ? serviceProvider.clients
    : [];

  return (
    clients.find(
      (client) =>
        client?.clientType === "SP" &&
        client?.relationshipType === "SUBC" &&
        client?.id,
    ) || null
  );
}

function resolveServiceProviderWorkbases(
  serviceProviderId,
  allServiceProviders = [],
  visitedIds = new Set(),
) {
  if (!serviceProviderId) return [];

  if (visitedIds.has(serviceProviderId)) {
    logger.warn(
      "resolveServiceProviderWorkbases -- circular relationship detected",
      { serviceProviderId },
    );
    return [];
  }

  visitedIds.add(serviceProviderId);

  const serviceProvider = allServiceProviders.find(
    (item) => item?.id === serviceProviderId,
  );

  if (!serviceProvider) return [];

  const lmClients = getServiceProviderLmClients(serviceProvider);

  if (lmClients.length > 0) {
    return normalizeWorkbases(
      lmClients.map((client) => ({
        id: client.id,
        name: client.name,
      })),
    );
  }

  const parentSpClient = getServiceProviderParentSpClient(serviceProvider);

  if (!parentSpClient?.id) {
    return [];
  }

  return resolveServiceProviderWorkbases(
    parentSpClient.id,
    allServiceProviders,
    visitedIds,
  );
}

function getDirectSubcChildren(parentSpId, allServiceProviders = []) {
  return allServiceProviders.filter((serviceProvider) => {
    const parentSpClient = getServiceProviderParentSpClient(serviceProvider);
    return parentSpClient?.id === parentSpId;
  });
}

function collectMngTreeServiceProviderIds(
  rootSpId,
  allServiceProviders = [],
  visitedIds = new Set(),
) {
  if (!rootSpId) return [];
  if (visitedIds.has(rootSpId)) return [];

  visitedIds.add(rootSpId);

  const childProviders = getDirectSubcChildren(rootSpId, allServiceProviders);

  const childIds = childProviders.flatMap((childProvider) =>
    collectMngTreeServiceProviderIds(
      childProvider.id,
      allServiceProviders,
      visitedIds,
    ),
  );

  return [rootSpId, ...childIds];
}

export const inviteManagerUser = onCall(async (request) => {
  const { auth: caller, data } = request;

  // 1. AUTH GUARD
  if (!caller) {
    throw new HttpsError(
      "unauthenticated",
      "Mission denied: Authentication required.",
    );
  }

  const { email, name, surname, mnc } = data || {};

  // 2. BASIC INPUT VALIDATION
  if (!email || !name || !surname || !mnc?.id || !mnc?.name) {
    throw new HttpsError(
      "invalid-argument",
      "Email, name, surname and MNC are required.",
    );
  }

  const cleanEmail = String(email).toLowerCase().trim();
  const cleanName = normalizeName(name);
  const cleanSurname = normalizeName(surname);
  const displayName = `${cleanName} ${cleanSurname}`;

  try {
    // 3. LOAD CALLER USER DOC
    const callerSnap = await db.collection("users").doc(caller.uid).get();

    if (!callerSnap.exists) {
      throw new HttpsError(
        "permission-denied",
        "Mission denied: Caller profile not found.",
      );
    }

    const callerData = callerSnap.data() || {};
    const callerRole = String(callerData?.employment?.role || "").trim();

    // 4. ONLY SPU / ADM MAY CREATE MNG
    if (callerRole !== "SPU" && callerRole !== "ADM") {
      throw new HttpsError(
        "permission-denied",
        "Mission denied: Only SPU or ADM may create a manager.",
      );
    }

    // 5. LOAD SELECTED SERVICE PROVIDER
    const spRef = db.collection("serviceProviders").doc(mnc.id);
    const spSnap = await spRef.get();

    if (!spSnap.exists) {
      throw new HttpsError(
        "not-found",
        "Selected service provider was not found.",
      );
    }

    const spData = spSnap.data() || {};
    const spStatus = String(spData?.status || "").toUpperCase();
    const spClients = Array.isArray(spData?.clients) ? spData.clients : [];

    // 6. VALIDATE SP
    if (spStatus !== "ACTIVE") {
      throw new HttpsError(
        "failed-precondition",
        "Selected service provider is not active.",
      );
    }

    if (spClients.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "Selected service provider has no clients.",
      );
    }

    // 7. DERIVE LM WORKBASES FROM SP CLIENTS
    const seenLmIds = new Set();

    const inheritedWorkbases = spClients
      .filter(
        (client) => client?.clientType === "LM" && client?.id && client?.name,
      )
      .map((client) => ({
        id: String(client.id).trim(),
        name: String(client.name).trim(),
      }))
      .filter((client) => {
        if (!client.id || seenLmIds.has(client.id)) return false;
        seenLmIds.add(client.id);
        return true;
      });

    if (inheritedWorkbases.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "Selected service provider has no LM clients to inherit as workbases.",
      );
    }

    // 8. PREVENT DUPLICATE AUTH USER
    try {
      await auth.getUserByEmail(cleanEmail);
      throw new HttpsError(
        "already-exists",
        "A user with this email already exists.",
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      if (err?.code !== "auth/user-not-found") {
        throw new HttpsError("internal", err.message);
      }
    }

    // 9. CREATE AUTH USER
    const tempPassword = "password";
    console.log("inviteManagerUser --tempPassword", tempPassword);

    const userRecord = await auth.createUser({
      email: cleanEmail,
      password: tempPassword,
      displayName,
    });
    console.log("inviteManagerUser --userRecord", userRecord);

    const now = new Date().toISOString();
    const creatorName =
      caller.token?.name ||
      caller.displayName ||
      callerData?.profile?.displayName ||
      "System";

    // 10. CREATE USER DOC
    await db
      .collection("users")
      .doc(userRecord.uid)
      .set({
        uid: userRecord.uid,

        profile: {
          email: cleanEmail,
          name: cleanName,
          surname: cleanSurname,
          displayName,
        },

        contact: {
          cell: "NAv",
        },

        employment: {
          role: "MNG",
          serviceProvider: {
            id: mnc.id,
            name: mnc.name,
          },
        },

        access: {
          workbases: inheritedWorkbases,
          activeWorkbase: null,
        },

        accountStatus: "ACTIVE",

        onboarding: {
          status: "PENDING",
          mustChangePassword: true,
        },

        metadata: {
          createdAt: now,
          createdByUid: caller.uid,
          createdByUser: creatorName,
          updatedAt: now,
          updatedByUid: caller.uid,
          updatedByUser: creatorName,
        },
      });

    logger.log(
      `SUCCESS: Manager [${userRecord.uid}] created under SP [${mnc.id}] with ${inheritedWorkbases.length} inherited workbases.`,
    );

    return {
      success: true,
      uid: userRecord.uid,
      message: "Manager created successfully.",
    };
  } catch (error) {
    logger.error("inviteManagerUser Error:", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      error.message || "Could not create manager.",
    );
  }
});

export const inviteSupervisorUser = onCall(async (request) => {
  const { auth: caller, data } = request;

  // 1. AUTH GUARD
  if (!caller) {
    throw new HttpsError(
      "unauthenticated",
      "Mission denied: Authentication required.",
    );
  }

  const { email, name, surname, serviceProvider } = data || {};

  // 2. BASIC INPUT VALIDATION
  if (
    !email ||
    !name ||
    !surname ||
    !serviceProvider?.id ||
    !serviceProvider?.name
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Email, name, surname and service provider are required.",
    );
  }

  const cleanEmail = String(email).toLowerCase().trim();
  const cleanName = normalizeName(name);
  const cleanSurname = normalizeName(surname);
  const displayName = `${cleanName} ${cleanSurname}`;

  try {
    // 3. LOAD CALLER USER DOC
    const callerSnap = await db.collection("users").doc(caller.uid).get();

    if (!callerSnap.exists) {
      throw new HttpsError(
        "permission-denied",
        "Mission denied: Caller profile not found.",
      );
    }

    const callerData = callerSnap.data() || {};
    const callerRole = String(callerData?.employment?.role || "").trim();
    const callerServiceProvider = callerData?.employment?.serviceProvider || {};
    const callerServiceProviderId = String(
      callerServiceProvider?.id || "",
    ).trim();

    // 4. ONLY MNG MAY CREATE SPV
    if (callerRole !== "MNG") {
      throw new HttpsError(
        "permission-denied",
        "Mission denied: Only MNG may create a supervisor.",
      );
    }

    if (!callerServiceProviderId) {
      throw new HttpsError(
        "failed-precondition",
        "Caller is not linked to a valid service provider.",
      );
    }

    // 5. LOAD ALL SERVICE PROVIDERS
    const spSnapshot = await db.collection("serviceProviders").get();
    const allServiceProviders = spSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // 6. LOAD SELECTED SERVICE PROVIDER
    const selectedServiceProvider = allServiceProviders.find(
      (item) => item?.id === serviceProvider.id,
    );

    if (!selectedServiceProvider) {
      throw new HttpsError(
        "not-found",
        "Selected service provider was not found.",
      );
    }

    const selectedSpStatus = String(
      selectedServiceProvider?.status || "",
    ).toUpperCase();

    if (selectedSpStatus !== "ACTIVE") {
      throw new HttpsError(
        "failed-precondition",
        "Selected service provider is not active.",
      );
    }

    // 7. VALIDATE SELECTED PROVIDER IS WITHIN THE MNG TREE
    const allowedServiceProviderIds = collectMngTreeServiceProviderIds(
      callerServiceProviderId,
      allServiceProviders,
    );

    if (!allowedServiceProviderIds.includes(selectedServiceProvider.id)) {
      throw new HttpsError(
        "permission-denied",
        "Selected service provider is outside the manager structure.",
      );
    }

    // 8. RESOLVE INHERITED WORKBASES
    const inheritedWorkbases = resolveServiceProviderWorkbases(
      selectedServiceProvider.id,
      allServiceProviders,
    );

    if (inheritedWorkbases.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "Selected service provider has no inherited workbases to assign.",
      );
    }

    // 9. PREVENT DUPLICATE AUTH USER
    try {
      await auth.getUserByEmail(cleanEmail);
      throw new HttpsError(
        "already-exists",
        "A user with this email already exists.",
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      if (err?.code !== "auth/user-not-found") {
        throw new HttpsError("internal", err.message);
      }
    }

    // 10. CREATE AUTH USER
    const tempPassword = "password";
    console.log("inviteSupervisorUser --tempPassword", tempPassword);

    const userRecord = await auth.createUser({
      email: cleanEmail,
      password: tempPassword,
      displayName,
    });
    console.log("inviteSupervisorUser --userRecord", userRecord);

    const now = new Date().toISOString();
    const creatorName =
      caller.token?.name ||
      caller.displayName ||
      callerData?.profile?.displayName ||
      "System";

    // 11. CREATE USER DOC
    await db
      .collection("users")
      .doc(userRecord.uid)
      .set({
        uid: userRecord.uid,

        profile: {
          email: cleanEmail,
          name: cleanName,
          surname: cleanSurname,
          displayName,
        },

        contact: {
          cell: "NAv",
        },

        employment: {
          role: "SPV",
          serviceProvider: {
            id: selectedServiceProvider.id,
            name:
              String(
                selectedServiceProvider?.profile?.tradingName || "",
              ).trim() ||
              String(serviceProvider?.name || "").trim() ||
              "NAv",
          },
        },

        access: {
          workbases: inheritedWorkbases,
          activeWorkbase: null,
        },

        accountStatus: "ACTIVE",

        onboarding: {
          status: "PENDING",
          mustChangePassword: true,
        },

        metadata: {
          createdAt: now,
          createdByUid: caller.uid,
          createdByUser: creatorName,
          updatedAt: now,
          updatedByUid: caller.uid,
          updatedByUser: creatorName,
        },
      });

    logger.log(
      `SUCCESS: Supervisor [${userRecord.uid}] created under SP [${selectedServiceProvider.id}] with ${inheritedWorkbases.length} inherited workbases.`,
    );

    return {
      success: true,
      uid: userRecord.uid,
      message: "Supervisor created successfully.",
    };
  } catch (error) {
    logger.error("inviteSupervisorUser Error:", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      error.message || "Could not create supervisor.",
    );
  }
});

export const inviteAdminUser = onCall(async (request) => {
  const { auth: caller, data } = request;

  if (!caller) {
    throw new HttpsError("unauthenticated", "Mission denied.");
  }

  const { email, name, surname } = data;

  try {
    // 🛰️ 1. SCOUT THE REGISTRY: Fetch all available LMs
    const lmsSnapshot = await db.collection("lms").get();
    const allWorkbases = lmsSnapshot.docs
      .map((doc) => ({
        id: doc.id,
        name: doc.data().name || doc.id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // 🔑 2. AUTH PROVISIONING
    const tempPassword = "password";
    const userRecord = await auth.createUser({
      email,
      password: tempPassword,
      displayName: `${name} ${surname}`,
    });

    // 🏛️ 3. FIRESTORE PROVISIONING (The Global ADM Schema)
    await db
      .collection("users")
      .doc(userRecord.uid)
      .set({
        uid: userRecord.uid,
        profile: {
          email,
          name,
          surname,
          displayName: `${name} ${surname}`,
        },
        employment: {
          role: "ADM",
          level: 1,
          serviceProvider: { id: "smarsId", name: "Smars" },
        },
        access: {
          // 🎯 TARGET ACHIEVED: ADM now holds the entire list of LMs
          workbases: allWorkbases,
          // 🎯 Rule 3: Set a sensible default (e.g., Knysna or the first in list)
          activeWorkbase: allWorkbases[0] || null,
        },
        onboarding: {
          status: "AWAITING_INITIAL_SIGNUP",
        },
        metadata: {
          createdAt: new Date().toISOString(),
          createdByUser: caller.token?.name || "SPU Admin",
          createdByUid: caller.uid,
          updatedAt: new Date().toISOString(),
          updatedByUser: caller.token?.name || "SPU Admin",
          updatedByUid: caller.uid,
        },
        accountStatus: "ACTIVE",
      });

    logger.log(
      `SUCCESS: Global Administrator [${userRecord.uid}] created with ${allWorkbases.length} workbases.`,
    );

    return {
      success: true,
      uid: userRecord.uid,
      count: allWorkbases.length,
      message: "Global Administrator appointed with full jurisdiction.",
    };
  } catch (error) {
    logger.error("Appointment Error:", error);
    throw new HttpsError("internal", error.message);
  }
});

export const onMeterMasterUpdated = onDocumentUpdated(
  "meter_master/{meterNo}",
  async (event) => {
    logger.log("onMeterMasterUpdated ---- START");

    const normalizedMeterNo = event.params.meterNo;
    const before = event.data.before.data() || {};
    const after = event.data.after.data() || {};

    const beforeAstId = before?.refs?.asts?.id || null;
    const beforeSalesId = before?.refs?.sales?.id || null;
    const afterAstId = after?.refs?.asts?.id || null;
    const afterSalesId = after?.refs?.sales?.id || null;

    const beforeVisibility = deriveMasterVisibility(before);
    const afterVisibility = deriveMasterVisibility(after);

    const refsChanged =
      beforeAstId !== afterAstId || beforeSalesId !== afterSalesId;

    const visibilityChanged = beforeVisibility !== afterVisibility;

    if (!refsChanged && !visibilityChanged) {
      logger.log("onMeterMasterUpdated ---- no relevant bridge change", {
        normalizedMeterNo,
      });
      return null;
    }

    const updatedAt = after?.metadata?.updatedAt || new Date().toISOString();
    const updatedByUid = after?.metadata?.updatedByUid || "system";
    const updatedByUser = after?.metadata?.updatedByUser || "system";

    try {
      await db.runTransaction(async (tx) => {
        const salesRef = db
          .collection("sales-all-meters")
          .doc(normalizedMeterNo);
        const salesSnap = await tx.get(salesRef);

        await syncSalesAllMetersFromMaster({
          tx,
          normalizedMeterNo,
          masterData: after,
          salesSnap,
          updatedAt,
          updatedByUid,
          updatedByUser,
        });
      });

      logger.log("onMeterMasterUpdated ---- SUCCESS", {
        normalizedMeterNo,
        visibility: afterVisibility,
      });

      return { success: true };
    } catch (error) {
      logger.error("onMeterMasterUpdated ---- FATAL ERROR:", error);
      return null;
    }
  },
);

export const signupFieldWorker = onCall(async (request) => {
  const { data } = request;

  const { email, password, name, surname, serviceProvider } = data || {};

  // 1. BASIC INPUT VALIDATION
  if (
    !email ||
    !password ||
    !name ||
    !surname ||
    !serviceProvider?.id ||
    !serviceProvider?.name
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Email, password, name, surname and service provider are required.",
    );
  }

  const cleanEmail = String(email).toLowerCase().trim();
  const cleanPassword = String(password || "").trim();
  const cleanName = normalizeName(name);
  const cleanSurname = normalizeName(surname);
  const displayName = `${cleanName} ${cleanSurname}`;

  if (cleanPassword.length < 6) {
    throw new HttpsError(
      "invalid-argument",
      "Password must be at least 6 characters.",
    );
  }

  try {
    // 2. LOAD ALL SERVICE PROVIDERS
    const spSnapshot = await db.collection("serviceProviders").get();
    const allServiceProviders = spSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // 3. LOAD SELECTED SERVICE PROVIDER
    const selectedServiceProvider = allServiceProviders.find(
      (item) => item?.id === serviceProvider.id,
    );

    if (!selectedServiceProvider) {
      throw new HttpsError(
        "not-found",
        "Selected service provider was not found.",
      );
    }

    const selectedSpStatus = String(
      selectedServiceProvider?.status || "",
    ).toUpperCase();

    if (selectedSpStatus !== "ACTIVE") {
      throw new HttpsError(
        "failed-precondition",
        "Selected service provider is not active.",
      );
    }

    // 4. RESOLVE RESPONSIBLE MNG
    const usersSnapshot = await db.collection("users").get();
    const allUsers = usersSnapshot.docs.map((doc) => ({
      uid: doc.id,
      ...doc.data(),
    }));

    let responsibleMng = null;

    for (const candidate of allUsers) {
      const candidateRole = String(candidate?.employment?.role || "").trim();
      const candidateSpId = String(
        candidate?.employment?.serviceProvider?.id || "",
      ).trim();

      if (candidateRole !== "MNG" || !candidateSpId) continue;

      const candidateTreeIds = collectMngTreeServiceProviderIds(
        candidateSpId,
        allServiceProviders,
        new Set(),
      );

      if (candidateTreeIds.includes(selectedServiceProvider.id)) {
        responsibleMng = candidate;
        break;
      }
    }

    if (!responsibleMng) {
      throw new HttpsError(
        "failed-precondition",
        "No responsible manager was found for the selected service provider.",
      );
    }

    // 5. PREVENT DUPLICATE AUTH USER
    try {
      await auth.getUserByEmail(cleanEmail);
      throw new HttpsError(
        "already-exists",
        "A user with this email already exists.",
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      if (err?.code !== "auth/user-not-found") {
        throw new HttpsError("internal", err.message);
      }
    }

    // 6. CREATE AUTH USER
    const userRecord = await auth.createUser({
      email: cleanEmail,
      password: cleanPassword,
      displayName,
    });

    console.log("signupFieldWorker ----userRecord", userRecord);

    const now = new Date().toISOString();

    // 7. CREATE PENDING FWR USER DOC (STANDARD USER SHAPE)
    await db
      .collection("users")
      .doc(userRecord.uid)
      .set({
        uid: userRecord.uid,

        profile: {
          email: cleanEmail,
          name: cleanName,
          surname: cleanSurname,
          displayName,
        },

        contact: {
          cell: "NAv",
        },

        employment: {
          role: "FWR",
          serviceProvider: {
            id: selectedServiceProvider.id,
            name:
              String(
                selectedServiceProvider?.profile?.tradingName || "",
              ).trim() ||
              String(serviceProvider?.name || "").trim() ||
              "NAv",
          },
        },

        access: {
          workbases: [],
          activeWorkbase: null,
        },

        accountStatus: "PENDING",

        onboarding: {
          mustChangePassword: false,
          status: "AWAITING-MNG-CONFIRMATION",
        },

        metadata: {
          createdAt: now,
          createdByUid: userRecord.uid,
          createdByUser: displayName,
          updatedAt: now,
          updatedByUid: userRecord.uid,
          updatedByUser: displayName,
        },
      });

    logger.log("signupFieldWorker ---- responsibleMng", {
      uid: responsibleMng?.uid || "NAv",
      email: responsibleMng?.profile?.email || "NAv",
      displayName: responsibleMng?.profile?.displayName || "NAv",
      selectedServiceProviderId: selectedServiceProvider.id,
    });

    // 8. EMAIL PLACEHOLDER
    // TODO: send email to responsibleMng.profile.email
    // telling them there is a pending FWR awaiting authorization

    logger.log(
      `SUCCESS: Field Worker [${userRecord.uid}] signed up under SP [${selectedServiceProvider.id}] and is awaiting MNG confirmation.`,
    );

    return {
      success: true,
      uid: userRecord.uid,
      message: "Signup submitted successfully. Awaiting manager authorization.",
    };
  } catch (error) {
    logger.error("signupFieldWorker Error:", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      error.message || "Could not complete field worker signup.",
    );
  }
});

export const authorizeFieldWorker = onCall(async (request) => {
  const { auth: caller, data } = request;

  // 1. AUTH GUARD
  if (!caller) {
    throw new HttpsError(
      "unauthenticated",
      "Mission denied: Authentication required.",
    );
  }

  const { uid } = data || {};

  if (!uid) {
    throw new HttpsError("invalid-argument", "Field worker uid is required.");
  }

  try {
    // 2. LOAD CALLER USER DOC
    const callerSnap = await db.collection("users").doc(caller.uid).get();

    if (!callerSnap.exists) {
      throw new HttpsError(
        "permission-denied",
        "Mission denied: Caller profile not found.",
      );
    }

    const callerData = callerSnap.data() || {};
    const callerRole = String(callerData?.employment?.role || "").trim();
    const callerServiceProviderId = String(
      callerData?.employment?.serviceProvider?.id || "",
    ).trim();

    // 3. ONLY MNG MAY AUTHORIZE FWR
    if (callerRole !== "MNG") {
      throw new HttpsError(
        "permission-denied",
        "Mission denied: Only MNG may authorize field workers.",
      );
    }

    if (!callerServiceProviderId) {
      throw new HttpsError(
        "failed-precondition",
        "Caller is not linked to a valid service provider.",
      );
    }

    // 4. LOAD TARGET USER
    const recruitRef = db.collection("users").doc(uid);
    const recruitSnap = await recruitRef.get();

    if (!recruitSnap.exists) {
      throw new HttpsError("not-found", "Field worker was not found.");
    }

    const recruit = recruitSnap.data() || {};
    const recruitRole = String(recruit?.employment?.role || "").trim();
    const recruitAccountStatus = String(recruit?.accountStatus || "").trim();
    const recruitOnboardingStatus = String(
      recruit?.onboarding?.status || "",
    ).trim();
    const recruitServiceProviderId = String(
      recruit?.employment?.serviceProvider?.id || "",
    ).trim();

    if (recruitRole !== "FWR") {
      throw new HttpsError(
        "failed-precondition",
        "Selected user is not a field worker.",
      );
    }

    if (!recruitServiceProviderId) {
      throw new HttpsError(
        "failed-precondition",
        "Field worker is not linked to a valid service provider.",
      );
    }

    if (
      recruitAccountStatus !== "PENDING" &&
      recruitOnboardingStatus !== "AWAITING-MNG-CONFIRMATION"
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Field worker is not awaiting manager confirmation.",
      );
    }

    // 5. LOAD ALL SERVICE PROVIDERS
    const spSnapshot = await db.collection("serviceProviders").get();
    const allServiceProviders = spSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // 6. CONFIRM RECRUIT'S SP IS INSIDE CALLER MNG TREE
    const allowedServiceProviderIds = collectMngTreeServiceProviderIds(
      callerServiceProviderId,
      allServiceProviders,
      new Set(),
    );

    if (!allowedServiceProviderIds.includes(recruitServiceProviderId)) {
      throw new HttpsError(
        "permission-denied",
        "This field worker is outside the manager structure.",
      );
    }

    // 7. RESOLVE INHERITED WORKBASES
    const resolvedWorkbases = resolveServiceProviderWorkbases(
      recruitServiceProviderId,
      allServiceProviders,
      new Set(),
    );

    if (resolvedWorkbases.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "No inherited workbases were resolved for this field worker.",
      );
    }

    const now = new Date().toISOString();
    const approverName =
      callerData?.profile?.displayName || caller.token?.name || "System";

    // 8. AUTHORIZE FIELD WORKER
    await recruitRef.update({
      accountStatus: "ACTIVE",
      "access.workbases": resolvedWorkbases,
      "access.activeWorkbase": null,
      "onboarding.status": "WORKBASE_REQUIRED",
      "metadata.updatedAt": now,
      "metadata.updatedByUid": caller.uid,
      "metadata.updatedByUser": approverName,
    });

    logger.log(
      `SUCCESS: Field Worker [${uid}] authorized by MNG [${caller.uid}] with ${resolvedWorkbases.length} workbases.`,
    );

    return {
      success: true,
      uid,
      message: "Field worker authorized successfully.",
    };
  } catch (error) {
    logger.error("authorizeFieldWorker Error:", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      error.message || "Could not authorize field worker.",
    );
  }
});

const buildFailureResult = (code, message) => ({
  success: false,
  code: code || "UNKNOWN_ERROR",
  message: message || "Unknown error",
  trnId: "NAv",
});

const buildSuccessResult = (trnId, message = "TRN created successfully") => ({
  success: true,
  code: "SUCCESS",
  message,
  trnId: trnId || "NAv",
});

export const onMeterDiscoveryCallable = onCall(async (request) => {
  try {
    const data = request?.data || {};
    const trnId = data?.id || "NAv";
    const meterType = data?.meterType || "NAv";
    const hasAccess = data?.accessData?.access?.hasAccess || "no";
    const meterNoRaw = data?.ast?.astData?.astNo || "";
    const meterNoNormalized = normalizeMeterNo(meterNoRaw);

    logger.info("onMeterDiscoveryCallable --start", {
      trnId,
      meterType,
      hasAccess,
      meterNoRaw,
      meterNoNormalized,
    });

    if (!data?.id) {
      return buildFailureResult("INVALID_TRN_ID", "TRN id is required");
    }

    if (!data?.accessData) {
      return buildFailureResult(
        "INVALID_ACCESS_DATA",
        "accessData is required",
      );
    }

    if (data?.accessData?.trnType !== "METER_DISCOVERY") {
      return buildFailureResult(
        "INVALID_TRN_TYPE",
        "trnType must be METER_DISCOVERY",
      );
    }

    if (!["water", "electricity", "NA"].includes(meterType)) {
      return buildFailureResult("INVALID_METER_TYPE", "Invalid meterType");
    }

    if (!["yes", "no"].includes(hasAccess)) {
      return buildFailureResult(
        "INVALID_ACCESS_VALUE",
        "accessData.access.hasAccess must be yes or no",
      );
    }

    if (hasAccess === "no" && meterType !== "NA") {
      return buildFailureResult(
        "INVALID_NO_ACCESS_METER_TYPE",
        "No-access submissions must use meterType NA",
      );
    }

    if (hasAccess === "yes" && !["water", "electricity"].includes(meterType)) {
      return buildFailureResult(
        "INVALID_ACCESS_METER_TYPE",
        "Access submissions must use water or electricity meterType",
      );
    }

    if (hasAccess === "yes" && !meterNoNormalized) {
      logger.info("onMeterDiscoveryCallable -- INVALID_METER_NUMBER", {
        trnId: data.id,
      });

      return buildFailureResult(
        "INVALID_METER_NUMBER",
        "Meter number is required when access is yes",
      );
    }

    // ------------------------------------------------------------
    // 0. PREMISE EXISTENCE GATEKEEPER
    // Meter discovery must point to a real saved premise
    // ------------------------------------------------------------
    const premiseId = data?.accessData?.premise?.id || "";

    if (!premiseId || premiseId === "NAv") {
      logger.warn("onMeterDiscoveryCallable --invalid premise id", {
        trnId,
        premiseId,
      });

      return buildFailureResult(
        "INVALID_PREMISE_ID",
        "A valid saved premise id is required before meter discovery can be submitted",
      );
    }

    const premiseRef = db.collection("premises").doc(premiseId);
    const premiseSnap = await premiseRef.get();

    if (!premiseSnap.exists) {
      logger.warn("onMeterDiscoveryCallable --premise not found", {
        trnId,
        premiseId,
      });

      return buildFailureResult(
        "PREMISE_NOT_FOUND",
        "Parent premise does not exist in premises collection",
      );
    }

    const trnRef = db.collection("trns").doc(data.id);
    const trnSnap = await trnRef.get();

    if (trnSnap.exists) {
      logger.info("onMeterDiscoveryCallable --trn already exists", {
        trnId: data.id,
      });

      return buildSuccessResult(
        data.id,
        "TRN already exists and is treated as successful",
      );
    }

    // ------------------------------------------------------------
    // 1. MASTER DUPLICATE GATEKEEPER
    // Only check duplicate for real meter discovery with access
    // ------------------------------------------------------------
    if (hasAccess === "yes" && meterNoNormalized) {
      const masterRef = db.collection("meter_master").doc(meterNoNormalized);
      const masterSnap = await masterRef.get();

      logger.info("onMeterDiscoveryCallable --master check", {
        trnId,
        meterNoNormalized,
        masterExists: masterSnap.exists,
      });

      if (masterSnap.exists) {
        const masterData = masterSnap.data() || {};
        const existingAstId = masterData?.refs?.asts?.id || "";

        if (existingAstId) {
          logger.warn("onMeterDiscoveryCallable --duplicate blocked", {
            trnId,
            meterNoNormalized,
            existingAstId,
          });

          return buildFailureResult(
            "DUPLICATE_METER",
            "Meter already linked to an existing AST",
          );
        }
      }
    }

    // ------------------------------------------------------------
    // 2. CREATE / UPSERT TRN
    // This callable is the gatekeeper before TRN creation
    // ------------------------------------------------------------

    const safePayload = JSON.parse(
      JSON.stringify(data, (key, value) =>
        value === undefined ? null : value,
      ),
    );

    const finalPayload = {
      ...safePayload,
    };

    await trnRef.set(finalPayload, { merge: true });

    logger.info("onMeterDiscoveryCallable --trn saved", {
      trnId: data.id,
      meterType,
      hasAccess,
    });

    return buildSuccessResult(data.id);
  } catch (error) {
    logger.error("onMeterDiscoveryCallable --error", {
      message: error?.message,
      stack: error?.stack,
    });

    return buildFailureResult(
      "UNKNOWN_ERROR",
      error?.message || "Failed to submit meter discovery transaction",
    );
  }
});

function getAstScope(astData = {}) {
  return {
    lmPcode: astData?.accessData?.parents?.lmPcode || null,
    wardPcode: astData?.accessData?.parents?.wardPcode || null,
  };
}

function getAstAuditContext(astData = {}) {
  const metadata = astData?.metadata || {};

  return {
    auditUid: metadata?.updatedByUid || metadata?.createdByUid || "SYSTEM",
    auditUser: metadata?.updatedByUser || metadata?.createdByUser || "SYSTEM",
  };
}

function normalizeAstGeoFenceRefs(refs = []) {
  return normalizeGeoFenceRefs(Array.isArray(refs) ? refs : []);
}

function geoFenceRefsSignature(refs = []) {
  return normalizeAstGeoFenceRefs(refs)
    .map((ref) => `${ref.id}:${ref.name || ""}`)
    .sort()
    .join("|");
}

function geoFenceRefsSame(left = [], right = []) {
  return geoFenceRefsSignature(left) === geoFenceRefsSignature(right);
}

function getGeoFenceRefIds(refs = []) {
  return [
    ...new Set(
      normalizeAstGeoFenceRefs(refs)
        .map((ref) => ref?.id || null)
        .filter((id) => id && id !== "NAv"),
    ),
  ];
}

function unionGeoFenceRefIds(...refLists) {
  return [
    ...new Set(refLists.flatMap((refs) => getGeoFenceRefIds(refs || []))),
  ];
}

function getAstPointSignature(astData = {}) {
  const point = extractAstPoint(astData);

  if (!point) return "NO_POINT";

  const lat = Number(point.lat);
  const lng = Number(point.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return "NO_POINT";
  }

  return `${lat.toFixed(8)},${lng.toFixed(8)}`;
}

function getAstSpatialSignature(astData = {}) {
  const { lmPcode, wardPcode } = getAstScope(astData);

  return [
    lmPcode || "NO_LM",
    wardPcode || "NO_WARD",
    getAstPointSignature(astData),
  ].join("|");
}

function didAstSpatialContextChange(before = {}, after = {}) {
  return getAstSpatialSignature(before) !== getAstSpatialSignature(after);
}

async function safeRun(label, entityId, fn) {
  try {
    return await fn();
  } catch (error) {
    logger.error(`${label} -- ERROR`, {
      entityId,
      message: error?.message || String(error),
      stack: error?.stack || "NAv",
    });

    return null;
  }
}

async function resolveAstGeoFenceRefs({ db, astId, astData }) {
  const { lmPcode, wardPcode } = getAstScope(astData);
  const astPoint = extractAstPoint(astData);

  if (!lmPcode || !wardPcode) {
    logger.warn("resolveAstGeoFenceRefs -- missing LM/Ward", {
      astId,
      lmPcode,
      wardPcode,
    });

    return [];
  }

  if (!astPoint) {
    logger.warn("resolveAstGeoFenceRefs -- missing AST point", {
      astId,
    });

    return [];
  }

  const geoFenceSnapshot = await db
    .collection("geo_fences")
    .where("parents.lmPcode", "==", lmPcode)
    .where("parents.wardPcode", "==", wardPcode)
    .where("status", "==", "ACTIVE")
    .get();

  const matchedGeoFences = [];

  for (const geoFenceDoc of geoFenceSnapshot.docs) {
    const geoFence = geoFenceDoc.data() || {};
    const bbox = geoFence?.geometry?.bbox || null;
    const polygonPoints = geoFence?.geometry?.points || [];

    if (!bbox || polygonPoints.length < 3) continue;

    const belongs = doesEntityBelongToGeoFence({
      point: astPoint,
      bbox,
      polygonPoints,
    });

    if (!belongs) continue;

    matchedGeoFences.push({
      id: geoFenceDoc.id,
      name: geoFence?.name || geoFence?.description || geoFenceDoc.id,
    });
  }

  return normalizeGeoFenceRefs(matchedGeoFences);
}

async function recomputeGeoFenceCountsForIds({
  db,
  geoFenceIds = [],
  auditUid = "SYSTEM",
  auditUser = "SYSTEM",
}) {
  const uniqueGeoFenceIds = [...new Set((geoFenceIds || []).filter(Boolean))];

  for (const geoFenceId of uniqueGeoFenceIds) {
    const geoFenceRef = db.collection("geo_fences").doc(geoFenceId);
    const geoFenceSnap = await geoFenceRef.get();

    if (!geoFenceSnap.exists) {
      logger.warn("recomputeGeoFenceCountsForIds -- geofence missing", {
        geoFenceId,
      });
      continue;
    }

    const geoFence = geoFenceSnap.data() || {};
    const lmPcode = geoFence?.parents?.lmPcode || null;
    const wardPcode = geoFence?.parents?.wardPcode || null;

    if (!lmPcode || !wardPcode) {
      logger.warn("recomputeGeoFenceCountsForIds -- missing scope", {
        geoFenceId,
        lmPcode,
        wardPcode,
      });
      continue;
    }

    const counts = await recomputeGeoFenceCounts({
      db,
      geoFenceId,
      lmPcode,
      wardPcode,
    });

    await geoFenceRef.update({
      counts,
      "metadata.updatedAt": new Date().toISOString(),
      "metadata.updatedByUid": auditUid,
      "metadata.updatedByUser": auditUser,
    });

    logger.info("recomputeGeoFenceCountsForIds -- updated", {
      geoFenceId,
      counts,
    });
  }
}

async function syncAstGeoFenceMembership({
  snap,
  astId,
  astData,
  previousGeoFenceRefs = null,
}) {
  const db = getFirestore();

  const { auditUid, auditUser } = getAstAuditContext(astData);

  const currentGeoFenceRefs = normalizeAstGeoFenceRefs(
    Array.isArray(previousGeoFenceRefs)
      ? previousGeoFenceRefs
      : astData?.geofenceRefs,
  );

  const nextGeoFenceRefs = await resolveAstGeoFenceRefs({
    db,
    astId,
    astData,
  });

  const affectedGeoFenceIds = unionGeoFenceRefIds(
    currentGeoFenceRefs,
    nextGeoFenceRefs,
  );

  if (!geoFenceRefsSame(currentGeoFenceRefs, nextGeoFenceRefs)) {
    await snap.ref.update({
      geofenceRefs: nextGeoFenceRefs,
      "metadata.updatedAt": new Date().toISOString(),
      "metadata.updatedByUid": auditUid,
      "metadata.updatedByUser": auditUser,
    });

    logger.info("syncAstGeoFenceMembership -- AST membership updated", {
      astId,
      geofenceRefs: nextGeoFenceRefs,
    });
  } else {
    logger.info("syncAstGeoFenceMembership -- AST membership unchanged", {
      astId,
      geofenceRefs: nextGeoFenceRefs,
    });
  }

  await recomputeGeoFenceCountsForIds({
    db,
    geoFenceIds: affectedGeoFenceIds,
    auditUid,
    auditUser,
  });

  return {
    geofenceRefs: nextGeoFenceRefs,
    affectedGeoFenceIds,
  };
}



/* ------------------------------------------------
   TC ROW UPDATE AFTER METER GEOFENCE CHANGED
   ------------------------------------------------ */

const TC_TRUTH_SYSTEM_UID = "SYSTEM";
const TC_TRUTH_SYSTEM_USER = "Meter Truth TC Readiness Update";

function normalizeTcText(value) {
  return String(value || "").trim();
}

function normalizeTcUpper(value) {
  return normalizeTcText(value).toUpperCase();
}

function hasMeaningfulTcValue(value) {
  const normalizedValue = normalizeTcUpper(value);

  return (
    normalizedValue !== "" &&
    normalizedValue !== "NAV" &&
    normalizedValue !== "N/A" &&
    normalizedValue !== "NA" &&
    normalizedValue !== "NULL" &&
    normalizedValue !== "UNDEFINED"
  );
}

function getTcIdFromRow(rowData = {}) {
  return (
    rowData?.tcId ||
    rowData?.upload?.tcId ||
    rowData?.upload?.id ||
    rowData?.tcUploadId ||
    "NAv"
  );
}

function getTcRowTrnType(rowData = {}) {
  return normalizeTcUpper(
    rowData?.backend?.trnType ||
      rowData?.upload?.trnType ||
      rowData?.trnType ||
      "",
  );
}

function getTcBackendErrorsAfterEligibility({ rowData = {}, eligibility = {} }) {
  const currentErrors = Array.isArray(rowData?.backend?.errors)
    ? rowData.backend.errors
    : [];

  const nonEligibilityErrors = currentErrors.filter((error) => {
    const text = normalizeTcUpper(error);

    if (!text) return false;

    return !(
      text.includes("CANNOT BE SELECTED FOR METER_") ||
      (text.includes("METER IS ") && text.includes("CANNOT BE SELECTED")) ||
      text.includes("METER STATUS COULD NOT BE RESOLVED") ||
      text.includes("NOT ELIGIBLE FOR THE SELECTED OPERATION")
    );
  });

  if (!eligibility?.eligible && eligibility?.message) {
    nonEligibilityErrors.push(eligibility.message);
  }

  return nonEligibilityErrors;
}

function getAstMeterNo(astData = {}) {
  return normalizeMeterNo(
    astData?.ast?.astData?.astNo ||
      astData?.astData?.astNo ||
      astData?.master?.id ||
      astData?.meterNo ||
      "",
  );
}

function getAstMeterTypeForTc(astData = {}) {
  return (
    astData?.meterType ||
    astData?.ast?.meterType ||
    astData?.ast?.astData?.meterType ||
    astData?.astData?.meterType ||
    "NAv"
  );
}

function addTcAstLinkQuerySpec(querySpecs, field, value) {
  if (!hasMeaningfulTcValue(value)) return;

  const key = `${field}:${value}`;

  if (querySpecs.some((item) => item.key === key)) return;

  querySpecs.push({ key, field, value });
}

async function findInFlightTcRowsForAstId({ db, astId }) {
  const querySpecs = [];

  addTcAstLinkQuerySpec(querySpecs, "ast.id", astId);
  addTcAstLinkQuerySpec(querySpecs, "ast.astId", astId);
  addTcAstLinkQuerySpec(querySpecs, "ast.trnId", astId);
  addTcAstLinkQuerySpec(querySpecs, "backend.astId", astId);
  addTcAstLinkQuerySpec(querySpecs, "backend.matchedAstId", astId);
  addTcAstLinkQuerySpec(querySpecs, "matchedAstId", astId);

  const rowDocMap = new Map();

  for (const spec of querySpecs) {
    try {
      const snapshot = await db
        .collection("tc_rows")
        .where(spec.field, "==", spec.value)
        .limit(1000)
        .get();

      logger.info("findInFlightTcRowsForAstId -- query", {
        astId,
        field: spec.field,
        value: spec.value,
        count: snapshot.size,
      });

      snapshot.docs.forEach((doc) => {
        const rowData = doc.data() || {};

        if (isTcRowUsedByBgo(rowData)) return;

        rowDocMap.set(doc.id, doc);
      });
    } catch (error) {
      logger.warn("findInFlightTcRowsForAstId -- query skipped", {
        astId,
        field: spec.field,
        value: spec.value,
        message: error?.message || String(error),
      });
    }
  }

  const rows = Array.from(rowDocMap.values());

  logger.info("findInFlightTcRowsForAstId -- candidates", {
    astId,
    candidateRows: rows.length,
  });

  return rows;
}

function resolveTcMeterTruthChangeReason({
  statusChanged = false,
  geofenceRefsChanged = false,
  activeLifecycleChanged = false,
  meterTypeChanged = false,
  astNoChanged = false,
} = {}) {
  const reasons = [];

  if (statusChanged) reasons.push("METER_STATUS_CHANGED");
  if (geofenceRefsChanged) reasons.push("METER_GEOFENCE_CHANGED");
  if (activeLifecycleChanged) reasons.push("METER_ACTIVE_LIFECYCLE_CHANGED");
  if (meterTypeChanged) reasons.push("METER_TYPE_CHANGED");
  if (astNoChanged) reasons.push("METER_NUMBER_CHANGED");

  return reasons.length ? reasons.join("+") : "METER_TRUTH_CHANGED";
}

async function updateTcRowsAfterMeterTruthChanged({
  astId,
  beforeStatus = "NAv",
  afterStatus = "NAv",
  afterAstData = {},
  changeReason = "METER_TRUTH_CHANGED",
}) {
  const db = getFirestore();
  const now = new Date().toISOString();
  const nextGeoFenceRefs = normalizeTcGeoFenceRefs(afterAstData?.geofenceRefs || []);
  const afterAstNo = getAstMeterNo(afterAstData);
  const afterMeterType = getAstMeterTypeForTc(afterAstData);

  logger.info("updateTcRowsAfterMeterTruthChanged -- START", {
    astId,
    beforeStatus,
    afterStatus,
    changeReason,
    geofenceRefsCount: nextGeoFenceRefs.length,
  });

  const candidateRows = await findInFlightTcRowsForAstId({ db, astId });

  if (candidateRows.length === 0) {
    logger.info("updateTcRowsAfterMeterTruthChanged -- no in-flight rows", {
      astId,
      beforeStatus,
      afterStatus,
      changeReason,
    });

    return {
      updatedRows: 0,
      affectedTcIds: [],
    };
  }

  const affectedTcIds = new Set();
  let batch = db.batch();
  let operationCount = 0;
  let updatedRows = 0;
  let skippedRows = 0;

  for (const rowDoc of candidateRows) {
    const rowData = rowDoc.data() || {};
    const tcId = getTcIdFromRow(rowData);

    if (rowData?.backend?.matched !== true) {
      skippedRows += 1;

      logger.info("updateTcRowsAfterMeterTruthChanged -- row skipped", {
        astId,
        tcRowId: rowDoc.id,
        tcId,
        reason: "ROW_NOT_MATCHED",
        changeReason,
      });

      continue;
    }

    const trnType = getTcRowTrnType(rowData);

    if (!hasMeaningfulTcValue(trnType)) {
      skippedRows += 1;

      logger.warn("updateTcRowsAfterMeterTruthChanged -- row missing trnType", {
        astId,
        tcRowId: rowDoc.id,
        tcId,
        changeReason,
      });

      continue;
    }

    const eligibility = getEligibilityResult({
      trnType,
      astData: afterAstData,
    });

    const activeLifecycle = getActiveSameOperationLifecycle({
      trnType,
      astData: afterAstData,
    });

    const nextBackend = {
      ...(rowData?.backend || {}),
      eligible: eligibility.eligible === true,
      notEligible: eligibility.eligible !== true,
      eligibilityCode: eligibility.code || null,
      eligibilityMessage: eligibility.message || null,
      alreadyHasActiveSameOperationTrn: Boolean(activeLifecycle),
      activeLifecycle,
      errors: getTcBackendErrorsAfterEligibility({ rowData, eligibility }),
      trnType,
    };

    const nextAstSummary = {
      ...(rowData?.ast || {}),
      id: astId,
      astId,
      astNo: afterAstNo,
      meterNo: afterAstNo,
      meterType: afterMeterType,
      statusState: afterStatus,
      geofenceRefs: nextGeoFenceRefs,
    };

    const nextRowForEvaluation = {
      ...rowData,
      ast: nextAstSummary,
      geofenceRefs: nextGeoFenceRefs,
      backend: nextBackend,
    };

    const beforeReady = rowData?.bgo?.ready === true;
    const beforeReadinessState = rowData?.bgo?.readinessState || "NAv";
    const beforeRowStatus = rowData?.ast?.statusState || "NAv";

    // IMPORTANT:
    // Do not manually set bgo.ready in multiple places.
    // Always run the official BGO readiness resolver so TC rows have one truth:
    // BGO READY or BGO NOT READY with a reason.
    const evaluatedRow = applyTcRowBgoReadiness({
      row: nextRowForEvaluation,
      geofenceRefs: nextGeoFenceRefs,
      now,
      updatedByUid: TC_TRUTH_SYSTEM_UID,
      updatedByUser: TC_TRUTH_SYSTEM_USER,
    });

    const patch = {
      geofenceRefs: evaluatedRow.geofenceRefs,
      ast: evaluatedRow.ast,
      backend: {
        ...(evaluatedRow?.backend || {}),
        refreshedFromAstAt: now,
        refreshReason: changeReason,
        statusRefresh: {
          beforeStatus,
          afterStatus,
        },
        meterTruthRefresh: {
          astNo: afterAstNo,
          meterType: afterMeterType,
          geofenceRefsCount: nextGeoFenceRefs.length,
          activeLifecycleChanged: changeReason.includes("ACTIVE_LIFECYCLE"),
        },
      },
      bgo: evaluatedRow.bgo,
      "metadata.updatedAt": now,
      "metadata.updatedByUid": TC_TRUTH_SYSTEM_UID,
      "metadata.updatedByUser": TC_TRUTH_SYSTEM_USER,
    };

    batch.update(rowDoc.ref, patch);
    operationCount += 1;
    updatedRows += 1;

    if (hasMeaningfulTcValue(tcId)) {
      affectedTcIds.add(tcId);
    }

    logger.info("updateTcRowsAfterMeterTruthChanged -- ROW_UPDATE", {
      astId,
      tcRowId: rowDoc.id,
      tcId,
      trnType,
      changeReason,
      beforeRowStatus,
      afterRowStatus: afterStatus,
      beforeReady,
      afterReady: evaluatedRow?.bgo?.ready === true,
      beforeReadinessState,
      afterReadinessState: evaluatedRow?.bgo?.readinessState || "NAv",
      eligibilityCode: eligibility.code || "NAv",
      eligibilityMessage: eligibility.message || "NAv",
      activeLifecycle: activeLifecycle || null,
      reasonCodes: evaluatedRow?.backend?.reasonCodes || [],
    });

    if (operationCount === 450) {
      await batch.commit();
      logger.info("updateTcRowsAfterMeterTruthChanged -- batch commit", {
        astId,
        operationCount,
      });
      batch = db.batch();
      operationCount = 0;
    }
  }

  if (operationCount > 0) {
    await batch.commit();
    logger.info("updateTcRowsAfterMeterTruthChanged -- final batch commit", {
      astId,
      operationCount,
    });
  }

  const tcUploadRefresh = await refreshTcUploadSummariesForTcIds({
    db,
    tcIds: Array.from(affectedTcIds),
    now,
    updatedByUid: TC_TRUTH_SYSTEM_UID,
    updatedByUser: TC_TRUTH_SYSTEM_USER,
  });

  logger.info("updateTcRowsAfterMeterTruthChanged -- upload summary refresh", {
    astId,
    ...tcUploadRefresh,
  });

  logger.info("updateTcRowsAfterMeterTruthChanged -- END", {
    astId,
    candidateRows: candidateRows.length,
    updatedRows,
    skippedRows,
    affectedTcIds: Array.from(affectedTcIds),
  });

  return {
    updatedRows,
    skippedRows,
    affectedTcIds: Array.from(affectedTcIds),
  };
}

export const onMeterCreated = onDocumentCreated(
  "asts/{astId}",
  async (event) => {
    const astId = event.params.astId;
    const snap = event.data;

    if (!snap?.exists) {
      console.log("onMeterCreated ---- no snapshot", { astId });
      return null;
    }

    const data = snap.data() || {};

    console.log("onMeterCreated ---- START", { astId });

    await safeRun("onMeterCreated geofence sync", astId, async () => {
      await syncAstGeoFenceMembership({
        snap,
        astId,
        astData: data,
        previousGeoFenceRefs: data?.geofenceRefs || [],
      });
    });

    await safeRun(
      "onMeterCreated premise service snapshot sync",
      astId,
      async () => {
        await syncPremiseServiceSnapshotFromMeter({
          astId,
          astData: data,
        });
      },
    );

    await safeRun("onMeterCreated meter registry rebuild", astId, async () => {
      await rebuildMeterRegistryRow(astId);
    });

    console.log("onMeterCreated ---- END", { astId });

    return null;
  },
);

export const onMeterUpdated = onDocumentUpdated(
  "asts/{astId}",
  async (event) => {
    const dataAfter = event.data.after.data() || {};
    const dataBefore = event.data.before.data() || {};
    const astId = event.params.astId;

    const beforeUpdatedAt = dataBefore?.metadata?.updatedAt || null;
    const afterUpdatedAt = dataAfter?.metadata?.updatedAt || null;

    const beforeStatus = getMeterStatusState(dataBefore);
    const afterStatus = getMeterStatusState(dataAfter);

    const beforeMeterType = getAstMeterTypeForTc(dataBefore);
    const afterMeterType = getAstMeterTypeForTc(dataAfter);

    const beforeAstNo = getAstMeterNo(dataBefore);
    const afterAstNo = getAstMeterNo(dataAfter);

    const beforeActiveLifecycleSignature = JSON.stringify(
      dataBefore?.trnActiveLifecycle || {},
    );
    const afterActiveLifecycleSignature = JSON.stringify(
      dataAfter?.trnActiveLifecycle || {},
    );

    const updatedAtChanged = beforeUpdatedAt !== afterUpdatedAt;
    const statusChanged = beforeStatus !== afterStatus;
    const spatialChanged = didAstSpatialContextChange(dataBefore, dataAfter);
    const meterTypeChanged = beforeMeterType !== afterMeterType;
    const astNoChanged = beforeAstNo !== afterAstNo;
    const activeLifecycleChanged =
      beforeActiveLifecycleSignature !== afterActiveLifecycleSignature;

    const geofenceRefsChanged = !geoFenceRefsSame(
      dataBefore?.geofenceRefs || [],
      dataAfter?.geofenceRefs || [],
    );

    if (
      !updatedAtChanged &&
      !statusChanged &&
      !spatialChanged &&
      !geofenceRefsChanged &&
      !meterTypeChanged &&
      !astNoChanged &&
      !activeLifecycleChanged
    ) {
      return null;
    }

    console.log("onMeterUpdated ---- START", {
      astId,
      beforeStatus,
      afterStatus,
      updatedAtChanged,
      statusChanged,
      spatialChanged,
      geofenceRefsChanged,
      meterTypeChanged,
      astNoChanged,
      activeLifecycleChanged,
    });

    await safeRun("onMeterUpdated geofence maintenance", astId, async () => {
      if (spatialChanged) {
        await syncAstGeoFenceMembership({
          snap: event.data.after,
          astId,
          astData: dataAfter,
          previousGeoFenceRefs: dataBefore?.geofenceRefs || [],
        });

        return;
      }

      if (statusChanged || geofenceRefsChanged) {
        const db = getFirestore();
        const { auditUid, auditUser } = getAstAuditContext(dataAfter);

        const affectedGeoFenceIds = unionGeoFenceRefIds(
          dataBefore?.geofenceRefs || [],
          dataAfter?.geofenceRefs || [],
        );

        await recomputeGeoFenceCountsForIds({
          db,
          geoFenceIds: affectedGeoFenceIds,
          auditUid,
          auditUser,
        });
      }
    });

    await safeRun("onMeterUpdated meter registry rebuild", astId, async () => {
      await rebuildMeterRegistryRow(astId);
    });

    if (statusChanged) {
      await safeRun(
        "onMeterUpdated premise service snapshot sync",
        astId,
        async () => {
          await syncPremiseServiceSnapshotFromMeter({
            astId,
            astData: dataAfter,
          });
        },
      );
    }

    const tcReadinessImpactChanged =
      statusChanged ||
      geofenceRefsChanged ||
      activeLifecycleChanged ||
      meterTypeChanged ||
      astNoChanged;

    if (tcReadinessImpactChanged) {
      await safeRun(
        "onMeterUpdated TC rows after meter truth changed",
        astId,
        async () => {
          await updateTcRowsAfterMeterTruthChanged({
            astId,
            beforeStatus,
            afterStatus,
            afterAstData: dataAfter,
            changeReason: resolveTcMeterTruthChangeReason({
              statusChanged,
              geofenceRefsChanged,
              activeLifecycleChanged,
              meterTypeChanged,
              astNoChanged,
            }),
          });
        },
      );
    }

    console.log("onMeterUpdated ---- END", { astId });

    return null;
  },
);

/* =====================================================
   HELPERS
   ===================================================== */

function normalizeClients(clients = []) {
  return Array.isArray(clients) ? clients : [];
}

function didClientsChange(beforeClients = [], afterClients = []) {
  return JSON.stringify(beforeClients) !== JSON.stringify(afterClients);
}

function isSubcontractorServiceProvider(serviceProvider = {}) {
  const clients = normalizeClients(serviceProvider?.clients);

  return clients.some(
    (client) =>
      client?.clientType === "SP" && client?.relationshipType === "SUBC",
  );
}

function deriveInheritedWorkbasesFromMncClients(clients = []) {
  const seenLmIds = new Set();

  return normalizeClients(clients)
    .filter((client) => {
      return client?.clientType === "LM" && client?.id && client?.name;
    })
    .map((client) => ({
      id: String(client.id).trim(),
      name: String(client.name).trim(),
    }))
    .filter((workbase) => {
      if (!workbase.id || seenLmIds.has(workbase.id)) return false;
      seenLmIds.add(workbase.id);
      return true;
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function findAffectedUsersInMncSphere(allowedSpIds = []) {
  const uniqueSpIds = [...new Set((allowedSpIds || []).filter(Boolean))];

  if (uniqueSpIds.length === 0) return [];

  const allUserDocs = [];

  for (const spId of uniqueSpIds) {
    const usersSnap = await db
      .collection("users")
      .where("employment.serviceProvider.id", "==", spId)
      .get();

    usersSnap.docs.forEach((doc) => {
      allUserDocs.push(doc);
    });
  }

  const seenUserIds = new Set();

  return allUserDocs.filter((userDoc) => {
    if (!userDoc?.id || seenUserIds.has(userDoc.id)) return false;
    seenUserIds.add(userDoc.id);
    return true;
  });
}

function isUserRoleEligibleForInheritedWorkbaseUpdate(userData = {}) {
  const role = userData?.employment?.role || "NAv";
  return role === "MNG" || role === "SPV" || role === "FWR";
}

function resolveNextActiveWorkbase(
  currentActiveWorkbase,
  inheritedWorkbases = [],
) {
  const activeWorkbaseStillValid = (inheritedWorkbases || []).some(
    (workbase) => workbase.id === currentActiveWorkbase?.id,
  );

  return activeWorkbaseStillValid ? currentActiveWorkbase : null;
}

async function updateInheritedUserWorkbases(
  userDocs = [],
  inheritedWorkbases = [],
) {
  const now = new Date().toISOString();
  const systemUpdaterUid = "SYSTEM";
  const systemUpdaterUser = "SP Workbase Sync";

  let batch = db.batch();
  let operationCount = 0;
  let updatedUsersCount = 0;

  for (const userDoc of userDocs) {
    const userData = userDoc.data() || {};

    if (!isUserRoleEligibleForInheritedWorkbaseUpdate(userData)) {
      logger.log(
        `updateInheritedUserWorkbases -- SKIP: user [${userDoc.id}] role not eligible.`,
        {
          role: userData?.employment?.role || "NAv",
        },
      );
      continue;
    }

    const currentActiveWorkbase = userData?.access?.activeWorkbase || null;
    const nextActiveWorkbase = resolveNextActiveWorkbase(
      currentActiveWorkbase,
      inheritedWorkbases,
    );

    const patch = {
      "access.workbases": inheritedWorkbases,
      "access.activeWorkbase": nextActiveWorkbase,
      "metadata.updatedAt": now,
      "metadata.updatedByUid": systemUpdaterUid,
      "metadata.updatedByUser": systemUpdaterUser,
    };

    batch.update(userDoc.ref, patch);
    operationCount += 1;
    updatedUsersCount += 1;

    logger.log(
      `updateInheritedUserWorkbases -- PATCHING USER [${userDoc.id}]`,
      {
        role: userData?.employment?.role || "NAv",
        serviceProviderId: userData?.employment?.serviceProvider?.id || "NAv",
        activeWorkbaseBefore: currentActiveWorkbase || null,
        activeWorkbaseAfter: nextActiveWorkbase,
        inheritedWorkbasesCount: inheritedWorkbases.length,
      },
    );

    if (operationCount === 450) {
      await batch.commit();
      logger.log(
        `updateInheritedUserWorkbases -- committed batch of ${operationCount} updates.`,
      );
      batch = db.batch();
      operationCount = 0;
    }
  }

  if (operationCount > 0) {
    await batch.commit();
    logger.log(
      `updateInheritedUserWorkbases -- committed final batch of ${operationCount} updates.`,
    );
  }

  return updatedUsersCount;
}

/* =====================================================
   TRIGGER
   ===================================================== */

export const onServiceProviderUpdated = onDocumentUpdated(
  "serviceProviders/{spId}",
  async (event) => {
    const spId = event.params.spId;

    try {
      const beforeSnap = event.data?.before;
      const afterSnap = event.data?.after;

      if (!afterSnap?.exists) {
        logger.log(
          `onServiceProviderUpdated -- SKIP: service provider [${spId}] no longer exists.`,
        );
        return;
      }

      const beforeData = beforeSnap?.data() || {};
      const afterData = afterSnap?.data() || {};

      const beforeClients = normalizeClients(beforeData?.clients);
      const afterClients = normalizeClients(afterData?.clients);

      // 1. EXIT EARLY IF CLIENTS DID NOT CHANGE
      if (!didClientsChange(beforeClients, afterClients)) {
        logger.log(
          `onServiceProviderUpdated -- SKIP: clients unchanged for SP [${spId}].`,
        );
        return;
      }

      // 2. ONLY MNC SPs DRIVE INHERITED WORKBASES
      const updatedSpIsSubc = isSubcontractorServiceProvider(afterData);

      if (updatedSpIsSubc) {
        logger.log(
          `onServiceProviderUpdated -- SKIP: SP [${spId}] is a SUBC. Workbase inheritance remains MNC-driven.`,
        );
        return;
      }

      // 3. DERIVE MNC WORKBASES FROM UPDATED LM CLIENTS
      const inheritedWorkbases =
        deriveInheritedWorkbasesFromMncClients(afterClients);

      logger.log(
        `onServiceProviderUpdated -- derived ${inheritedWorkbases.length} inherited workbases for MNC SP [${spId}].`,
        inheritedWorkbases,
      );

      // 4. LOAD ALL SERVICE PROVIDERS
      const serviceProvidersSnap = await db
        .collection("serviceProviders")
        .get();

      const allServiceProviders = serviceProvidersSnap.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() || {}),
      }));

      // 5. BUILD FULL MNC SPHERE USING EXISTING TREE LOGIC
      const allowedSpIds = collectMngTreeServiceProviderIds(
        spId,
        allServiceProviders,
        new Set(),
      );

      const subcSpIds = allowedSpIds.filter((id) => id !== spId);

      logger.log(
        `onServiceProviderUpdated -- found ${subcSpIds.length} SUBC SPs under MNC [${spId}].`,
        subcSpIds,
      );

      logger.log(
        `onServiceProviderUpdated -- allowed SP sphere for MNC [${spId}] has ${allowedSpIds.length} SPs.`,
        allowedSpIds,
      );

      // 6. FIND AFFECTED USERS IN MNC SPHERE
      const affectedUserDocs = await findAffectedUsersInMncSphere(allowedSpIds);

      if (affectedUserDocs.length === 0) {
        logger.log(
          `onServiceProviderUpdated -- SKIP: no users found in MNC sphere for SP [${spId}].`,
        );
        return;
      }

      logger.log(
        `onServiceProviderUpdated -- found ${affectedUserDocs.length} users in MNC sphere for SP [${spId}].`,
      );

      // 7. UPDATE INHERITED WORKBASES FOR MNG / SPV / FWR
      const updatedUsersCount = await updateInheritedUserWorkbases(
        affectedUserDocs,
        inheritedWorkbases,
      );

      logger.log(
        `SUCCESS: onServiceProviderUpdated updated ${updatedUsersCount} users for MNC SP [${spId}].`,
      );
    } catch (error) {
      logger.error(`onServiceProviderUpdated ERROR for SP [${spId}]`, error);
      throw error;
    }
  },
);

/* =====================================================
   CREATING A PREMISE - CALLABLE
   ===================================================== */

const buildPremiseFailureResult = (code, message, premiseId = "NAv") => ({
  success: false,
  code: code || "UNKNOWN_ERROR",
  message: message || "Unknown error",
  premiseId,
});

const buildPremiseSuccessResult = (
  premiseId,
  message = "Premise created successfully",
) => ({
  success: true,
  code: "SUCCESS",
  message,
  premiseId: premiseId || "NAv",
});

/* ------------------------------------------------
   NORMALIZERS
   ------------------------------------------------ */

function normalizePremiseText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/* ------------------------------------------------
   REQUIRED FIELD CHECK
   ------------------------------------------------ */

function hasRequiredPremiseFields(premise = {}) {
  return !!(
    premise?.id &&
    premise?.erfId &&
    premise?.erfNo &&
    premise?.address?.strNo &&
    premise?.address?.strName &&
    premise?.address?.strType &&
    premise?.propertyType?.type &&
    premise?.parents?.lmPcode &&
    premise?.parents?.wardPcode
  );
}

/* ------------------------------------------------
   DUPLICATE MATCH (FINAL RULE)
   ------------------------------------------------ */

function premisesMatchAsDuplicate(a = {}, b = {}) {
  return (
    normalizePremiseText(a?.erfId) === normalizePremiseText(b?.erfId) &&
    normalizePremiseText(a?.erfNo) === normalizePremiseText(b?.erfNo) &&
    normalizePremiseText(a?.address?.strNo) ===
      normalizePremiseText(b?.address?.strNo) &&
    normalizePremiseText(a?.address?.strName) ===
      normalizePremiseText(b?.address?.strName) &&
    normalizePremiseText(a?.address?.strType) ===
      normalizePremiseText(b?.address?.strType) &&
    normalizePremiseText(a?.propertyType?.type) ===
      normalizePremiseText(b?.propertyType?.type) &&
    normalizePremiseText(a?.propertyType?.name) ===
      normalizePremiseText(b?.propertyType?.name) &&
    normalizePremiseText(a?.propertyType?.unitNo) ===
      normalizePremiseText(b?.propertyType?.unitNo) &&
    normalizePremiseText(a?.parents?.lmPcode) ===
      normalizePremiseText(b?.parents?.lmPcode) &&
    normalizePremiseText(a?.parents?.wardPcode) ===
      normalizePremiseText(b?.parents?.wardPcode)
  );
}

/* =====================================================
   CALLABLE
   ===================================================== */

export const onPremiseCreateCallable = onCall(async (request) => {
  const startedAtMs = Date.now();

  const logTime = (label, extra = {}) => {
    const elapsedSeconds = ((Date.now() - startedAtMs) / 1000).toFixed(2);

    logger.info(`⏱️ onPremiseCreateCallable -- ${label}`, {
      elapsedSeconds,
      ...extra,
    });
  };

  try {
    logTime("START");

    const caller = request?.auth || null;
    const data = request?.data || {};

    const premiseId = data?.id || "NAv";

    logger.info("onPremiseCreateCallable --start", {
      premiseId,
      erfId: data?.erfId || "NAv",
      erfNo: data?.erfNo || "NAv",
      propertyType: data?.propertyType?.type || "NAv",
    });

    logTime("request parsed", { premiseId });

    /* ------------------------------------------------
       1. AUTH GUARD
       ------------------------------------------------ */
    if (!caller) {
      logTime("FAILED auth guard", { premiseId });
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    logTime("auth guard passed", { premiseId, uid: caller.uid });

    /* ------------------------------------------------
       2. BASIC VALIDATION
       ------------------------------------------------ */
    if (!hasRequiredPremiseFields(data)) {
      logTime("FAILED validation", { premiseId });

      return buildPremiseFailureResult(
        "INVALID_PREMISE_PAYLOAD",
        "Required premise fields are missing",
      );
    }

    logTime("validation passed", { premiseId });

    const premiseRef = db.collection("premises").doc(premiseId);

    const idCheckStartedAtMs = Date.now();
    const premiseSnap = await premiseRef.get();

    logger.info("⏱️ onPremiseCreateCallable -- premise id check", {
      premiseId,
      elapsedSeconds: ((Date.now() - idCheckStartedAtMs) / 1000).toFixed(2),
      totalElapsedSeconds: ((Date.now() - startedAtMs) / 1000).toFixed(2),
      exists: premiseSnap.exists,
    });

    /* ------------------------------------------------
       3. IDEMPOTENCY (BY ID)
       ------------------------------------------------ */
    if (premiseSnap.exists) {
      logTime("already exists", { premiseId });

      return buildPremiseSuccessResult(
        premiseId,
        "Premise already exists and is treated as successful",
      );
    }

    /* ------------------------------------------------
       4. DUPLICATE GUARD (FINAL RULE)
       ------------------------------------------------ */
    const duplicateQueryStartedAtMs = Date.now();

    const possibleDuplicateSnap = await db
      .collection("premises")
      .where("erfId", "==", data.erfId)
      .where("parents.lmPcode", "==", data.parents.lmPcode)
      .where("parents.wardPcode", "==", data.parents.wardPcode)
      .get();

    logger.info("⏱️ onPremiseCreateCallable -- duplicate query", {
      premiseId,
      elapsedSeconds: ((Date.now() - duplicateQueryStartedAtMs) / 1000).toFixed(
        2,
      ),
      totalElapsedSeconds: ((Date.now() - startedAtMs) / 1000).toFixed(2),
      candidateCount: possibleDuplicateSnap.size,
    });

    const duplicateMatchStartedAtMs = Date.now();

    const existingDuplicateDoc = possibleDuplicateSnap.docs.find((doc) => {
      const existingPremise = doc.data() || {};
      return premisesMatchAsDuplicate(existingPremise, data);
    });

    logger.info("⏱️ onPremiseCreateCallable -- duplicate comparison", {
      premiseId,
      elapsedSeconds: ((Date.now() - duplicateMatchStartedAtMs) / 1000).toFixed(
        2,
      ),
      totalElapsedSeconds: ((Date.now() - startedAtMs) / 1000).toFixed(2),
      duplicateFound: Boolean(existingDuplicateDoc),
      existingPremiseId: existingDuplicateDoc?.id || "NAv",
    });

    if (existingDuplicateDoc) {
      logger.warn("onPremiseCreateCallable --duplicate blocked", {
        premiseId,
        existingPremiseId: existingDuplicateDoc.id,
        erfId: data?.erfId || "NAv",
        erfNo: data?.erfNo || "NAv",
      });

      logTime("DUPLICATE END", {
        premiseId,
        existingPremiseId: existingDuplicateDoc.id,
      });

      return buildPremiseFailureResult(
        "DUPLICATE_PREMISE",
        "A premise with the same ERF, address and property type already exists",
        existingDuplicateDoc.id,
      );
    }

    /* ------------------------------------------------
       5. NORMALIZE PAYLOAD
       ------------------------------------------------ */
    const normalizeStartedAtMs = Date.now();

    const now = new Date().toISOString();

    const safePayload = JSON.parse(
      JSON.stringify(data, (key, value) =>
        value === undefined ? null : value,
      ),
    );

    delete safePayload.metadata;

    const actorName =
      caller.token?.name ||
      caller.token?.email ||
      caller.displayName ||
      caller.uid ||
      "SYSTEM";

    const finalPayload = {
      ...safePayload,
      metadata: {
        createdAt: now,
        createdByUid: caller.uid,
        createdByUser: actorName,
        updatedAt: now,
        updatedByUid: caller.uid,
        updatedByUser: actorName,
      },
      noAccessTrnIds: Array.isArray(safePayload?.noAccessTrnIds)
        ? safePayload.noAccessTrnIds
        : [],
    };

    logger.info("⏱️ onPremiseCreateCallable -- payload normalized", {
      premiseId,
      elapsedSeconds: ((Date.now() - normalizeStartedAtMs) / 1000).toFixed(2),
      totalElapsedSeconds: ((Date.now() - startedAtMs) / 1000).toFixed(2),
      mediaCount: Array.isArray(finalPayload?.media)
        ? finalPayload.media.length
        : 0,
      noAccessTrnIdsCount: Array.isArray(finalPayload?.noAccessTrnIds)
        ? finalPayload.noAccessTrnIds.length
        : 0,
    });

    /* ------------------------------------------------
       6. CREATE PREMISE
       ------------------------------------------------ */
    const firestoreSetStartedAtMs = Date.now();

    await premiseRef.set(finalPayload);

    logger.info("⏱️ onPremiseCreateCallable -- premise set complete", {
      premiseId,
      elapsedSeconds: ((Date.now() - firestoreSetStartedAtMs) / 1000).toFixed(
        2,
      ),
      totalElapsedSeconds: ((Date.now() - startedAtMs) / 1000).toFixed(2),
    });

    logger.info("onPremiseCreateCallable --created", {
      premiseId,
      erfId: finalPayload?.erfId || "NAv",
      erfNo: finalPayload?.erfNo || "NAv",
    });

    logTime("SUCCESS END", { premiseId });

    return buildPremiseSuccessResult(premiseId);
  } catch (error) {
    logTime("ERROR END", {
      message: error?.message || String(error),
    });

    logger.error("onPremiseCreateCallable --error", {
      message: error?.message || String(error),
      stack: error?.stack || "NAv",
    });

    return buildPremiseFailureResult(
      "UNKNOWN_ERROR",
      error?.message || "Failed to create premise",
    );
  }
});

export const onMeterInstallationCallable = onCall(async (request) => {
  try {
    const db = getFirestore();
    const data = request?.data || {};
    const caller = request.auth;

    if (!caller) {
      throw new HttpsError("unauthenticated", "User must be signed in.");
    }

    const trnId = data?.id || "NAv";
    const meterType = data?.meterType || "NAv";
    const accessData = data?.accessData || {};
    const hasAccess = accessData?.access?.hasAccess || "no";
    const astPayload = data?.ast || null;

    const meterNoRaw = astPayload?.astData?.astNo || "";
    const meterNoNormalized = String(meterNoRaw).trim().toUpperCase();

    if (!trnId || trnId === "NAv" || !trnId.startsWith("TRN_MINST_")) {
      return {
        success: false,
        code: "INVALID_TRN_ID",
        message: "Valid meter installation TRN id is required",
      };
    }

    if (accessData?.trnType !== "METER_INSTALLATION") {
      return {
        success: false,
        code: "INVALID_TRN_TYPE",
        message: "trnType must be METER_INSTALLATION",
      };
    }

    if (!["water", "electricity", "NA"].includes(meterType)) {
      return {
        success: false,
        code: "INVALID_METER_TYPE",
        message: "Invalid meterType",
      };
    }

    if (!["yes", "no"].includes(hasAccess)) {
      return {
        success: false,
        code: "INVALID_ACCESS_VALUE",
        message: "accessData.access.hasAccess must be yes or no",
      };
    }

    if (hasAccess === "no" && meterType !== "NA") {
      return {
        success: false,
        code: "INVALID_NO_ACCESS_METER_TYPE",
        message: "No-access submissions must use meterType NA",
      };
    }

    if (hasAccess === "yes" && !["water", "electricity"].includes(meterType)) {
      return {
        success: false,
        code: "INVALID_ACCESS_METER_TYPE",
        message: "Access submissions must use water or electricity meterType",
      };
    }

    if (hasAccess === "yes" && !meterNoNormalized) {
      return {
        success: false,
        code: "INVALID_METER_NUMBER",
        message: "Meter number is required when access is yes",
      };
    }

    const premiseId = accessData?.premise?.id || "NAv";

    if (!premiseId || premiseId === "NAv") {
      return {
        success: false,
        code: "INVALID_PREMISE_ID",
        message:
          "A valid saved premise id is required before meter installation can be submitted",
      };
    }

    const premiseRef = db.collection("premises").doc(premiseId);
    const premiseSnap = await premiseRef.get();

    if (!premiseSnap.exists) {
      return {
        success: false,
        code: "PREMISE_NOT_FOUND",
        message: "Parent premise does not exist in premises collection",
      };
    }

    const trnRef = db.collection("trns").doc(trnId);
    const trnSnap = await trnRef.get();

    if (trnSnap.exists) {
      return {
        success: true,
        code: "TRN_ALREADY_EXISTS",
        message: "TRN already exists and is treated as successful",
        trnId,
        astId: hasAccess === "yes" ? trnId : "NAv",
      };
    }

    if (hasAccess === "yes") {
      const masterRef = db.collection("meter_master").doc(meterNoNormalized);
      const masterSnap = await masterRef.get();

      if (masterSnap.exists) {
        const masterData = masterSnap.data() || {};
        const existingAstId = masterData?.refs?.asts?.id || "";

        if (existingAstId) {
          return {
            success: false,
            code: "DUPLICATE_METER",
            message: "Meter already linked to an existing AST",
            trnId,
            astId: existingAstId,
          };
        }
      }

      const existingAstSnap = await db
        .collection("asts")
        .where("master.id", "==", meterNoNormalized)
        .limit(1)
        .get();

      if (!existingAstSnap.empty) {
        return {
          success: false,
          code: "DUPLICATE_METER",
          message: "Meter already exists in AST collection",
          trnId,
          astId: existingAstSnap.docs[0].id,
        };
      }
    }

    const now = new Date().toISOString();

    const safePayload = JSON.parse(
      JSON.stringify(data, (key, value) =>
        value === undefined ? null : value,
      ),
    );

    delete safePayload.metadata;

    const actorName =
      caller.token?.name ||
      caller.token?.email ||
      caller.displayName ||
      caller.uid ||
      "SYSTEM";

    const metadata = {
      createdAt: now,
      createdByUid: caller.uid,
      createdByUser: actorName,
      updatedAt: now,
      updatedByUid: caller.uid,
      updatedByUser: actorName,
    };

    const finalAccessData = safePayload?.accessData || {};

    if (hasAccess === "no") {
      await trnRef.set(
        {
          ...safePayload,
          accessData: finalAccessData,
          ast: null,
          meterType: "NA",
          metadata,
        },
        { merge: true },
      );

      return {
        success: true,
        code: "NO_ACCESS_RECORDED",
        message: "No access installation TRN recorded successfully",
        trnId,
        astId: "NAv",
      };
    }

    const finalMeterStatus = {
      state: "FIELD",
      id: finalAccessData?.parents?.lmPcode || "NAv",
      detail: finalAccessData?.parents?.lmPcode || "NAv",
    };

    const finalAstPayload = {
      ...(safePayload?.ast || {}),
      astData: {
        ...(safePayload?.ast?.astData || {}),
        astId: trnId,
      },
    };

    const trnDoc = {
      ...safePayload,
      accessData: finalAccessData,
      ast: finalAstPayload,
      meterType,
      metadata,
    };

    const serviceProvider = safePayload?.serviceProvider || {
      id: "NAv",
      name: "NAv",
    };

    const astDoc = {
      accessData: finalAccessData,
      ast: finalAstPayload,

      master: {
        id: meterNoNormalized,
        visibility: "VISIBLE",
      },

      media: safePayload?.media || [],
      metadata,
      meterType,
      trnId,
      status: finalMeterStatus,
      serviceProvider,
    };

    const astRef = db.collection("asts").doc(trnId);
    const masterRef = db.collection("meter_master").doc(meterNoNormalized);

    const erfId = finalAccessData?.erfId || "NAv";
    const erfRef =
      erfId && erfId !== "NAv" ? db.collection("ireps_erfs").doc(erfId) : null;

    const serviceMeterBucket = getServiceBucketFromMeterType({
      meterType,
      trnId,
    });

    if (!serviceMeterBucket) {
      return {
        success: false,
        code: "INVALID_SERVICE_BUCKET",
        message:
          "Could not resolve premise service bucket for meter installation",
        trnId,
        astId: "NAv",
      };
    }

    const premiseData = premiseSnap.data() || {};
    const premiseServices = premiseData?.services || {};

    const currentServiceItems = Array.isArray(
      premiseServices?.[serviceMeterBucket],
    )
      ? premiseServices[serviceMeterBucket]
      : [];

    const nextServiceItem = {
      trnId,
      status: finalMeterStatus.state,
      updatedAt: now,
    };

    const nextServiceItems = currentServiceItems
      .map(normalizePremiseServiceSnapshotItem)
      .filter((item) => item?.trnId && item.trnId !== "NAv");

    const existingServiceIndex = nextServiceItems.findIndex(
      (item) => item.trnId === trnId,
    );

    if (existingServiceIndex >= 0) {
      nextServiceItems[existingServiceIndex] = {
        ...nextServiceItems[existingServiceIndex],
        ...nextServiceItem,
      };
    } else {
      nextServiceItems.push(nextServiceItem);
    }

    const batch = db.batch();

    batch.set(trnRef, trnDoc, { merge: true });
    batch.set(astRef, astDoc, { merge: true });

    batch.set(
      masterRef,
      {
        id: meterNoNormalized,
        meterNo: meterNoNormalized,
        meterType,
        status: finalMeterStatus,
        refs: {
          asts: { id: trnId },
          trns: { id: trnId },
          premise: { id: premiseId },
        },
        parents: finalAccessData?.parents || {},
        metadata,
      },
      { merge: true },
    );

    batch.update(premiseRef, {
      [`services.${serviceMeterBucket}`]: nextServiceItems,
      "metadata.updatedAt": now,
      "metadata.updatedByUid": metadata.updatedByUid,
      "metadata.updatedByUser": metadata.updatedByUser,
    });

    if (erfRef) {
      batch.update(erfRef, {
        "metadata.updatedAt": now,
        "metadata.updatedByUid": metadata.updatedByUid,
        "metadata.updatedByUser": metadata.updatedByUser,
      });
    }

    await batch.commit();

    return {
      success: true,
      code: "METER_INSTALLATION_CREATED",
      message: "Meter installation created successfully",
      trnId,
      astId: trnId,
      meterNo: meterNoNormalized,
    };
  } catch (error) {
    console.error("onMeterInstallationCallable --error", {
      message: error?.message || String(error),
      stack: error?.stack || "NAv",
    });

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      error?.message || "Failed to submit meter installation transaction",
    );
  }
});
