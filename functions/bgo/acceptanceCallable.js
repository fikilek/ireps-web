import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import {
  BGO_COLLECTIONS,
  buildFailureResult,
  buildSuccessResult,
  buildUpdateMetadataPatch,
  commitWriteJobsInChunks,
  findActorProfile,
  getActorNameFromRequest,
  normalizeUpper,
  resolveBgoCreateAuthority,
} from "./helpers.js";

import { refreshBgoBatchDerivedExecutionSummary } from "./executionSummary.js";

/* =====================================================
   BGO ACCEPT / REJECT / REVERSE ACCEPTANCE
   -----------------------------------------------------
   BGO Accept v1:
   - BGO child TRNs already exist in trns/{trnId}
   - Accepting a BGOB releases child TRNs directly to ACCEPTED
   - Reverse is online-only and allowed only before execution starts
===================================================== */

const BGO_RELEASE_STATES = {
  WAITING: "WAITING_BATCH_ACCEPTANCE",
  RELEASED: "RELEASED_TO_EXECUTION",
  REJECTED: "BATCH_REJECTED",
};

const BGO_WORKFLOW_STATES = {
  ISSUED: "ISSUED",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
  WAITING: "WAITING_BATCH_ACCEPTANCE",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
};

const BGO_BATCH_ACTIONS = ["ACCEPT", "REJECT"];

function readFirstString(...values) {
  for (const value of values) {
    const clean = String(value || "").trim();
    if (clean) return clean;
  }

  return "";
}

function getProfileDisplayName(profile = {}, fallback = "NAv") {
  const fullName = `${profile?.profile?.name || ""} ${
    profile?.profile?.surname || ""
  }`
    .trim()
    .replace(/\s+/g, " ");

  return (
    readFirstString(
      profile?.profile?.displayName,
      fullName,
      profile?.profile?.email,
      profile?.email,
      profile?.identity?.email,
      fallback,
    ) || fallback
  );
}

function getActorRoleFromProfileOrToken({ profile = {}, token = {} }) {
  return normalizeUpper(
    readFirstString(
      token?.role,
      token?.userRole,
      token?.employmentRole,
      token?.employment_role,
      token?.irepsRole,
      profile?.employment?.role,
      profile?.role,
      profile?.userRole,
    ),
  );
}

function getActorServiceProviderIdFromProfileOrToken({
  profile = {},
  token = {},
}) {
  return readFirstString(
    token?.spId,
    token?.serviceProviderId,
    token?.employmentServiceProviderId,
    profile?.employment?.serviceProvider?.id,
    profile?.serviceProvider?.id,
  );
}

async function getBgoActorContext({ db, request }) {
  const authContext = request?.auth || null;
  const token = authContext?.token || {};
  const actorUid = authContext?.uid || null;

  if (!actorUid) {
    return {
      ok: false,
      failure: buildFailureResult(
        "UNAUTHENTICATED",
        "Authentication is required",
      ),
    };
  }

  const profile = await findActorProfile(db, actorUid);

  const role = getActorRoleFromProfileOrToken({
    profile,
    token,
  });

  const spId = getActorServiceProviderIdFromProfileOrToken({
    profile,
    token,
  });

  const name = getProfileDisplayName(profile, getActorNameFromRequest(request));

  return {
    ok: true,
    actor: {
      uid: actorUid,
      name,
      role,
      spId,
      profile,
      token,
    },
  };
}

function getTeamMemberIds(teamData = {}) {
  const ids = new Set();

  const addId = (value) => {
    const clean = String(value || "").trim();
    if (clean) ids.add(clean);
  };

  if (Array.isArray(teamData?.memberUids)) {
    teamData.memberUids.forEach(addId);
  }

  if (Array.isArray(teamData?.scope?.memberUserIds)) {
    teamData.scope.memberUserIds.forEach(addId);
  }

  if (Array.isArray(teamData?.members)) {
    teamData.members.forEach((member) => {
      if (typeof member === "string") {
        addId(member);
        return;
      }

      addId(member?.uid);
      addId(member?.id);
      addId(member?.userId);
    });
  }

  if (Array.isArray(teamData?.users)) {
    teamData.users.forEach((member) => {
      if (typeof member === "string") {
        addId(member);
        return;
      }

      addId(member?.uid);
      addId(member?.id);
      addId(member?.userId);
    });
  }

  return [...ids];
}

function normalizeBgoTarget(target = {}) {
  return {
    type: normalizeUpper(target?.type),
    id: String(target?.id || "").trim(),
    name: String(target?.name || target?.title || target?.id || "").trim(),
  };
}

function getBgoBatchTarget(batchData = {}) {
  const assignmentTargets = Array.isArray(batchData?.assignment?.targets)
    ? batchData.assignment.targets
    : [];

  const firstAssignmentTarget = assignmentTargets[0] || null;

  return normalizeBgoTarget(
    firstAssignmentTarget ||
      batchData?.target ||
      batchData?.bgo?.target ||
      batchData?.refs?.target ||
      {},
  );
}

function getBgoBatchTrnType(batchData = {}) {
  return normalizeUpper(
    batchData?.trnType ||
      batchData?.operationType ||
      batchData?.accessData?.trnType ||
      batchData?.bgo?.trnType ||
      batchData?.assignment?.instruction?.code ||
      "",
  );
}

function getBatchWorkflowState(batchData = {}) {
  return normalizeUpper(batchData?.workflow?.state || batchData?.workflowState);
}

