import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import {
  buildFailureResult,
  buildSuccessResult,
  buildTrnActiveLifecycle,
  getActorNameFromRequest,
  normalizeUpper,
} from "./helpers.js";
import { TRN_STATES, canMove } from "./trnStateMachine.js";

// The machine decides. `DR-R001` 5: only an ISSUED job can be accepted or
// rejected. REASSIGNED is not a state (5.1) and a worker cannot hand back
// what he has accepted (5.5) - his only other move would be a false No
// Access, and the office override is what covers him.
const ACCEPT_ALLOWED_WORKFLOW_STATES = [TRN_STATES.ISSUED];
const REJECT_ALLOWED_WORKFLOW_STATES = [TRN_STATES.ISSUED];

const ACCEPT_REJECT_ACTIONS = ["ACCEPT", "REJECT"];

function getAllowedWorkflowStatesForAction(action) {
  return action === "REJECT"
    ? REJECT_ALLOWED_WORKFLOW_STATES
    : ACCEPT_ALLOWED_WORKFLOW_STATES;
}

function getInvalidWorkflowStateMessage(action) {
  return action === "REJECT"
    ? "Only work that is still Issued can be rejected. Once you have accepted it, ask the office to take it back."
    : "Only work that is still Issued can be accepted.";
}

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

