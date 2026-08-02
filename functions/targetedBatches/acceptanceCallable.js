import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

import {
  TARGETED_BATCH_COLLECTIONS,
  TARGETED_BATCH_CREATION_STATES,
  buildFailureResult,
  buildSuccessResult,
  findActorProfile,
  getActorNameFromRequest,
  normalizeText,
  normalizeUpper,
} from "./helpers.js";

const TARGETED_BATCH_ACTIONS = Object.freeze(["ACCEPT", "REJECT"]);

const TARGETED_BATCH_ACCEPTANCE_STATES = Object.freeze({
  notReady: "NOT_READY",
  waiting: "WAITING",
  accepted: "ACCEPTED",
  rejected: "REJECTED",
});

function controlledError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function getErrorCode(error) {
  return (
    String(error?.code || "").trim() ||
    "TARGETED_BATCH_ACCEPTANCE_FAILED"
  );
}

function getErrorMessage(error) {
  return (
    String(error?.message || "").trim() ||
    "Targeted Batch acceptance failed"
  );
}

function readFirstText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }

  return "";
}

function getActorRole({ profile = {}, token = {} }) {
  return normalizeUpper(
    readFirstText(
      token?.role,
      token?.userRole,
      token?.employmentRole,
      token?.employment_role,
      token?.irepsRole,
      profile?.role,
      profile?.userRole,
      profile?.profile?.employment?.role,
      profile?.employment?.role,
      profile?.employment?.position,
    ),
  );
}

function getActorServiceProviderId({ profile = {}, token = {} }) {
  return readFirstText(
    token?.spId,
    token?.serviceProviderId,
    token?.employmentServiceProviderId,
    profile?.profile?.employment?.serviceProvider?.id,
    profile?.employment?.serviceProvider?.id,
    profile?.serviceProvider?.id,
  );
}

async function getTargetedBatchActorContext({ db, request }) {
  const actorUid = request?.auth?.uid || null;
  const token = request?.auth?.token || {};

  if (!actorUid) {
    throw controlledError(
      "UNAUTHENTICATED",
      "Authentication is required to accept or reject a Targeted Batch.",
    );
  }

  const profile = await findActorProfile(db, actorUid);
  const role = getActorRole({ profile, token });
  const spId = getActorServiceProviderId({ profile, token });
  const name = getActorNameFromRequest(request, profile);

  if (!["FWR", "SPV"].includes(role)) {
    throw controlledError(
      "UNAUTHORIZED_TARGETED_BATCH_DECISION",
      "Only FWR or SPV users assigned to the Targeted Batch target may accept or reject it.",
      { actorRole: role || "UNKNOWN" },
    );
  }

  return {
    uid: actorUid,
    name,
    role,
    spId,
  };
}

function getTargetedBatchId(data = {}) {
  return normalizeUpper(data?.tbId || data?.id || data?.targetedBatchId);
}