function getBatchReleaseState(batchData = {}) {
  return normalizeUpper(batchData?.bgo?.releaseState || batchData?.releaseState);
}

async function isActorAllowedForBgoTarget({ db, actor, target }) {
  if (!actor?.uid) return false;

  const targetType = normalizeUpper(target?.type);
  const targetId = String(target?.id || "").trim();

  if (!targetType || !targetId) return false;

  if (targetType === "USER") {
    return targetId === actor.uid;
  }

  if (targetType === "SP") {
    return targetId === actor.spId;
  }

  if (targetType === "TEAM") {
    const teamSnap = await db.collection("teams").doc(targetId).get();

    if (!teamSnap.exists) return false;

    const memberIds = getTeamMemberIds(teamSnap.data() || {});

    return memberIds.includes(actor.uid);
  }

  return false;
}

function getAstIdFromBgoTrn(trnData = {}) {
  return String(
    trnData?.refs?.astId ||
      trnData?.astId ||
      trnData?.ast?.astData?.astId ||
      trnData?.astData?.astId ||
      "",
  ).trim();
}

function getAssignedToFromBgoTrn(trnData = {}) {
  const targets = Array.isArray(trnData?.assignment?.targets)
    ? trnData.assignment.targets
    : [];

  return (
    targets[0] ||
    trnData?.bgo?.target ||
    trnData?.trnActiveLifecycle?.assignedTo ||
    {}
  );
}

function buildBgoTrnActiveLifecycle({
  trnId,
  trnType,
  workflowState,
  assignedTo = {},
  now,
  actorName,
}) {
  return {
    trnId: trnId || "NAv",
    trnType: normalizeUpper(trnType || "NAv"),
    workflowState: normalizeUpper(workflowState || "NAv"),
    outcome: "NAv",
    assignedTo: normalizeBgoTarget(assignedTo),
    updatedAt: now || null,
    updatedByUser: actorName || "SYSTEM",
  };
}

function buildBgoHistoryEvent({
  trnId,
  trnType,
  astId = "NAv",
  event,
  workflowState,
  actorUid,
  actorName,
  now,
  note = "",
}) {
  return {
    event,
    workflowState,
    outcome: "NAv",
    trnId,
    trnType,
    astId,
    note,
    actor: {
      uid: actorUid || "NAv",
      name: actorName || "NAv",
    },
    metadata: {
      createdAt: now,
      createdByUid: actorUid || "NAv",
      createdByUser: actorName || "NAv",
      updatedAt: now,
      updatedByUid: actorUid || "NAv",
      updatedByUser: actorName || "NAv",
    },
  };
}


function buildBgoBatchReleaseSummaryPatch({ action, childCount = 0 }) {
  const total = Math.max(Number(childCount || 0), 0);
  const isAccept = action === "ACCEPT";
  const isReject = action === "REJECT";

  // DATA CONTRACT:
  // batchReleaseSummary is BGO batch-control truth only.
  // It describes whether child TRNs are waiting, released for execution,
  // rejected at batch level, or cancelled at batch level.
  // It must not carry live field execution counts such as success/no-access.
  return {
    summary: FieldValue.delete(),
    "batchReleaseSummary.totalRows": total,
    "batchReleaseSummary.totalTrnsCreated": total,
    "batchReleaseSummary.totalWaitingBatchAcceptance": isAccept || isReject ? 0 : total,
    "batchReleaseSummary.totalReleased": isAccept ? total : 0,
    "batchReleaseSummary.totalAcceptedForExecution": isAccept ? total : 0,
    "batchReleaseSummary.totalRejectedAtBatch": isReject ? total : 0,
    "batchReleaseSummary.totalCancelledAtBatch": 0,
  };
}

function buildBgoBatchReverseReleaseSummaryPatch({ childCount = 0 }) {
  const total = Math.max(Number(childCount || 0), 0);

  // DATA CONTRACT:
  // Reverse acceptance moves the batch back to waiting handoff state.
  // This is still release/handoff truth only, not field execution truth.
  return {
    summary: FieldValue.delete(),
    "batchReleaseSummary.totalRows": total,
    "batchReleaseSummary.totalTrnsCreated": total,
    "batchReleaseSummary.totalWaitingBatchAcceptance": total,
    "batchReleaseSummary.totalReleased": 0,
    "batchReleaseSummary.totalAcceptedForExecution": 0,
    "batchReleaseSummary.totalRejectedAtBatch": 0,
    "batchReleaseSummary.totalCancelledAtBatch": 0,
  };
}

function isBmdBgoBatch(batchData = {}) {
  const batchMode = normalizeUpper(batchData?.bgo?.batchMode);
  const operationType = normalizeUpper(batchData?.operationType);
  const sourceModule = normalizeUpper(batchData?.origin?.sourceModule);
  const createsChildTrnsUpfront = batchData?.bgo?.createsChildTrnsUpfront;

  return (
    batchMode === "BMD" ||
    sourceModule === "BULK_METER_DISCOVERY" ||
    (operationType === "METER_DISCOVERY" && createsChildTrnsUpfront === false)
  );
}

function getBmdWorklistTotalRows(batchData = {}) {
  const worklistCount = Array.isArray(batchData?.worklist?.erfRefs)
    ? batchData.worklist.erfRefs.length
    : 0;

  const candidates = [
    batchData?.summary?.erfCount,
    batchData?.summary?.totalRows,
    batchData?.batchReleaseSummary?.totalRows,
    worklistCount,
  ];

  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }

  return 0;
}

