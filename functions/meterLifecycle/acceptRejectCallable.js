import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import {
  buildFailureResult,
  buildSuccessResult,
  getActorNameFromRequest,
  normalizeUpper,
} from "./helpers.js";

const ACCEPT_REJECT_ALLOWED_STATES = ["ISSUED", "REASSIGNED"];

const ACCEPT_REJECT_ACTIONS = ["ACCEPT", "REJECT"];

function normalizeTrnIds(data = {}) {
  const rawIds = Array.isArray(data?.trnIds)
    ? data.trnIds
    : [data?.trnId || data?.id];

  const cleanIds = rawIds.map((id) => String(id || "").trim()).filter(Boolean);

  return [...new Set(cleanIds)];
}

function readFirstString(...values) {
  for (const value of values) {
    const clean = String(value || "").trim();
    if (clean) return clean;
  }

  return "";
}

function getProfileDisplayName(profile = {}, fallback = "NAv") {
  return (
    readFirstString(
      profile?.profile?.displayName,
      `${profile?.profile?.name || ""} ${profile?.profile?.surname || ""}`,
      profile?.profile?.email,
      profile?.email,
      fallback,
    ) || fallback
  );
}

function getActorRole({ profile = {}, token = {} }) {
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

function getActorServiceProviderId({ profile = {}, token = {} }) {
  return readFirstString(
    token?.spId,
    token?.serviceProviderId,
    token?.employmentServiceProviderId,
    profile?.employment?.serviceProvider?.id,
    profile?.serviceProvider?.id,
  );
}

async function findActorProfile(db, uid) {
  const candidatePaths = [
    `users/${uid}`,
    `userProfiles/${uid}`,
    `profiles/${uid}`,
  ];

  for (const path of candidatePaths) {
    const snap = await db.doc(path).get();

    if (snap.exists) {
      return {
        path,
        data: snap.data() || {},
      };
    }
  }

  return {
    path: null,
    data: {},
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

function normalizeAssignmentTarget(target = {}) {
  return {
    type: normalizeUpper(target?.type),
    id: String(target?.id || "").trim(),
    name: String(target?.name || target?.title || target?.id || "").trim(),
  };
}

function getAssignmentTargets(trnData = {}) {
  const targets = Array.isArray(trnData?.assignment?.targets)
    ? trnData.assignment.targets
    : [];

  return targets
    .map(normalizeAssignmentTarget)
    .filter(
      (target) =>
        ["USER", "TEAM", "SP"].includes(target.type) &&
        Boolean(target.id) &&
        Boolean(target.name),
    );
}

function getTargetTeamIdsFromRows(trnRows = []) {
  return [
    ...new Set(
      trnRows
        .flatMap((row) => getAssignmentTargets(row.data))
        .filter((target) => target.type === "TEAM")
        .map((target) => target.id)
        .filter(Boolean),
    ),
  ];
}

function isAssignedToActor({
  trnData = {},
  actorUid,
  actorSpId,
  teamMap = new Map(),
}) {
  const targets = getAssignmentTargets(trnData);

  if (targets.length === 0) return false;

  const directlyAssigned = targets.some(
    (target) => target.type === "USER" && target.id === actorUid,
  );

  if (directlyAssigned) return true;

  const teamAssigned = targets.some((target) => {
    if (target.type !== "TEAM") return false;

    const teamData = teamMap.get(target.id) || {};
    const teamMemberIds = getTeamMemberIds(teamData);

    return teamMemberIds.includes(actorUid);
  });

  if (teamAssigned) return true;

  return targets.some(
    (target) => target.type === "SP" && target.id === actorSpId,
  );
}

function buildWorkflowPatch({
  action,
  now,
  actorUid,
  actorName,
  rejectReason,
}) {
  if (action === "ACCEPT") {
    return {
      "workflow.state": "ACCEPTED",
      "assignment.acceptedRejectedAt": now,
      "assignment.acceptedRejectedUid": actorUid,
      "assignment.acceptedRejectedUser": actorName,
      "assignment.rejectReason": "",
      "metadata.updatedAt": now,
      "metadata.updatedByUid": actorUid,
      "metadata.updatedByUser": actorName,
    };
  }

  return {
    "workflow.state": "REJECTED",
    "assignment.acceptedRejectedAt": now,
    "assignment.acceptedRejectedUid": actorUid,
    "assignment.acceptedRejectedUser": actorName,
    "assignment.rejectReason": rejectReason,
    "metadata.updatedAt": now,
    "metadata.updatedByUid": actorUid,
    "metadata.updatedByUser": actorName,
  };
}

export const onAcceptRejectLifecycleInstructionCallable = onCall(
  async (request) => {
    try {
      const db = getFirestore();

      const data = request?.data || {};
      const authContext = request?.auth || null;

      if (!authContext?.uid) {
        return buildFailureResult(
          "UNAUTHENTICATED",
          "Authentication is required",
        );
      }

      const actorUid = authContext.uid;
      const token = authContext?.token || {};

      const profileResult = await findActorProfile(db, actorUid);
      const actorProfile = profileResult.data || {};
      const actorRole = getActorRole({
        profile: actorProfile,
        token,
      });

      if (actorRole !== "FWR") {
        return buildFailureResult(
          "UNAUTHORIZED_LCT_ASSIGNEE_ACTION",
          "Only field workers can accept or reject assigned lifecycle instructions",
          {
            actorRole: actorRole || "UNKNOWN",
          },
        );
      }

      const actorSpId = getActorServiceProviderId({
        profile: actorProfile,
        token,
      });

      const actorName =
        getProfileDisplayName(actorProfile, null) ||
        getActorNameFromRequest(request);

      const trnIds = normalizeTrnIds(data);
      const action = normalizeUpper(data?.action);
      const rejectReason = String(data?.rejectReason || "").trim();
      const now = new Date().toISOString();

      if (trnIds.length === 0) {
        return buildFailureResult(
          "INVALID_TRN_IDS",
          "At least one TRN id is required",
        );
      }

      if (trnIds.length > 50) {
        return buildFailureResult(
          "TOO_MANY_TRNS",
          "A maximum of 50 TRNs can be accepted or rejected at once",
          {
            count: trnIds.length,
          },
        );
      }

      if (!ACCEPT_REJECT_ACTIONS.includes(action)) {
        return buildFailureResult(
          "INVALID_ACCEPT_REJECT_ACTION",
          "action must be ACCEPT or REJECT",
        );
      }

      if (action === "REJECT" && !rejectReason) {
        return buildFailureResult(
          "REJECT_REASON_REQUIRED",
          "Reject reason is required when rejecting assigned work",
        );
      }

      logger.info("onAcceptRejectLifecycleInstructionCallable -- START", {
        action,
        trnIds,
        actorUid,
        actorRole,
        actorSpId,
      });

      let responsePayload = null;

      await db.runTransaction(async (tx) => {
        const trnRefs = trnIds.map((trnId) => db.collection("trns").doc(trnId));
        const trnSnaps = [];

        for (const trnRef of trnRefs) {
          trnSnaps.push(await tx.get(trnRef));
        }

        const missingTrnIds = trnSnaps
          .map((snap, index) => (!snap.exists ? trnIds[index] : null))
          .filter(Boolean);

        if (missingTrnIds.length > 0) {
          responsePayload = buildFailureResult(
            "TRN_NOT_FOUND",
            "One or more TRNs were not found",
            {
              missingTrnIds,
            },
          );

          return;
        }

        const trnRows = trnSnaps.map((snap, index) => ({
          trnId: trnIds[index],
          ref: trnRefs[index],
          data: snap.data() || {},
        }));

        const teamIds = getTargetTeamIdsFromRows(trnRows);
        const teamMap = new Map();

        for (const teamId of teamIds) {
          const teamSnap = await tx.get(db.collection("teams").doc(teamId));
          teamMap.set(teamId, teamSnap.exists ? teamSnap.data() || {} : {});
        }

        for (const row of trnRows) {
          const trnType = row.data?.accessData?.trnType || "NAv";
          const workflowState = normalizeUpper(row.data?.workflow?.state);
          const targets = getAssignmentTargets(row.data);

          if (!ACCEPT_REJECT_ALLOWED_STATES.includes(workflowState)) {
            responsePayload = buildFailureResult(
              "INVALID_WORKFLOW_STATE",
              `Only ISSUED or REASSIGNED TRNs can be ${action.toLowerCase()}ed`,
              {
                trnId: row.trnId,
                trnType,
                workflowState: workflowState || "NAv",
              },
            );

            return;
          }

          if (
            row.data?.assignment?.cancelledAt ||
            workflowState === "CANCELLED"
          ) {
            responsePayload = buildFailureResult(
              "TRN_CANCELLED",
              "Cancelled TRNs cannot be accepted or rejected",
              {
                trnId: row.trnId,
                trnType,
              },
            );

            return;
          }

          if (
            !isAssignedToActor({
              trnData: row.data,
              actorUid,
              actorSpId,
              teamMap,
            })
          ) {
            responsePayload = buildFailureResult(
              "TRN_NOT_ASSIGNED_TO_ACTOR",
              "This TRN is not assigned to the current field worker",
              {
                trnId: row.trnId,
                trnType,
                targets,
              },
            );

            return;
          }
        }

        const patch = buildWorkflowPatch({
          action,
          now,
          actorUid,
          actorName,
          rejectReason,
        });

        for (const row of trnRows) {
          tx.update(row.ref, patch);
        }

        responsePayload = buildSuccessResult(
          trnIds.length === 1 ? trnIds[0] : "MULTI",
          action === "ACCEPT"
            ? "Lifecycle instruction accepted successfully"
            : "Lifecycle instruction rejected successfully",
          {
            action,
            trnIds,
            count: trnIds.length,
            workflowState: action === "ACCEPT" ? "ACCEPTED" : "REJECTED",
          },
        );
      });

      return (
        responsePayload ||
        buildFailureResult(
          "UNKNOWN_ERROR",
          "Lifecycle instruction accept/reject was not processed",
        )
      );
    } catch (error) {
      logger.error("onAcceptRejectLifecycleInstructionCallable -- ERROR", {
        message: error?.message || String(error),
        stack: error?.stack || "NAv",
      });

      return buildFailureResult(
        "UNKNOWN_ERROR",
        error?.message || "Failed to accept/reject lifecycle instruction",
      );
    }
  },
);