export function getAssignmentTargets(trnData = {}) {
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

export function isAssignedToActor({
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

  // A rejected job is no longer his. The targets are cleared with the state,
  // or it would sit in CREATED still wearing his name - his and nobody's at
  // once, which is the exact fault these five states remove (`DR-R001` 5.1).
  return {
    "workflow.state": TRN_STATES.CREATED,
    "assignment.targets": [],
    // The fast read of what the history holds (`DR-R001` 5.7). The office's
    // monitoring screen is ward-scoped and reads hundreds of transactions;
    // opening a subcollection on each to count refusals would make a screen
    // that gets slower every month. The history stays authoritative - this
    // is written in the same transaction, so the two cannot disagree.
    "workflow.rejections": FieldValue.arrayUnion({
      uid: actorUid || "NAv",
      name: actorName || "NAv",
      at: now,
      reason: rejectReason || "NAv",
    }),
    "assignment.acceptedRejectedAt": now,
    "assignment.acceptedRejectedUid": actorUid,
    "assignment.acceptedRejectedUser": actorName,
    "assignment.rejectReason": rejectReason,
    "metadata.updatedAt": now,
    "metadata.updatedByUid": actorUid,
    "metadata.updatedByUser": actorName,
  };
}

function buildAstLifecyclePatch({
  trnId,
  trnType,
  workflowState,
  assignedTo = {},
  now,
  actorUid,
  actorName,
}) {
  return {
    trnActiveLifecycle: buildTrnActiveLifecycle({
      trnId,
      trnType,
      workflowState,
      outcome: "NAv",
      assignedTo,
      updatedAt: now,
      updatedByUser: actorName,
    }),
    "metadata.updatedAt": now,
    "metadata.updatedByUid": actorUid,
    "metadata.updatedByUser": actorName,
  };
}

function buildHistoryEvent({
  trnId,
  trnType,
  astId,
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

function getTrnType(trnData = {}) {
  return normalizeUpper(trnData?.accessData?.trnType || trnData?.trnType || "");
}

function getAstId(trnData = {}) {
  return String(trnData?.ast?.astData?.astId || trnData?.astId || "").trim();
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

      const canAcceptRejectAssignedWork = ["FWR", "SPV"].includes(actorRole);

      if (!canAcceptRejectAssignedWork) {
        return buildFailureResult(
          "UNAUTHORIZED_LCT_ASSIGNEE_ACTION",
          "Only field workers or supervisors can accept or reject assigned lifecycle instructions",
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

        const astRefsById = new Map();

        for (const row of trnRows) {
          const astId = getAstId(row.data);

          if (astId) {
            astRefsById.set(astId, db.collection("asts").doc(astId));
          }
        }

        const astSnapsById = new Map();

        for (const [astId, astRef] of astRefsById.entries()) {
          const astSnap = await tx.get(astRef);
          astSnapsById.set(astId, astSnap);
        }

        for (const row of trnRows) {
          const trnType = getTrnType(row.data) || "NAv";
          const workflowState = normalizeUpper(row.data?.workflow?.state);
          const targets = getAssignmentTargets(row.data);
          const astId = getAstId(row.data);

          // THE STATE IS THE TRUTH, NOT A STAMP BESIDE IT (`DR-R001` 5.2).
          // This used to read `workflow.completedAt` as well, and the cancel
          // check below read `assignment.cancelledAt`. Both are stamps that
          // describe something that HAPPENED; only the state says what the
          // job IS now.
          if (workflowState === "COMPLETED") {
            responsePayload = buildFailureResult(
              "TRN_ALREADY_COMPLETED",
              "Completed lifecycle instructions cannot be accepted or rejected",
              {
                trnId: row.trnId,
                trnType,
                workflowState: workflowState || "NAv",
              },
            );

            return;
          }

          // THE CANCELLED REFUSAL IS GONE, and this is the fault the owner
          // found on TEST on 12 October 2026. It read
          // `assignment.cancelledAt` - a stamp left behind by an earlier
          // unallocate - so a job taken back and then GIVEN OUT AGAIN could
          // be neither accepted nor rejected, for ever, while its state read
          // ISSUED and a worker plainly held it on his phone. Both buttons
          // refused, because this sits above both.
          //
          // There is also no `CANCELLED` state to test for: cancelling
          // returns a job to `Created` (`DR-R001` 5). A job in `Created` is
          // refused by the state check below, in the words that actually
          // help - "Only work that is still Issued can be accepted" - rather
          // than by a sentence naming a state iREPS no longer has.
          //
          // The allocate patch now clears those stamps too, so the data stops
          // producing this. Both halves are fixed: the writer no longer
          // leaves the lie, and the reader no longer believes one.

          const allowedWorkflowStates =
            getAllowedWorkflowStatesForAction(action);

          if (!allowedWorkflowStates.includes(workflowState)) {
            responsePayload = buildFailureResult(
              "INVALID_WORKFLOW_STATE",
              getInvalidWorkflowStateMessage(action),
              {
                trnId: row.trnId,
                trnType,
                workflowState: workflowState || "NAv",
                allowedWorkflowStates,
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
              "INSTRUCTION_NOT_ASSIGNED",
              "This TRN is not assigned to the current field actor",
              {
                trnId: row.trnId,
                trnType,
                targets,
              },
            );

            return;
          }

          if (!astId) {
            responsePayload = buildFailureResult(
              "INVALID_AST_ID",
              "TRN is missing ast.astData.astId",
              {
                trnId: row.trnId,
                trnType,
              },
            );

            return;
          }

          const astSnap = astSnapsById.get(astId);

          if (!astSnap?.exists) {
            responsePayload = buildFailureResult(
              "AST_NOT_FOUND",
              "The referenced AST does not exist",
              {
                trnId: row.trnId,
                trnType,
                astId,
              },
            );

            return;
          }
        }

        // `DR-R001` 5: a rejection does not rest anywhere. It goes back to
        // CREATED with nobody on it, and the refusal - who, when and why -
        // lives in the history, which is the only place it exists (5.7).
        const move = canMove(TRN_STATES.ISSUED, action === "ACCEPT" ? "accept" : "reject");

        if (!move.ok) {
          responsePayload = buildFailureResult("MOVE_NOT_ALLOWED", move.message, {});

          return;
        }

        const nextWorkflowState = move.to;

        const patch = buildWorkflowPatch({
          action,
          now,
          actorUid,
          actorName,
          rejectReason,
        });

        for (const row of trnRows) {
          const trnType = getTrnType(row.data) || "NAv";
          const astId = getAstId(row.data);
          const targets = getAssignmentTargets(row.data);

          // On a rejection nobody holds it any more, so the meter's marker
          // names nobody either. The meter is still held - CREATED holds it
          // (5.2) - but by a job waiting to be given out, not by a worker.
          const assignedTo =
            action === "ACCEPT"
              ? targets[0] || row.data?.trnActiveLifecycle?.assignedTo || {}
              : {};

          tx.update(row.ref, patch);

          tx.update(
            db.collection("asts").doc(astId),
            buildAstLifecyclePatch({
              trnId: row.trnId,
              trnType,
              workflowState: nextWorkflowState,
              assignedTo,
              now,
              actorUid,
              actorName,
            }),
          );

          const historyRef = row.ref.collection("history").doc();

          tx.set(
            historyRef,
            buildHistoryEvent({
              trnId: row.trnId,
              trnType,
              astId,
              // The EVENT is what happened; the state is where it landed.
              // A rejection is an event called REJECTED that lands in
              // CREATED, and the history is the only record of it (5.7).
              event: action === "ACCEPT" ? "ACCEPTED" : "REJECTED",
              workflowState: nextWorkflowState,
              actorUid,
              actorName,
              now,
              note:
                nextWorkflowState === "ACCEPTED"
                  ? "Lifecycle instruction accepted"
                  : `Lifecycle instruction rejected: ${rejectReason}`,
            }),
          );
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
            workflowState: nextWorkflowState,
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