function buildBmdBgoBatchDecisionPatch({
  action,
  now,
  actor,
  rejectReason = "",
  totalRows = 0,
}) {
  const isAccept = action === "ACCEPT";
  const total = Math.max(Number(totalRows || 0), 0);

  return {
    "workflow.state": isAccept
      ? BGO_WORKFLOW_STATES.ACCEPTED
      : BGO_WORKFLOW_STATES.REJECTED,
    "workflow.acceptedAt": isAccept ? now : null,
    "workflow.acceptedByUid": isAccept ? actor.uid : null,
    "workflow.acceptedByUser": isAccept ? actor.name : null,
    "workflow.rejectedAt": isAccept ? null : now,
    "workflow.rejectedByUid": isAccept ? null : actor.uid,
    "workflow.rejectedByUser": isAccept ? null : actor.name,
    "workflow.rejectReason": isAccept ? "" : rejectReason,

    "bgo.releaseState": isAccept
      ? BGO_RELEASE_STATES.RELEASED
      : BGO_RELEASE_STATES.REJECTED,
    "bgo.acceptanceMode": isAccept ? "BMD_BATCH" : null,
    "bgo.acceptedAt": isAccept ? now : null,
    "bgo.acceptedByUid": isAccept ? actor.uid : null,
    "bgo.acceptedByUser": isAccept ? actor.name : null,
    "bgo.rejectedAt": isAccept ? null : now,
    "bgo.rejectedByUid": isAccept ? null : actor.uid,
    "bgo.rejectedByUser": isAccept ? null : actor.name,
    "bgo.rejectReason": isAccept ? "" : rejectReason,

    "assignment.acceptedRejectedAt": now,
    "assignment.acceptedRejectedUid": actor.uid,
    "assignment.acceptedRejectedUser": actor.name,
    "assignment.rejectReason": isAccept ? "" : rejectReason,

    "batchReleaseSummary.totalRows": total,
    "batchReleaseSummary.totalTrnsCreated": 0,
    "batchReleaseSummary.totalWaitingBatchAcceptance": 0,
    "batchReleaseSummary.totalReleased": isAccept ? total : 0,
    "batchReleaseSummary.totalAcceptedForExecution": isAccept ? total : 0,
    "batchReleaseSummary.totalRejectedAtBatch": isAccept ? 0 : total,
    "batchReleaseSummary.totalCancelledAtBatch": 0,

    ...buildUpdateMetadataPatch({
      now,
      actorUid: actor.uid,
      actorName: actor.name,
    }),
  };
}

function getBgoBatchTrnIds(batchData = {}) {
  return [
    ...new Set(
      [
        ...(Array.isArray(batchData?.trnIds) ? batchData.trnIds : []),
        ...(Array.isArray(batchData?.refs?.trnIds)
          ? batchData.refs.trnIds
          : []),
        ...(Array.isArray(batchData?.bgo?.trnIds) ? batchData.bgo.trnIds : []),
        ...(Array.isArray(batchData?.childTrnIds)
          ? batchData.childTrnIds
          : []),
      ]
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    ),
  ];
}

async function getBgoChildTrnSnaps({ db, batchId, batchData = {} }) {
  const byId = new Map();
  const trnIds = getBgoBatchTrnIds(batchData);

  if (trnIds.length > 0) {
    for (let index = 0; index < trnIds.length; index += 300) {
      const chunk = trnIds.slice(index, index + 300);
      const refs = chunk.map((trnId) =>
        db.collection(BGO_COLLECTIONS.trns).doc(trnId),
      );

      const snaps = await db.getAll(...refs);

      snaps.forEach((snap) => {
        if (snap.exists) byId.set(snap.id, snap);
      });
    }
  }

  const queryByBgoBatch = await db
    .collection(BGO_COLLECTIONS.trns)
    .where("bgo.batchId", "==", batchId)
    .get();

  queryByBgoBatch.docs.forEach((snap) => {
    if (snap.exists) byId.set(snap.id, snap);
  });

  const queryByBucketBatch = await db
    .collection(BGO_COLLECTIONS.trns)
    .where("bucket.batchId", "==", batchId)
    .get();

  queryByBucketBatch.docs.forEach((snap) => {
    if (snap.exists) byId.set(snap.id, snap);
  });

  return [...byId.values()];
}

function hasExecutionOutcome(trnData = {}) {
  if (!trnData?.executionOutcome) return false;

  if (typeof trnData.executionOutcome !== "object") return true;

  return Object.keys(trnData.executionOutcome).length > 0;
}

function hasChildExecutionStarted(trnData = {}) {
  const workflowState = normalizeUpper(trnData?.workflow?.state);

  if (
    [
      BGO_WORKFLOW_STATES.IN_PROGRESS,
      BGO_WORKFLOW_STATES.COMPLETED,
      BGO_WORKFLOW_STATES.CANCELLED,
      BGO_WORKFLOW_STATES.REJECTED,
    ].includes(workflowState)
  ) {
    return true;
  }

  return Boolean(
    trnData?.workflow?.executionStartedAt ||
      trnData?.workflow?.completedAt ||
      hasExecutionOutcome(trnData),
  );
}

