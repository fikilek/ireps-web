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

function isAssignedToActor({ trnData = {}, actorUid, teamMap = new Map() }) {
  const createdFor = trnData?.assignment?.createdFor || {};
  const createdForType = normalizeUpper(createdFor?.type);
  const createdForId = String(createdFor?.id || "").trim();

  if (createdForType === "USER") {
    return createdForId === actorUid;
  }

  if (createdForType === "TEAM") {
    const teamData = teamMap.get(createdForId) || {};
    const teamMemberIds = getTeamMemberIds(teamData);

    return teamMemberIds.includes(actorUid);
  }

  return false;
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

        const teamIds = [
          ...new Set(
            trnRows
              .filter(
                (row) =>
                  normalizeUpper(row.data?.assignment?.createdFor?.type) ===
                  "TEAM",
              )
              .map((row) => String(row.data?.assignment?.createdFor?.id || ""))
              .filter(Boolean),
          ),
        ];

        const teamMap = new Map();

        for (const teamId of teamIds) {
          const teamSnap = await tx.get(db.collection("teams").doc(teamId));
          teamMap.set(teamId, teamSnap.exists ? teamSnap.data() || {} : {});
        }

        for (const row of trnRows) {
          const trnType = row.data?.accessData?.trnType || "NAv";
          const workflowState = normalizeUpper(row.data?.workflow?.state);
          const createdFor = row.data?.assignment?.createdFor || {};

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
              teamMap,
            })
          ) {
            responsePayload = buildFailureResult(
              "TRN_NOT_ASSIGNED_TO_ACTOR",
              "This TRN is not assigned to the current field worker",
              {
                trnId: row.trnId,
                trnType,
                createdFor,
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
