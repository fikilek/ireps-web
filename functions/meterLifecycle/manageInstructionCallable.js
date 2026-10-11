import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import {
  buildFailureResult,
  buildSuccessResult,
  buildTrnActiveLifecycle,
  getActorNameFromRequest,
  normalizeUpper,
  sanitizeAssignment,
  validateLifecycleInstructionAssignment,
} from "./helpers.js";
import { TRN_STATES, canMoveAs, currentState } from "./trnStateMachine.js";

const MANAGE_ACTIONS = ["ALLOCATE", "REASSIGN", "CANCEL"];

/**
 * What each action is, in the machine's own moves. `DR-R001` 5.
 *
 * ALLOCATE gives a waiting job to a worker. CANCEL is what the screens call
 * UNALLOCATE: the office takes it back and it waits again. REASSIGN is both
 * at once - take it off one man and give it to another - so it is checked as
 * both moves, in order. Nothing here keeps its own list of which states an
 * action is allowed from; that is the machine's answer, once.
 */
const ACTION_MOVES = {
  ALLOCATE: ["allocate"],
  CANCEL: ["cancel"],
  REASSIGN: ["cancel", "allocate"],
};

/**
 * Whether this actor may make this action's moves from this state, and where
 * it ends up. A REASSIGN from ACCEPTED passes here because the machine lets
 * a supervisor cancel accepted work - the override of `DR-R001` 5.5, for the
 * man who took the job and then could not go.
 */
function checkAction({ action, state, role }) {
  let from = currentState(state);

  if (!from) {
    return {
      ok: false,
      code: "UNKNOWN_TRN_STATE",
      message: `${state || "A transaction with no state"} is not a state iREPS knows.`,
    };
  }

  for (const move of ACTION_MOVES[action] || []) {
    const result = canMoveAs(from, move, role);

    if (!result.ok) return result;

    from = result.to;
  }

  return { ok: true, to: from };
}

const MANAGED_LCT_TYPES = [
  "METER_INSPECTION",
  "METER_DISCONNECTION",
  "METER_RECONNECTION",
  "METER_REMOVAL",
  "METER_READING",
];

function readFirstString(...values) {
  for (const value of values) {
    const clean = String(value || "").trim();
    if (clean) return clean;
  }

  return "";
}