function buildBgoBatchDecisionPatch({
  action,
  now,
  actor,
  rejectReason = "",
  childCount = 0,
}) {
  const isAccept = action === "ACCEPT";

  return {
    "workflow.state": isAccept
      ? BGO_WORKFLOW_STATES.ACCEPTED
      : BGO_WORKFLOW_STATES.REJECTED,
    "workflow.acceptedAt": isAccept ? now : null,
    "workflow.acceptedByUid": isAccept ? actor.uid : null,
    "workflow.acceptedByUser": isAccept ? actor.name : null,
    "workflow.rejectedAt": isAccept ? null : now,
    "workflow.rejectedByUid": isAccept ? null : actor.uid,
    "workflow.rejectedByUser": isAccept ? null : actor.name,
    "workflow.rejectReason": isAccept ? "" : rejectReason,

    "bgo.releaseState": isAccept
      ? BGO_RELEASE_STATES.RELEASED
      : BGO_RELEASE_STATES.REJECTED,

    "bgo.acceptanceMode": isAccept ? "COLLECTIVE_BATCH" : null,
    "bgo.acceptedAt": isAccept ? now : null,
    "bgo.acceptedByUid": isAccept ? actor.uid : null,
    "bgo.acceptedByUser": isAccept ? actor.name : null,

    "bgo.rejectedAt": isAccept ? null : now,
    "bgo.rejectedByUid": isAccept ? null : actor.uid,
    "bgo.rejectedByUser": isAccept ? null : actor.name,
    "bgo.rejectReason": isAccept ? "" : rejectReason,

    "assignment.acceptedRejectedAt": now,
    "assignment.acceptedRejectedUid": actor.uid,
    "assignment.acceptedRejectedUser": actor.name,
    "assignment.rejectReason": isAccept ? "" : rejectReason,

    ...buildBgoBatchReleaseSummaryPatch({
      action,
      childCount,
    }),

    ...buildUpdateMetadataPatch({
      now,
      actorUid: actor.uid,
      actorName: actor.name,
    }),
  };
}

function buildBgoChildDecisionPatch({
  action,
  batchId,
  now,
  actor,
  rejectReason = "",
}) {
  const isAccept = action === "ACCEPT";

  if (isAccept) {
    return {
      "workflow.state": BGO_WORKFLOW_STATES.ACCEPTED,
      "workflow.acceptedAt": now,
      "workflow.acceptedByUid": actor.uid,
      "workflow.acceptedByUser": actor.name,
      "workflow.rejectedAt": null,
      "workflow.rejectedByUid": null,
      "workflow.rejectedByUser": null,
      "workflow.rejectReason": "",

      "assignment.acceptedRejectedAt": now,
      "assignment.acceptedRejectedUid": actor.uid,
      "assignment.acceptedRejectedUser": actor.name,
      "assignment.rejectReason": "",

      "bgo.releaseState": BGO_RELEASE_STATES.RELEASED,
      "bgo.hiddenUntilBatchAccepted": false,
      "bgo.acceptedThroughBatch": true,
      "bgo.acceptedBatchId": batchId,
      "bgo.acceptedAt": now,
      "bgo.acceptedByUid": actor.uid,
      "bgo.acceptedByUser": actor.name,

      ...buildUpdateMetadataPatch({
        now,
        actorUid: actor.uid,
        actorName: actor.name,
      }),
    };
  }

  return {
    // Do not release rejected batch children into normal WMS execution.
    "workflow.state": BGO_WORKFLOW_STATES.WAITING,
    "workflow.acceptedAt": null,
    "workflow.acceptedByUid": null,
    "workflow.acceptedByUser": null,
    "workflow.rejectedAt": now,
    "workflow.rejectedByUid": actor.uid,
    "workflow.rejectedByUser": actor.name,
    "workflow.rejectReason": rejectReason,

    "assignment.acceptedRejectedAt": now,
    "assignment.acceptedRejectedUid": actor.uid,
    "assignment.acceptedRejectedUser": actor.name,
    "assignment.rejectReason": rejectReason,

    "bgo.releaseState": BGO_RELEASE_STATES.REJECTED,
    "bgo.hiddenUntilBatchAccepted": true,
    "bgo.rejectedThroughBatch": true,
    "bgo.rejectedBatchId": batchId,
    "bgo.rejectedAt": now,
    "bgo.rejectedByUid": actor.uid,
    "bgo.rejectedByUser": actor.name,
    "bgo.rejectReason": rejectReason,

    ...buildUpdateMetadataPatch({
      now,
      actorUid: actor.uid,
      actorName: actor.name,
    }),
  };
}

