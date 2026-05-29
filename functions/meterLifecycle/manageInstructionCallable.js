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

const MANAGE_ACTIONS = ["REASSIGN", "CANCEL"];

const REASSIGN_ALLOWED_STATES = ["ISSUED", "REJECTED"];

const CANCEL_ALLOWED_STATES = ["ISSUED", "REJECTED"];

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

function buildReassignPatch({
  trnData,
  targets,
  reason,
  now,
  actorUid,
  actorName,
}) {
  const currentCount = Number(trnData?.workflow?.reassignmentCount || 0);

  return {
    "assignment.targets": targets,

    "assignment.acceptedRejectedAt": null,
    "assignment.acceptedRejectedUid": null,
    "assignment.acceptedRejectedUser": null,
    "assignment.rejectReason": "",

    "workflow.state": "ISSUED",
    "workflow.reassignedAt": now,
    "workflow.reassignedByUid": actorUid,
    "workflow.reassignedByUser": actorName,
    "workflow.reassignmentCount": currentCount + 1,

    "metadata.updatedAt": now,
    "metadata.updatedByUid": actorUid,
    "metadata.updatedByUser": actorName,

    assignmentHistory: FieldValue.arrayUnion(
      buildAssignmentHistoryItem({
        trnData,
        action: "REASSIGN",
        reason,
        now,
        actorUid,
        actorName,
      }),
    ),
  };
}

function buildCancelPatch({ trnData, cancelReason, now, actorUid, actorName }) {
  return {
    "assignment.cancelledAt": now,
    "assignment.cancelledByUid": actorUid,
    "assignment.cancelledByUser": actorName,
    "assignment.cancelReason": cancelReason,

    "workflow.state": "CANCELLED",
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
}) {
  const targetType = normalizeUpper(target?.type || "USER");
  const targetName = String(target?.name || target?.id || "NAv").trim();

  return {
    type: "MLCT_REASSIGNED",
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
      title: "Lifecycle work reassigned",
      body:
        trnType === "METER_DISCONNECTION"
          ? "A meter disconnection work item has been reassigned to you."
          : "A meter lifecycle work item has been reassigned to you.",
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
        "Only MNG and SPV(MNC) can reassign or cancel lifecycle instructions",
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

    if (!MANAGE_ACTIONS.includes(action)) {
      return buildFailureResult(
        "INVALID_MANAGE_ACTION",
        "action must be REASSIGN or CANCEL",
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

    if (action === "REASSIGN") {
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

        if (workflowState === "COMPLETED") {
          responsePayload = buildFailureResult(
            "TRN_ALREADY_COMPLETED",
            "Completed lifecycle instructions cannot be reassigned or cancelled",
            {
              trnId: row.trnId,
              trnType,
              workflowState,
            },
          );

          return;
        }

        if (workflowState === "CANCELLED") {
          responsePayload = buildFailureResult(
            "TRN_ALREADY_CANCELLED",
            "Cancelled lifecycle instructions cannot be changed",
            {
              trnId: row.trnId,
              trnType,
              workflowState,
            },
          );

          return;
        }

        if (workflowState === "IN_PROGRESS") {
          responsePayload = buildFailureResult(
            "TRN_IN_PROGRESS",
            "In-progress lifecycle instructions cannot be reassigned or cancelled",
            {
              trnId: row.trnId,
              trnType,
              workflowState,
            },
          );

          return;
        }

        if (
          action === "REASSIGN" &&
          !REASSIGN_ALLOWED_STATES.includes(workflowState)
        ) {
          responsePayload = buildFailureResult(
            "INVALID_REASSIGN_STATE",
            "Only ISSUED or REJECTED lifecycle instructions can be reassigned",
            {
              trnId: row.trnId,
              trnType,
              workflowState: workflowState || "NAv",
            },
          );

          return;
        }

        if (
          action === "CANCEL" &&
          !CANCEL_ALLOWED_STATES.includes(workflowState)
        ) {
          responsePayload = buildFailureResult(
            "INVALID_CANCEL_STATE",
            "Only ISSUED or REJECTED lifecycle instructions can be cancelled",
            {
              trnId: row.trnId,
              trnType,
              workflowState: workflowState || "NAv",
            },
          );

          return;
        }
      }

      const nextWorkflowState = action === "REASSIGN" ? "ISSUED" : "CANCELLED";

      for (const row of rows) {
        const trnType = getTrnType(row.data) || "NAv";
        const astId = getAstId(row.data);

        if (action === "REASSIGN") {
          tx.update(
            row.ref,
            buildReassignPatch({
              trnData: row.data,
              targets: newTargets,
              reason,
              now,
              actorUid,
              actorName,
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

        const assignedTo =
          action === "REASSIGN"
            ? newTargets?.[0] || {}
            : existingTargets[0] ||
              row.data?.trnActiveLifecycle?.assignedTo ||
              {};

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
            event: action === "REASSIGN" ? "REASSIGNED" : "CANCELLED",
            workflowState: nextWorkflowState,
            actorUid,
            actorName,
            now,
            note:
              action === "REASSIGN"
                ? `Lifecycle instruction reassigned and returned to ISSUED: ${
                    reason || "NAv"
                  }`
                : `Lifecycle instruction cancelled: ${cancelReason}`,
          }),
        );

        if (action === "REASSIGN") {
          for (const target of newTargets) {
            const notificationRef = db.collection("notifications").doc();

            tx.set(
              notificationRef,
              buildNotificationRecord({
                trnId: row.trnId,
                trnType,
                workflowState: "ISSUED",
                target,
                actorUid,
                actorName,
                now,
              }),
            );
          }
        }
      }

      responsePayload = buildSuccessResult(
        trnIds.length === 1 ? trnIds[0] : "MULTI",
        action === "REASSIGN"
          ? "Lifecycle instruction reassigned successfully"
          : "Lifecycle instruction cancelled successfully",
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