function getTeamMemberIds(teamData = {}) {
  const ids = new Set();

  const addId = (value) => {
    const clean = normalizeText(value);
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

function getTargetedBatchTarget(batchData = {}) {
  const allocation = batchData?.allocation || {};
  const target = allocation?.target || {};

  return {
    type: normalizeUpper(allocation?.targetType || target?.type),
    id: normalizeText(allocation?.targetId || target?.id),
    name: readFirstText(
      allocation?.targetName,
      target?.name,
      target?.title,
      allocation?.targetId,
      target?.id,
    ),
  };
}

function getAcceptanceStatus(batchData = {}) {
  const explicitStatus = normalizeUpper(batchData?.acceptance?.status);

  if (explicitStatus) return explicitStatus;

  const allocationStatus = normalizeUpper(batchData?.allocation?.status);

  if (allocationStatus === "ALLOCATED") {
    return TARGETED_BATCH_ACCEPTANCE_STATES.waiting;
  }

  return TARGETED_BATCH_ACCEPTANCE_STATES.notReady;
}

function assertBatchReadyForDecision({ batchData, tbId }) {
  const creationState = normalizeUpper(batchData?.creation?.state);
  const allocationStatus = normalizeUpper(batchData?.allocation?.status);

  if (creationState !== TARGETED_BATCH_CREATION_STATES.ready) {
    throw controlledError(
      "TARGETED_BATCH_NOT_READY",
      `${tbId} has not completed permanent Targeted Batch creation.`,
      { creationState: creationState || "UNKNOWN" },
    );
  }

  if (allocationStatus !== "ALLOCATED") {
    throw controlledError(
      "TARGETED_BATCH_NOT_ALLOCATED",
      `${tbId} must be allocated before it can be accepted or rejected.`,
      { allocationStatus: allocationStatus || "UNKNOWN" },
    );
  }
}

function assertExecutionNotStarted({ batchData, tbId }) {
  const executionStatus = normalizeUpper(batchData?.execution?.status);
  const executionStartedRows = Number(
    batchData?.counts?.executionStartedRows || 0,
  );

  if (
    (executionStatus && executionStatus !== "NOT_STARTED") ||
    batchData?.execution?.startedAt ||
    executionStartedRows > 0
  ) {
    throw controlledError(
      "TARGETED_BATCH_EXECUTION_ALREADY_STARTED",
      `${tbId} can no longer be accepted or rejected because execution has started.`,
      {
        executionStatus: executionStatus || "UNKNOWN",
        executionStartedRows,
      },
    );
  }
}

function assertActorAllowedForTarget({ actor, target, teamData = null }) {
  if (!target?.type || !target?.id) {
    throw controlledError(
      "TARGETED_BATCH_ALLOCATION_TARGET_MISSING",
      "The Targeted Batch does not have a valid TEAM or Service Provider allocation target.",
    );
  }

  if (target.type === "SP") {
    if (target.id !== actor.spId) {
      throw controlledError(
        "TARGETED_BATCH_NOT_ASSIGNED_TO_ACTOR",
        "This Targeted Batch is not assigned to the current user's Service Provider.",
        {
          target,
          actorUid: actor.uid,
          actorSpId: actor.spId || null,
        },
      );
    }

    return;
  }

  if (target.type === "TEAM") {
    const memberIds = getTeamMemberIds(teamData || {});

    if (!memberIds.includes(actor.uid)) {
      throw controlledError(
        "TARGETED_BATCH_NOT_ASSIGNED_TO_ACTOR",
        "The current user is not a member of the TEAM assigned to this Targeted Batch.",
        {
          target,
          actorUid: actor.uid,
        },
      );
    }

    return;
  }

  throw controlledError(
    "INVALID_TARGETED_BATCH_TARGET_TYPE",
    "Targeted Batch acceptance supports TEAM or SP allocation targets only.",
    { targetType: target.type },
  );
}

function buildAcceptanceDecisionPatch({
  action,
  now,
  actor,
  rejectReason = "",
}) {
  const isAccept = action === "ACCEPT";

  return {
    "acceptance.status": isAccept
      ? TARGETED_BATCH_ACCEPTANCE_STATES.accepted
      : TARGETED_BATCH_ACCEPTANCE_STATES.rejected,
    "acceptance.acceptedAt": isAccept ? now : null,
    "acceptance.acceptedByUid": isAccept ? actor.uid : null,
    "acceptance.acceptedByUser": isAccept ? actor.name : null,
    "acceptance.rejectedAt": isAccept ? null : now,
    "acceptance.rejectedByUid": isAccept ? null : actor.uid,
    "acceptance.rejectedByUser": isAccept ? null : actor.name,
    "acceptance.rejectReason": isAccept ? "" : rejectReason,
    "metadata.updatedAt": now,
    "metadata.updatedByUid": actor.uid,
    "metadata.updatedByUser": actor.name,
  };
}

function buildAcceptanceHistoryDoc({
  tbId,
  action,
  now,
  actor,
  target,
  rejectReason = "",
}) {
  const isAccept = action === "ACCEPT";

  return {
    event: isAccept
      ? "TARGETED_BATCH_ACCEPTED"
      : "TARGETED_BATCH_REJECTED",
    tbId,
    action,
    acceptanceStatus: isAccept
      ? TARGETED_BATCH_ACCEPTANCE_STATES.accepted
      : TARGETED_BATCH_ACCEPTANCE_STATES.rejected,
    target,
    rejectReason: isAccept ? "" : rejectReason,
    note: isAccept
      ? "Targeted Batch accepted. Premise and Meter Discovery work will be created through field execution."
      : `Targeted Batch rejected before field execution started: ${rejectReason}`,
    actor: {
      uid: actor.uid,
      name: actor.name,
      role: actor.role,
    },
    metadata: {
      createdAt: now,
      createdByUid: actor.uid,
      createdByUser: actor.name,
      updatedAt: now,
      updatedByUid: actor.uid,
      updatedByUser: actor.name,
    },
  };
}

export const onAcceptRejectTargetedBatchCallable = onCall(async (request) => {
  const startedAtMs = Date.now();
  const db = getFirestore();
  let tbId = null;
  let action = null;
  let actor = null;

  try {
    actor = await getTargetedBatchActorContext({ db, request });

    const data = request?.data || {};
    tbId = getTargetedBatchId(data);
    action = normalizeUpper(data?.action);
    const rejectReason = normalizeText(data?.rejectReason);

    if (!tbId) {
      return buildFailureResult(
        "INVALID_TARGETED_BATCH_ID",
        "tbId is required.",
      );
    }

    if (!TARGETED_BATCH_ACTIONS.includes(action)) {
      return buildFailureResult(
        "INVALID_TARGETED_BATCH_ACTION",
        "action must be ACCEPT or REJECT.",
      );
    }

    if (action === "REJECT" && !rejectReason) {
      return buildFailureResult(
        "TARGETED_BATCH_REJECT_REASON_REQUIRED",
        "Reject reason is required when rejecting a Targeted Batch.",
      );
    }

    const batchRef = db
      .collection(TARGETED_BATCH_COLLECTIONS.uploads)
      .doc(tbId);
    const historyRef = batchRef.collection("history").doc();

    const decisionResult = await db.runTransaction(async (transaction) => {
      const batchSnapshot = await transaction.get(batchRef);

      if (!batchSnapshot.exists) {
        throw controlledError(
          "TARGETED_BATCH_NOT_FOUND",
          `Targeted Batch ${tbId} was not found.`,
        );
      }

      const batchData = batchSnapshot.data() || {};
      assertBatchReadyForDecision({ batchData, tbId });

      const target = getTargetedBatchTarget(batchData);
      let teamData = null;

      if (target.type === "TEAM") {
        const teamRef = db.collection("teams").doc(target.id);
        const teamSnapshot = await transaction.get(teamRef);

        if (!teamSnapshot.exists) {
          throw controlledError(
            "TARGETED_BATCH_TEAM_NOT_FOUND",
            `The TEAM assigned to ${tbId} was not found.`,
            { target },
          );
        }

        teamData = teamSnapshot.data() || {};
      }

      assertActorAllowedForTarget({ actor, target, teamData });

      const currentAcceptanceStatus = getAcceptanceStatus(batchData);
      const requestedAcceptanceStatus =
        action === "ACCEPT"
          ? TARGETED_BATCH_ACCEPTANCE_STATES.accepted
          : TARGETED_BATCH_ACCEPTANCE_STATES.rejected;

      if (currentAcceptanceStatus === requestedAcceptanceStatus) {
        return {
          idempotent: true,
          acceptanceStatus: currentAcceptanceStatus,
          target,
        };
      }

      if (
        currentAcceptanceStatus ===
          TARGETED_BATCH_ACCEPTANCE_STATES.accepted ||
        currentAcceptanceStatus ===
          TARGETED_BATCH_ACCEPTANCE_STATES.rejected
      ) {
        throw controlledError(
          "TARGETED_BATCH_ACCEPTANCE_ALREADY_DECIDED",
          `${tbId} is already ${currentAcceptanceStatus}.`,
          {
            currentAcceptanceStatus,
            requestedAcceptanceStatus,
          },
        );
      }

      if (
        currentAcceptanceStatus !==
        TARGETED_BATCH_ACCEPTANCE_STATES.waiting
      ) {
        throw controlledError(
          "TARGETED_BATCH_NOT_WAITING_ACCEPTANCE",
          `${tbId} is not waiting for acceptance.`,
          { currentAcceptanceStatus },
        );
      }

      assertExecutionNotStarted({ batchData, tbId });

      const now = Timestamp.now();

      transaction.update(
        batchRef,
        buildAcceptanceDecisionPatch({
          action,
          now,
          actor,
          rejectReason,
        }),
      );

      transaction.set(
        historyRef,
        buildAcceptanceHistoryDoc({
          tbId,
          action,
          now,
          actor,
          target,
          rejectReason,
        }),
      );

      return {
        idempotent: false,
        acceptanceStatus: requestedAcceptanceStatus,
        target,
      };
    });

    logger.info("onAcceptRejectTargetedBatchCallable -- SUCCESS", {
      tbId,
      action,
      acceptanceStatus: decisionResult.acceptanceStatus,
      idempotent: decisionResult.idempotent,
      targetType: decisionResult.target?.type || null,
      targetId: decisionResult.target?.id || null,
      actorUid: actor.uid,
      durationMs: Date.now() - startedAtMs,
    });

    return buildSuccessResult(
      decisionResult.idempotent
        ? `Targeted Batch already ${decisionResult.acceptanceStatus}.`
        : action === "ACCEPT"
          ? "Targeted Batch accepted successfully."
          : "Targeted Batch rejected successfully.",
      {
        code: decisionResult.idempotent
          ? "TARGETED_BATCH_ACCEPTANCE_ALREADY_RECORDED"
          : action === "ACCEPT"
            ? "TARGETED_BATCH_ACCEPTED"
            : "TARGETED_BATCH_REJECTED",
        tbId,
        action,
        acceptanceStatus: decisionResult.acceptanceStatus,
        target: decisionResult.target,
        idempotent: decisionResult.idempotent,
        durationMs: Date.now() - startedAtMs,
      },
    );
  } catch (error) {
    const code = getErrorCode(error);
    const message = getErrorMessage(error);

    logger.error("onAcceptRejectTargetedBatchCallable -- FAILED", {
      tbId,
      action,
      actorUid: actor?.uid || null,
      code,
      message,
      details: error?.details || null,
      durationMs: Date.now() - startedAtMs,
    });

    return buildFailureResult(code, message, {
      tbId,
      details: error?.details || null,
      durationMs: Date.now() - startedAtMs,
    });
  }
});