export const onAcceptRejectBgoBatchCallable = onCall(async (request) => {
  try {
    const db = getFirestore();
    const data = request?.data || {};
    const now = new Date().toISOString();

    const actorResult = await getBgoActorContext({ db, request });

    if (!actorResult.ok) return actorResult.failure;

    const actor = actorResult.actor;
    const batchId = String(data?.batchId || data?.id || "").trim();
    const action = normalizeUpper(data?.action);
    const rejectReason = String(data?.rejectReason || "").trim();

    if (!batchId) {
      return buildFailureResult("INVALID_BGO_BATCH_ID", "batchId is required");
    }

    if (!BGO_BATCH_ACTIONS.includes(action)) {
      return buildFailureResult(
        "INVALID_BGO_BATCH_ACTION",
        "action must be ACCEPT or REJECT",
      );
    }

    if (action === "REJECT" && !rejectReason) {
      return buildFailureResult(
        "BGO_REJECT_REASON_REQUIRED",
        "Reject reason is required when rejecting a BGO batch",
      );
    }

    if (!["FWR", "SPV"].includes(actor.role)) {
      return buildFailureResult(
        "UNAUTHORIZED_BGO_BATCH_DECISION",
        "Only FWR or SPV users assigned to the BGO target may accept or reject a BGO batch",
        {
          actorRole: actor.role || "UNKNOWN",
        },
      );
    }

    const batchRef = db.collection(BGO_COLLECTIONS.batches).doc(batchId);
    const batchSnap = await batchRef.get();

    if (!batchSnap.exists) {
      return buildFailureResult(
        "BGO_BATCH_NOT_FOUND",
        "The selected BGO batch was not found",
        { batchId },
      );
    }

    const batchData = batchSnap.data() || {};
    const isBmdBatch = isBmdBgoBatch(batchData);
    const batchWorkflowState = getBatchWorkflowState(batchData);
    const batchReleaseState = getBatchReleaseState(batchData);

    if (
      action === "ACCEPT" &&
      batchWorkflowState === BGO_WORKFLOW_STATES.ACCEPTED &&
      batchReleaseState === BGO_RELEASE_STATES.RELEASED
    ) {
      const derivedExecutionSummaryRefresh = isBmdBatch
        ? {
            updated: false,
            batchId,
            reason: "BMD_BATCH_HAS_NO_UPFRONT_CHILD_TRNS",
          }
        : await refreshBgoBatchDerivedExecutionSummary({
            db,
            batchId,
            now,
            reason: "BGO_ACCEPT_IDEMPOTENT",
          });

      return buildSuccessResult("BGO batch already accepted", {
        batchId,
        action,
        idempotent: true,
        derivedExecutionSummaryRefresh,
      });
    }

    if (
      action === "REJECT" &&
      batchWorkflowState === BGO_WORKFLOW_STATES.REJECTED
    ) {
      const derivedExecutionSummaryRefresh = isBmdBatch
        ? {
            updated: false,
            batchId,
            reason: "BMD_BATCH_HAS_NO_UPFRONT_CHILD_TRNS",
          }
        : await refreshBgoBatchDerivedExecutionSummary({
            db,
            batchId,
            now,
            reason: "BGO_REJECT_IDEMPOTENT",
          });

      return buildSuccessResult("BGO batch already rejected", {
        batchId,
        action,
        idempotent: true,
        derivedExecutionSummaryRefresh,
      });
    }

    if (
      batchWorkflowState !== BGO_WORKFLOW_STATES.ISSUED ||
      batchReleaseState !== BGO_RELEASE_STATES.WAITING
    ) {
      return buildFailureResult(
        "BGO_BATCH_NOT_WAITING_ACCEPTANCE",
        "Only BGO batches waiting for acceptance can be accepted or rejected",
        {
          batchId,
          workflowState: batchWorkflowState || "NAv",
          releaseState: batchReleaseState || "NAv",
        },
      );
    }

    const target = getBgoBatchTarget(batchData);
    const allowedForTarget = await isActorAllowedForBgoTarget({
      db,
      actor,
      target,
    });

    if (!allowedForTarget) {
      return buildFailureResult(
        "BGO_BATCH_NOT_ASSIGNED_TO_ACTOR",
        "This BGO batch is not assigned to the current user, team, or service provider",
        {
          batchId,
          target,
          actorUid: actor.uid,
          actorSpId: actor.spId || null,
        },
      );
    }

    const childSnaps = await getBgoChildTrnSnaps({
      db,
      batchId,
      batchData,
    });

    if (childSnaps.length === 0 && !isBmdBatch) {
      return buildFailureResult(
        "BGO_BATCH_HAS_NO_CHILD_TRNS",
        "No child TRNs were found for this BGO batch",
        { batchId },
      );
    }

    const trnType = getBgoBatchTrnType(batchData);
    const writeJobs = [];

    if (childSnaps.length === 0 && isBmdBatch) {
      const bmdWorklistCount = getBmdWorklistTotalRows(batchData);

      writeJobs.push((batch) => {
        batch.update(
          batchRef,
          buildBmdBgoBatchDecisionPatch({
            action,
            now,
            actor,
            rejectReason,
            totalRows: bmdWorklistCount,
          }),
        );
      });

      writeJobs.push((batch) => {
        const historyRef = batchRef.collection("history").doc();

        batch.set(
          historyRef,
          buildBgoHistoryEvent({
            trnId: batchId,
            trnType,
            event:
              action === "ACCEPT"
                ? "BMD_BGO_BATCH_ACCEPTED"
                : "BMD_BGO_BATCH_REJECTED",
            workflowState:
              action === "ACCEPT"
                ? BGO_WORKFLOW_STATES.ACCEPTED
                : BGO_WORKFLOW_STATES.REJECTED,
            actorUid: actor.uid,
            actorName: actor.name,
            now,
            note:
              action === "ACCEPT"
                ? "MD-BGO batch accepted. Discovery TRNs will be created only when field discovery is submitted."
                : `MD-BGO batch rejected before field discovery started: ${rejectReason}`,
          }),
        );
      });

      const committedWrites = await commitWriteJobsInChunks({
        db,
        writeJobs,
        chunkSize: 380,
      });

      logger.info("onAcceptRejectBgoBatchCallable -- BMD SUCCESS", {
        batchId,
        action,
        bmdWorklistCount,
        committedWrites,
        actorUid: actor.uid,
      });

      return buildSuccessResult(
        action === "ACCEPT"
          ? "MD-BGO batch accepted successfully"
          : "MD-BGO batch rejected successfully",
        {
          batchId,
          action,
          childTrnCount: 0,
          bmdWorklistCount,
          committedWrites,
          workflowState:
            action === "ACCEPT"
              ? BGO_WORKFLOW_STATES.ACCEPTED
              : BGO_WORKFLOW_STATES.REJECTED,
          releaseState:
            action === "ACCEPT"
              ? BGO_RELEASE_STATES.RELEASED
              : BGO_RELEASE_STATES.REJECTED,
          bmdChildTrnCreationMode: "FIELD_CREATED_ON_DISCOVERY_SUBMIT",
        },
      );
    }

    writeJobs.push((batch) => {
      batch.update(
        batchRef,
        buildBgoBatchDecisionPatch({
          action,
          now,
          actor,
          rejectReason,
          childCount: childSnaps.length,
        }),
      );
    });

    writeJobs.push((batch) => {
      const historyRef = batchRef.collection("history").doc();

      batch.set(
        historyRef,
        buildBgoHistoryEvent({
          trnId: batchId,
          trnType,
          event:
            action === "ACCEPT" ? "BGO_BATCH_ACCEPTED" : "BGO_BATCH_REJECTED",
          workflowState:
            action === "ACCEPT"
              ? BGO_WORKFLOW_STATES.ACCEPTED
              : BGO_WORKFLOW_STATES.REJECTED,
          actorUid: actor.uid,
          actorName: actor.name,
          now,
          note:
            action === "ACCEPT"
              ? "BGO batch accepted on behalf of assigned TEAM/SP"
              : `BGO batch rejected on behalf of assigned TEAM/SP: ${rejectReason}`,
        }),
      );
    });

    for (const childSnap of childSnaps) {
      const childTrnId = childSnap.id;
      const childData = childSnap.data() || {};
      const childWorkflowState = normalizeUpper(childData?.workflow?.state);
      const childTrnType =
        normalizeUpper(childData?.trnType || childData?.accessData?.trnType) ||
        trnType;

      if (
        action === "ACCEPT" &&
        childWorkflowState !== BGO_WORKFLOW_STATES.WAITING
      ) {
        return buildFailureResult(
          "BGO_CHILD_TRN_NOT_WAITING_ACCEPTANCE",
          "One or more BGO child TRNs are not waiting for batch acceptance",
          {
            batchId,
            trnId: childTrnId,
            workflowState: childWorkflowState || "NAv",
          },
        );
      }

      const astId = getAstIdFromBgoTrn(childData);
      const assignedTo = getAssignedToFromBgoTrn(childData);

      writeJobs.push((batch) => {
        batch.update(
          childSnap.ref,
          buildBgoChildDecisionPatch({
            action,
            batchId,
            now,
            actor,
            rejectReason,
          }),
        );
      });

      writeJobs.push((batch) => {
        const childHistoryRef = childSnap.ref.collection("history").doc();

        batch.set(
          childHistoryRef,
          buildBgoHistoryEvent({
            trnId: childTrnId,
            trnType: childTrnType,
            astId,
            event:
              action === "ACCEPT"
                ? "BGO_BATCH_ACCEPTED"
                : "BGO_BATCH_REJECTED",
            workflowState:
              action === "ACCEPT"
                ? BGO_WORKFLOW_STATES.ACCEPTED
                : BGO_WORKFLOW_STATES.WAITING,
            actorUid: actor.uid,
            actorName: actor.name,
            now,
            note:
              action === "ACCEPT"
                ? `Child TRN accepted through BGO batch ${batchId}`
                : `Child TRN kept unreleased because BGO batch ${batchId} was rejected`,
          }),
        );
      });

      if (astId) {
        writeJobs.push((batch) => {
          const astRef = db.collection(BGO_COLLECTIONS.asts).doc(astId);

          batch.update(astRef, {
            trnActiveLifecycle: buildBgoTrnActiveLifecycle({
              trnId: childTrnId,
              trnType: childTrnType,
              workflowState:
                action === "ACCEPT"
                  ? BGO_WORKFLOW_STATES.ACCEPTED
                  : BGO_WORKFLOW_STATES.REJECTED,
              assignedTo,
              now,
              actorName: actor.name,
            }),
            ...buildUpdateMetadataPatch({
              now,
              actorUid: actor.uid,
              actorName: actor.name,
            }),
          });
        });
      }
    }

    const committedWrites = await commitWriteJobsInChunks({
      db,
      writeJobs,
      chunkSize: 380,
    });

    // DATA CONTRACT:
    // Batch accept/reject changes child TRN workflow states.
    // Recompute the derived execution mirror from trns after the write commits.
    const derivedExecutionSummaryRefresh =
      await refreshBgoBatchDerivedExecutionSummary({
        db,
        batchId,
        now,
        reason:
          action === "ACCEPT"
            ? "BGO_BATCH_ACCEPTED"
            : "BGO_BATCH_REJECTED",
      });

    logger.info("onAcceptRejectBgoBatchCallable -- SUCCESS", {
      batchId,
      action,
      childTrnCount: childSnaps.length,
      committedWrites,
      derivedExecutionSummaryRefresh,
      actorUid: actor.uid,
    });

    return buildSuccessResult(
      action === "ACCEPT"
        ? "BGO batch accepted successfully"
        : "BGO batch rejected successfully",
      {
        batchId,
        action,
        childTrnCount: childSnaps.length,
        committedWrites,
        workflowState:
          action === "ACCEPT"
            ? BGO_WORKFLOW_STATES.ACCEPTED
            : BGO_WORKFLOW_STATES.REJECTED,
        releaseState:
          action === "ACCEPT"
            ? BGO_RELEASE_STATES.RELEASED
            : BGO_RELEASE_STATES.REJECTED,
        derivedExecutionSummaryRefresh,
      },
    );
  } catch (error) {
    logger.error("onAcceptRejectBgoBatchCallable -- ERROR", {
      message: error?.message || String(error),
      stack: error?.stack || "NAv",
      code: error?.code || "NAv",
    });

    return buildFailureResult(
      "UNKNOWN_ERROR",
      error?.message || "Failed to accept/reject BGO batch",
    );
  }
});