function normalizeTrnIds(data = {}) {
  const rawIds = Array.isArray(data?.trnIds)
    ? data.trnIds
    : [data?.trnId || data?.id];

  const cleanIds = rawIds.map((id) => String(id || "").trim()).filter(Boolean);

  return [...new Set(cleanIds)];
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

function serviceProviderLooksMnc(serviceProvider = {}) {
  const classification = normalizeUpper(
    serviceProvider?.profile?.classification ||
      serviceProvider?.classification ||
      serviceProvider?.type,
  );

  if (classification === "MNC") return true;

  const clients = Array.isArray(serviceProvider?.clients)
    ? serviceProvider.clients
    : [];

  return clients.some(
    (client) =>
      normalizeUpper(client?.clientType) === "LM" &&
      normalizeUpper(client?.relationshipType) === "MNC",
  );
}

async function resolveManageAuthority({ db, request }) {
  const uid = request?.auth?.uid;
  const token = request?.auth?.token || {};

  const profileResult = await findActorProfile(db, uid);
  const profile = profileResult.data || {};

  const role = getActorRole({
    profile,
    token,
  });

  const spId = getActorServiceProviderId({
    profile,
    token,
  });

  let actorSp = null;

  if (spId) {
    const spSnap = await db.collection("serviceProviders").doc(spId).get();

    if (spSnap.exists) {
      actorSp = {
        id: spSnap.id,
        ...spSnap.data(),
      };
    }
  }

  const isMnc = serviceProviderLooksMnc(actorSp || {});
  const isMng = role === "MNG";
  const isMncSpv = role === "SPV" && isMnc;

  return {
    ok: isMng || isMncSpv,
    role: role || "UNKNOWN",
    spId: spId || "UNKNOWN",
    isMnc,
  };
}

function normalizeAssignmentTarget(value = {}) {
  return {
    type: normalizeUpper(value?.type || ""),
    id: String(value?.id || "").trim(),
    name: String(value?.name || value?.title || value?.id || "").trim(),
  };
}

function normalizeAssignmentTargets(value = []) {
  const rawTargets = Array.isArray(value) ? value : [];

  return rawTargets
    .map(normalizeAssignmentTarget)
    .filter(
      (target) =>
        ["USER", "TEAM", "SP"].includes(target.type) &&
        Boolean(target.id) &&
        Boolean(target.name),
    );
}

function createdForToTargets(createdFor = {}) {
  const target = normalizeAssignmentTarget(createdFor);

  if (!["USER", "TEAM", "SP"].includes(target.type)) return [];
  if (!target.id || !target.name) return [];

  return [target];
}

function getNewTargetsFromRequest(data = {}) {
  const directTargets = normalizeAssignmentTargets(data?.targets);

  if (directTargets.length) return directTargets;

  const assignmentTargets = normalizeAssignmentTargets(
    data?.assignment?.targets,
  );

  if (assignmentTargets.length) return assignmentTargets;

  const newAssignmentTargets = normalizeAssignmentTargets(
    data?.newAssignment?.targets,
  );

  if (newAssignmentTargets.length) return newAssignmentTargets;

  return createdForToTargets(
    data?.createdFor ||
      data?.assignment?.createdFor ||
      data?.newAssignment?.createdFor ||
      {},
  );
}

function validateNewTargets(targets = []) {
  const cleanTargets = normalizeAssignmentTargets(targets);

  if (!cleanTargets.length) {
    return {
      ok: false,
      code: "INVALID_ASSIGNMENT_TARGETS",
      message:
        "assignment.targets must contain at least one USER, TEAM, or SP target",
    };
  }

  return {
    ok: true,
    targets: cleanTargets,
  };
}

/**
 * The instruction as it will stand once this allocate is written.
 *
 * `DR-R001` 3.4 and 5: the button creates the work, and the ITO page says
 * why, in what words, and with what attached - at the moment it chooses the
 * worker. So the instruction arrives HERE, not at creation.
 *
 * It is merged onto what the transaction already carries rather than
 * replacing it, because creation wrote the code and an allocate that sent
 * only a reason would otherwise wipe it.
 */
export function mergeInstruction({ trnData, instruction }) {
  const stored = trnData?.assignment?.instruction || {};
  const sent = instruction || {};

  const merged = { ...stored, ...sent };

  // The reason is a code and its words (`DR-R001` 3.4), so a partial reason
  // would quietly keep half of an old one.
  if (sent?.reason) merged.reason = { ...(stored.reason || {}), ...sent.reason };

  return merged;
}

/**
 * Whether this allocate's instruction is one iREPS may write. THE SAME
 * VALIDATOR THE CREATE USES (owner, 10 October 2026: the same validation
 * front and back). A second copy here is how the two lanes come to accept
 * different work.
 */
export function checkAllocationInstruction({ trnData, trnType, instruction, targets, media }) {
  const hasInstructionMedia =
    (Array.isArray(media) ? media : []).some(
      (item) => normalizeUpper(item?.tag) === "INSTRUCTIONMEDIA",
    ) ||
    (Array.isArray(trnData?.media) ? trnData.media : []).some(
      (item) => normalizeUpper(item?.tag) === "INSTRUCTIONMEDIA",
    );

  return validateLifecycleInstructionAssignment(
    {
      instruction: mergeInstruction({ trnData, instruction }),
      targets,
    },
    trnType,
    { hasInstructionMedia, allocating: true },
  );
}

function buildAssignmentHistoryItem({
  trnData,
  action,
  reason,
  now,
  actorUid,
  actorName,
}) {
  return {
    action,
    at: now,
    byUid: actorUid,
    byUser: actorName,
    reason: String(reason || ""),

    previousWorkflowState: trnData?.workflow?.state || "NAv",

    previousTargets: Array.isArray(trnData?.assignment?.targets)
      ? trnData.assignment.targets
      : [],

    previousAcceptedRejectedAt: trnData?.assignment?.acceptedRejectedAt || null,

    previousAcceptedRejectedUid:
      trnData?.assignment?.acceptedRejectedUid || null,

    previousAcceptedRejectedUser:
      trnData?.assignment?.acceptedRejectedUser || null,

    previousRejectReason: trnData?.assignment?.rejectReason || "",
  };
}

/**
 * Putting a worker's name on a waiting job. `DR-R001` 5.
 *
 * One writer for ALLOCATE and REASSIGN, because they write the same thing: a
 * name goes on, the state becomes ISSUED, and the clock starts. A second
 * copy for the first allocate is how the two come to stamp different fields.
 */
function buildAllocatePatch({
  trnData,
  targets,
  reason,
  instruction = null,
  media = null,
  now,
  actorUid,
  actorName,
  reassigning = false,
}) {
  const currentCount = Number(trnData?.workflow?.reassignmentCount || 0);

  const patch = {
    "assignment.targets": targets,

    "assignment.acceptedRejectedAt": null,
    "assignment.acceptedRejectedUid": null,
    "assignment.acceptedRejectedUser": null,
    "assignment.rejectReason": "",

    "workflow.state": TRN_STATES.ISSUED,
    // `DR-R001` 5.6: the three-day clock runs from here, so it is stamped
    // every time a name goes on. A job handed to a second man has waited on
    // him since now, not since the first man was asked.
    "workflow.issuedAt": now,

    "metadata.updatedAt": now,
    "metadata.updatedByUid": actorUid,
    "metadata.updatedByUser": actorName,

    assignmentHistory: FieldValue.arrayUnion(
      buildAssignmentHistoryItem({
        trnData,
        action: reassigning ? "REASSIGN" : "ALLOCATE",
        reason,
        now,
        actorUid,
        actorName,
      }),
    ),
  };

  // The instruction is written only where one was sent. A reassign sends
  // none and must not blank the one the worker before him was given.
  if (instruction) {
    patch["assignment.instruction"] = sanitizeAssignment({
      instruction: mergeInstruction({ trnData, instruction }),
      targets,
    }).instruction;
  }

  if (Array.isArray(media) && media.length > 0) {
    patch.media = FieldValue.arrayUnion(...media);
  }

  if (reassigning) {
    patch["workflow.reassignedAt"] = now;
    patch["workflow.reassignedByUid"] = actorUid;
    patch["workflow.reassignedByUser"] = actorName;
    patch["workflow.reassignmentCount"] = currentCount + 1;
  }

  return patch;
}

function buildCancelPatch({ trnData, cancelReason, now, actorUid, actorName }) {
  return {
    "assignment.cancelledAt": now,
    "assignment.cancelledByUid": actorUid,
    "assignment.cancelledByUser": actorName,
    "assignment.cancelReason": cancelReason,

    // The office has taken it back, so nobody holds it: the state goes to
    // CREATED and the targets go with it. Leaving his name on it would make
    // the job his and nobody's at once (`DR-R001` 5.1).
    "workflow.state": TRN_STATES.CREATED,
    "assignment.targets": [],
    "workflow.cancelledAt": now,
    "workflow.cancelledByUid": actorUid,
    "workflow.cancelledByUser": actorName,

    "metadata.updatedAt": now,
    "metadata.updatedByUid": actorUid,
    "metadata.updatedByUser": actorName,

    assignmentHistory: FieldValue.arrayUnion(
      buildAssignmentHistoryItem({
        trnData,
        action: "CANCEL",
        reason: cancelReason,
        now,
        actorUid,
        actorName,
      }),
    ),
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

function buildNotificationRecord({
  trnId,
  trnType,
  workflowState,
  target,
  actorUid,
  actorName,
  now,
  reassigning = false,
}) {
  const targetType = normalizeUpper(target?.type || "USER");
  const targetName = String(target?.name || target?.id || "NAv").trim();

  return {
    type: reassigning ? "MLCT_REASSIGNED" : "MLCT_ISSUED",
    channelPreference: ["IN_APP", "EMAIL", "WHATSAPP"],

    recipient: {
      type: targetType || "USER",
      id: String(target?.id || "NAv").trim(),
      name: targetName || "NAv",
      email: String(target?.email || "").trim(),
      phone: String(target?.phone || "").trim(),
    },

    trn: {
      id: trnId,
      trnType,
      workflowState,
    },

    message: {
      title: reassigning ? "Lifecycle work reassigned" : "Lifecycle work issued",
      body: `A ${
        trnType === "METER_DISCONNECTION"
          ? "meter disconnection"
          : "meter lifecycle"
      } work item has been ${reassigning ? "reassigned" : "issued"} to you.`,
    },

    delivery: {
      status: "PENDING",
      attempts: 0,
      lastAttemptAt: null,
      deliveredAt: null,
      error: "",
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

export const onManageLifecycleInstructionCallable = onCall(async (request) => {
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
    const actorName = getActorNameFromRequest(request);
    const now = new Date().toISOString();

    const authority = await resolveManageAuthority({
      db,
      request,
    });

    if (!authority.ok) {
      return buildFailureResult(
        "UNAUTHORIZED_LCT_MANAGER",
        "Only MNG and SPV(MNC) can allocate, reassign or cancel lifecycle instructions",
        {
          actorRole: authority.role,
          actorSpId: authority.spId,
          actorIsMnc: authority.isMnc,
        },
      );
    }

    const action = normalizeUpper(data?.action);
    const trnIds = normalizeTrnIds(data);
    const reason = String(
      data?.reason || data?.reassignmentReason || "",
    ).trim();
    const cancelReason = String(
      data?.cancelReason || data?.reason || "",
    ).trim();

    // What the ITO page fills in as it allocates: why, the words the worker
    // reads, and anything attached (`DR-R001` 3.4). Absent on a reassign.
    const instruction =
      data?.instruction || data?.assignment?.instruction || null;
    const media = Array.isArray(data?.media) ? data.media : [];

    if (!MANAGE_ACTIONS.includes(action)) {
      return buildFailureResult(
        "INVALID_MANAGE_ACTION",
        "action must be ALLOCATE, REASSIGN or CANCEL",
      );
    }

    if (trnIds.length === 0) {
      return buildFailureResult(
        "INVALID_TRN_IDS",
        "At least one TRN id is required",
      );
    }

    if (trnIds.length > 50) {
      return buildFailureResult(
        "TOO_MANY_TRNS",
        "A maximum of 50 TRNs can be managed at once",
        {
          count: trnIds.length,
        },
      );
    }

    let newTargets = null;

    if (action === "ALLOCATE" || action === "REASSIGN") {
      const targetsCheck = validateNewTargets(getNewTargetsFromRequest(data));

      if (!targetsCheck.ok) {
        return buildFailureResult(targetsCheck.code, targetsCheck.message);
      }

      newTargets = targetsCheck.targets;
    }

    if (action === "CANCEL" && !cancelReason) {
      return buildFailureResult(
        "CANCEL_REASON_REQUIRED",
        "Cancel reason is required when cancelling lifecycle instructions",
      );
    }

    logger.info("onManageLifecycleInstructionCallable -- START", {
      action,
      trnIds,
      actorUid,
      actorRole: authority.role,
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

      const rows = trnSnaps.map((snap, index) => ({
        trnId: trnIds[index],
        ref: trnRefs[index],
        data: snap.data() || {},
      }));

      const astRefsById = new Map();

      for (const row of rows) {
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

      for (const row of rows) {
        const trnType = getTrnType(row.data) || "NAv";
        const workflowState = normalizeUpper(row.data?.workflow?.state);
        const astId = getAstId(row.data);

        if (!MANAGED_LCT_TYPES.includes(trnType)) {
          responsePayload = buildFailureResult(
            "INVALID_MANAGED_LCT_TYPE",
            "Only INSPECTION, DISCONNECTION, RECONNECTION and REMOVAL instructions can be managed here",
            {
              trnId: row.trnId,
              trnType,
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

        // ONE GATE. This used to be five hand-written refusals - completed,
        // cancelled, in progress, and a list of allowed states for each
        // action - each able to disagree with the others and with the rule.
        // The machine answers it once, and its refusal says what the state
        // CAN take instead of only no (`DR-R001` 5).
        const check = checkAction({
          action,
          state: workflowState,
          role: authority.role,
        });

        if (!check.ok) {
          responsePayload = buildFailureResult(check.code, check.message, {
            trnId: row.trnId,
            trnType,
            workflowState: currentState(workflowState) || workflowState || "NAv",
          });

          return;
        }

        if (action === "ALLOCATE") {
          const instructionCheck = checkAllocationInstruction({
            trnData: row.data,
            trnType,
            instruction,
            targets: newTargets,
            media,
          });

          if (!instructionCheck.ok) {
            responsePayload = buildFailureResult(
              instructionCheck.code,
              instructionCheck.message,
              { trnId: row.trnId, trnType },
            );

            return;
          }
        }

        row.nextState = check.to;
      }

      // Where each action lands comes from the machine, which checked every
      // row above - never from a second reading of the action here.
      const nextWorkflowState = rows[0]?.nextState || TRN_STATES.CREATED;
      const allocating = action === "ALLOCATE" || action === "REASSIGN";

      for (const row of rows) {
        const trnType = getTrnType(row.data) || "NAv";
        const astId = getAstId(row.data);

        if (allocating) {
          tx.update(
            row.ref,
            buildAllocatePatch({
              trnData: row.data,
              targets: newTargets,
              reason,
              instruction: action === "ALLOCATE" ? instruction : null,
              media: action === "ALLOCATE" ? media : null,
              now,
              actorUid,
              actorName,
              reassigning: action === "REASSIGN",
            }),
          );
        }

        if (action === "CANCEL") {
          tx.update(
            row.ref,
            buildCancelPatch({
              trnData: row.data,
              cancelReason,
              now,
              actorUid,
              actorName,
            }),
          );
        }

        const existingTargets = normalizeAssignmentTargets(
          row.data?.assignment?.targets,
        );

        // After a cancel nobody holds it, so the meter's marker names
        // nobody. The meter is still held - CREATED holds it (5.2) - by a
        // job waiting to be given out rather than by a worker.
        const assignedTo = allocating ? newTargets?.[0] || {} : {};

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
            // The event is what happened; the state is where it landed.
            // `ALLOCATED` and `REASSIGNED` both land in ISSUED, and only the
            // history can tell the office which of the two it was.
            event:
              action === "CANCEL"
                ? "CANCELLED"
                : action === "REASSIGN"
                  ? "REASSIGNED"
                  : "ALLOCATED",
            workflowState: nextWorkflowState,
            actorUid,
            actorName,
            now,
            note:
              action === "CANCEL"
                ? `Lifecycle instruction cancelled: ${cancelReason}`
                : `Lifecycle instruction ${
                    action === "REASSIGN" ? "reassigned" : "allocated"
                  } to ${newTargets?.[0]?.name || "NAv"}: ${reason || "NAv"}`,
          }),
        );

        if (allocating) {
          for (const target of newTargets) {
            const notificationRef = db.collection("notifications").doc();

            tx.set(
              notificationRef,
              buildNotificationRecord({
                trnId: row.trnId,
                trnType,
                workflowState: TRN_STATES.ISSUED,
                target,
                actorUid,
                actorName,
                now,
                reassigning: action === "REASSIGN",
              }),
            );
          }
        }
      }

      responsePayload = buildSuccessResult(
        trnIds.length === 1 ? trnIds[0] : "MULTI",
        action === "CANCEL"
          ? "Lifecycle instruction cancelled successfully"
          : `Lifecycle instruction ${
              action === "REASSIGN" ? "reassigned" : "allocated"
            } successfully`,
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
        "Lifecycle instruction management action was not processed",
      )
    );
  } catch (error) {
    logger.error("onManageLifecycleInstructionCallable -- ERROR", {
      message: error?.message || String(error),
      stack: error?.stack || "NAv",
    });

    return buildFailureResult(
      "UNKNOWN_ERROR",
      error?.message || "Failed to manage lifecycle instruction",
    );
  }
});