export const onReverseBgoBatchAcceptanceCallable = onCall(async (request) => {
  try {
    const db = getFirestore();
    const data = request?.data || {};
    const now = new Date().toISOString();

    const authContext = request?.auth || null;

    if (!authContext?.uid) {
      return buildFailureResult(
        "UNAUTHENTICATED",
        "Authentication is required",
      );
    }

    const actorUid = authContext.uid;
    const actorName = getActorNameFromRequest(request);
    const batchId = String(data?.batchId || data?.id || "").trim();
    const reason = String(data?.reason || data?.reverseReason || "").trim();

    if (!batchId) {
      return buildFailureResult("INVALID_BGO_BATCH_ID", "batchId is required");
    }

    // Same authority as BGO Create: MNG or SPV(MNC).
    const authority = await resolveBgoCreateAuthority({ db, request });

    if (!authority.ok) {
      return buildFailureResult(
        "UNAUTHORIZED_BGO_REVERSE_ACCEPTANCE",
        "Only MNG or SPV(MNC) can reverse a BGO batch acceptance",
        {
          actorRole: authority.role,
          actorRelationshipType: authority.relationshipType,
          actorClientType: authority.clientType,
        },
      );
    }

    const batchRef = db.collection(BGO_COLLECTIONS.batches).doc(batchId);
    const batchSnap = await batchRef.get();

    if (!batchSnap.exists) {
      return buildFailureResult(
        "BGO_BATCH_NOT_FOUND",
        "The selected BGO batch was not found",
        { batchId },
      );
    }

    const batchData = batchSnap.data() || {};
    const batchWorkflowState = getBatchWorkflowState(batchData);
    const batchReleaseState = getBatchReleaseState(batchData);

    if (
      batchWorkflowState === BGO_WORKFLOW_STATES.ISSUED &&
      batchReleaseState === BGO_RELEASE_STATES.WAITING
    ) {
      const derivedExecutionSummaryRefresh =
        await refreshBgoBatchDerivedExecutionSummary({
          db,
          batchId,
          now,
          reason: "BGO_REVERSE_ACCEPTANCE_IDEMPOTENT",
        });

      return buildSuccessResult("BGO batch acceptance already reversed", {
        batchId,
        idempotent: true,
        derivedExecutionSummaryRefresh,
      });
    }

    if (
      batchWorkflowState !== BGO_WORKFLOW_STATES.ACCEPTED ||
      batchReleaseState !== BGO_RELEASE_STATES.RELEASED
    ) {
      return buildFailureResult(
        "BGO_BATCH_NOT_REVERSIBLE",
        "Only accepted/released BGO batches can have acceptance reversed",
        {
          batchId,
          workflowState: batchWorkflowState || "NAv",
          releaseState: batchReleaseState || "NAv",
        },
      );
    }

    const childSnaps = await getBgoChildTrnSnaps({
      db,
      batchId,
      batchData,
    });

    if (childSnaps.length === 0) {
      return buildFailureResult(
        "BGO_BATCH_HAS_NO_CHILD_TRNS",
        "No child TRNs were found for this BGO batch",
        { batchId },
      );
    }

    const blockers = [];

    for (const childSnap of childSnaps) {
      const childData = childSnap.data() || {};

      if (hasChildExecutionStarted(childData)) {
        blockers.push({
          trnId: childSnap.id,
          workflowState: normalizeUpper(childData?.workflow?.state) || "NAv",
          executionStartedAt: childData?.workflow?.executionStartedAt || null,
          completedAt: childData?.workflow?.completedAt || null,
          hasExecutionOutcome: hasExecutionOutcome(childData),
        });
      }
    }

    if (blockers.length > 0) {
      return buildFailureResult(
        "BGO_ACCEPTANCE_REVERSE_BLOCKED_EXECUTION_STARTED",
        "This BGO batch cannot be reversed because at least one child TRN has started execution",
        {
          batchId,
          blockerCount: blockers.length,
          blockers: blockers.slice(0, 20),
        },
      );
    }

    const batchTrnType = getBgoBatchTrnType(batchData);
    const writeJobs = [];

    writeJobs.push((batch) => {
      batch.update(batchRef, {
        "workflow.state": BGO_WORKFLOW_STATES.ISSUED,
        "workflow.acceptedAt": null,
        "workflow.acceptedByUid": null,
        "workflow.acceptedByUser": null,
        "workflow.rejectedAt": null,
        "workflow.rejectedByUid": null,
        "workflow.rejectedByUser": null,
        "workflow.rejectReason": "",

        "bgo.releaseState": BGO_RELEASE_STATES.WAITING,
        "bgo.acceptedAt": null,
        "bgo.acceptedByUid": null,
        "bgo.acceptedByUser": null,
        "bgo.acceptanceReversedAt": now,
        "bgo.acceptanceReversedByUid": actorUid,
        "bgo.acceptanceReversedByUser": actorName,
        "bgo.acceptanceReverseReason": reason,

        "assignment.acceptedRejectedAt": null,
        "assignment.acceptedRejectedUid": null,
        "assignment.acceptedRejectedUser": null,
        "assignment.rejectReason": "",

        ...buildBgoBatchReverseReleaseSummaryPatch({
          childCount: childSnaps.length,
        }),

        ...buildUpdateMetadataPatch({
          now,
          actorUid,
          actorName,
        }),
      });
    });

    writeJobs.push((batch) => {
      const historyRef = batchRef.collection("history").doc();

      batch.set(
        historyRef,
        buildBgoHistoryEvent({
          trnId: batchId,
          trnType: batchTrnType,
          event: "BGO_BATCH_ACCEPTANCE_REVERSED",
          workflowState: BGO_WORKFLOW_STATES.ISSUED,
          actorUid,
          actorName,
          now,
          note: reason
            ? `BGO batch acceptance reversed: ${reason}`
            : "BGO batch acceptance reversed before execution started",
        }),
      );
    });

    for (const childSnap of childSnaps) {
      const childTrnId = childSnap.id;
      const childData = childSnap.data() || {};
      const childTrnType =
        normalizeUpper(childData?.trnType || childData?.accessData?.trnType) ||
        batchTrnType;
      const astId = getAstIdFromBgoTrn(childData);
      const assignedTo = getAssignedToFromBgoTrn(childData);

      writeJobs.push((batch) => {
        batch.update(childSnap.ref, {
          "workflow.state": BGO_WORKFLOW_STATES.WAITING,
          "workflow.acceptedAt": null,
          "workflow.acceptedByUid": null,
          "workflow.acceptedByUser": null,
          "workflow.rejectedAt": null,
          "workflow.rejectedByUid": null,
          "workflow.rejectedByUser": null,
          "workflow.rejectReason": "",

          "assignment.acceptedRejectedAt": null,
          "assignment.acceptedRejectedUid": null,
          "assignment.acceptedRejectedUser": null,
          "assignment.rejectReason": "",

          "bgo.releaseState": BGO_RELEASE_STATES.WAITING,
          "bgo.hiddenUntilBatchAccepted": true,
          "bgo.acceptedThroughBatch": false,
          "bgo.acceptedBatchId": null,
          "bgo.acceptedAt": null,
          "bgo.acceptedByUid": null,
          "bgo.acceptedByUser": null,
          "bgo.acceptanceReversedAt": now,
          "bgo.acceptanceReversedByUid": actorUid,
          "bgo.acceptanceReversedByUser": actorName,
          "bgo.acceptanceReverseReason": reason,

          ...buildUpdateMetadataPatch({
            now,
            actorUid,
            actorName,
          }),
        });
      });

      writeJobs.push((batch) => {
        const childHistoryRef = childSnap.ref.collection("history").doc();

        batch.set(
          childHistoryRef,
          buildBgoHistoryEvent({
            trnId: childTrnId,
            trnType: childTrnType,
            astId,
            event: "BGO_BATCH_ACCEPTANCE_REVERSED",
            workflowState: BGO_WORKFLOW_STATES.WAITING,
            actorUid,
            actorName,
            now,
            note: reason
              ? `BGO child TRN returned to waiting because batch acceptance was reversed: ${reason}`
              : `BGO child TRN returned to waiting because batch ${batchId} acceptance was reversed`,
          }),
        );
      });

      if (astId) {
        writeJobs.push((batch) => {
          const astRef = db.collection(BGO_COLLECTIONS.asts).doc(astId);

          batch.update(astRef, {
            trnActiveLifecycle: buildBgoTrnActiveLifecycle({
              trnId: childTrnId,
              trnType: childTrnType,
              workflowState: BGO_WORKFLOW_STATES.WAITING,
              assignedTo,
              now,
              actorName,
            }),
            ...buildUpdateMetadataPatch({
              now,
              actorUid,
              actorName,
            }),
          });
        });
      }
    }

    const committedWrites = await commitWriteJobsInChunks({
      db,
      writeJobs,
      chunkSize: 380,
    });

    // DATA CONTRACT:
    // Reverse acceptance changes child TRN workflow states back to waiting.
    // Recompute the derived execution mirror from trns after the write commits.
    const derivedExecutionSummaryRefresh =
      await refreshBgoBatchDerivedExecutionSummary({
        db,
        batchId,
        now,
        reason: "BGO_BATCH_ACCEPTANCE_REVERSED",
      });

    logger.info("onReverseBgoBatchAcceptanceCallable -- SUCCESS", {
      batchId,
      childTrnCount: childSnaps.length,
      committedWrites,
      derivedExecutionSummaryRefresh,
      actorUid,
    });

    return buildSuccessResult("BGO batch acceptance reversed successfully", {
      batchId,
      childTrnCount: childSnaps.length,
      committedWrites,
      workflowState: BGO_WORKFLOW_STATES.ISSUED,
      releaseState: BGO_RELEASE_STATES.WAITING,
      derivedExecutionSummaryRefresh,
    });
  } catch (error) {
    logger.error("onReverseBgoBatchAcceptanceCallable -- ERROR", {
      message: error?.message || String(error),
      stack: error?.stack || "NAv",
      code: error?.code || "NAv",
    });

    return buildFailureResult(
      "UNKNOWN_ERROR",
      error?.message || "Failed to reverse BGO batch acceptance",
    );
  }
});
