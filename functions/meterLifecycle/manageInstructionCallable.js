import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import {
  ACTIVE_LCT_WORKFLOW_STATES,
  buildFailureResult,
  saidReason,
  buildSuccessResult,
  buildTrnActiveLifecycle,
  getActorNameFromRequest,
  normalizeUpper,
  sanitizeAssignment,
  validateLifecycleInstructionAssignment,
} from "./helpers.js";
import { TRN_STATES, canMoveAs, currentState } from "./trnStateMachine.js";
import {
  getServiceProvidersHoldingLm,
  isUserAllowedInLm,
} from "../teams/helpers.js";

const MANAGE_ACTIONS = ["ALLOCATE", "REASSIGN", "CANCEL", "DELETE", "RESTORE"];

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
  // `DR-R001` 5.5: a delete FLAGS, it does not remove - the owner, 11
  // October 2026: *"lets flag it as DELETED .. lets not delete in firestore
  // .. lets just flag it"*. And it is reversible, which is the machine's
  // `create` arrow out of `Deleted`. `finalDelete` stays declared and
  // unbuilt, so the machine refuses it in words.
  DELETE: ["delete"],
  RESTORE: ["create"],
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

/**
 * WHOSE WORKER MAY BE SENT TO THIS METER. `DR-R001` 4.
 *
 * THE LIST ON THE SCREEN IS NOT A GUARD. Until 13 October 2026 this callable
 * accepted any target that was a non-empty USER, TEAM or SP: it never asked who
 * the person was. `firestore.rules` is nine lines allowing any signed-in client
 * to read, so the office page filtering its own dropdown was the whole
 * mechanism - and a page is not a mechanism. An Endumeni disconnection could be
 * allocated to a field worker of a company holding no contract for Endumeni,
 * and the server would write it, notify him and put it on his phone.
 *
 * The hierarchy is not worked out here. `functions/teams/helpers.js` already
 * held it, recursively, for teams; this asks it the municipality's question.
 *
 * TWO CHECKS, AND BOTH REFUSE IN WORDS:
 *
 *   - the person must be a FIELD WORKER - the owner's decision of 10 October
 *     2026, that supervisors and managers do not go to the field;
 *   - his company must hold the municipality, or be subcontracted to one that
 *     does, at any depth.
 *
 * A GAP IS NOT A REFUSAL. Where the municipality is not recorded on the
 * transaction, the person carries no provider, or iREPS records no main
 * contractor for that municipality, the allocation is allowed and the gap is
 * left to show. Refusing would read as "this worker is not allowed" when the
 * truth is that iREPS does not know, and would stop every allocation on a
 * municipality nobody has been assigned yet (`UI-R008`).
 *
 * TEAM and SP targets are not checked here. They belong to the batch lanes,
 * which allocate to a company or a team rather than to a man, and their own
 * rules govern them.
 */
async function checkTargetsMayWork({ db, targets, lmPcodes }) {
  const userTargets = targets.filter((target) => target.type === "USER");

  if (!userTargets.length) return { ok: true };

  // THE FIELD-WORKER RULE FIRST, AND ON ITS OWN.
  //
  // This check used to live inside the loop below, AFTER two municipality
  // gates returned early - so a job carrying no municipality, or one in a
  // municipality iREPS records no contractor for, switched off the FWR rule
  // as well. The two rules are independent: who may do field work is
  // `DR-R001` 4 and has nothing to do with which municipality the meter is
  // in. A gap in one must not excuse the other.
  const userDocs = new Map();

  for (const target of userTargets) {
    const userSnap = await db.collection("users").doc(target.id).get();

    if (!userSnap.exists) {
      return {
        ok: false,
        code: "TARGET_USER_NOT_FOUND",
        message: `${target.name} is not an iREPS user.`,
      };
    }

    const userDoc = { id: userSnap.id, ...userSnap.data() };

    userDocs.set(target.id, userDoc);

    const role = normalizeUpper(userDoc?.employment?.role || userDoc?.role || "");

    if (role !== "FWR") {
      return {
        ok: false,
        code: "TARGET_NOT_A_FIELD_WORKER",
        message: `${target.name} is a ${role || "NAv"}, and individual work goes to a field worker.`,
      };
    }
  }

  const municipalities = [...new Set(lmPcodes.filter(Boolean))];

  if (!municipalities.length) return { ok: true };

  const providersSnap = await db.collection("serviceProviders").get();
  const allServiceProviders = providersSnap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  // Nothing recorded against any of these municipalities: unknown, not empty.
  const anyHolder = municipalities.some(
    (lmPcode) => getServiceProvidersHoldingLm(lmPcode, allServiceProviders).length,
  );

  if (!anyHolder) return { ok: true };

  for (const target of userTargets) {
    const userDoc = userDocs.get(target.id);

    for (const lmPcode of municipalities) {
      const allowed = isUserAllowedInLm({
        candidateUserDoc: userDoc,
        lmPcode,
        allServiceProviders,
      });

      if (allowed === false) {
        return {
          ok: false,
          code: "TARGET_OUTSIDE_MUNICIPALITY_CONTRACT",
          message: `${target.name} works for a company that holds no contract for ${lmPcode}.`,
        };
      }
    }
  }

  return { ok: true };
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

    // AND THE CANCEL STAMPS, WHICH THIS FORGOT. Owner, 12 October 2026, on
    // TEST: a job he took back off a worker and then gave out again could
    // afterwards be neither accepted nor rejected - "Cancelled TRNs cannot be
    // accepted or rejected" - while its state plainly read ISSUED and the
    // worker plainly held it.
    //
    // The state had moved on and these had not. A reader that trusts a stamp
    // over the state then refuses for ever. Clearing the accept/reject stamps
    // and not these was the whole fault: the patch already knew that a fresh
    // allocation starts clean.
    //
    // The history keeps the record of the cancel. These four fields describe
    // the CURRENT allocation, and the current allocation was not cancelled.
    "assignment.cancelledAt": null,
    "assignment.cancelledByUid": null,
    "assignment.cancelledByUser": null,
    "assignment.cancelReason": "",
    "workflow.returnedToCreatedAt": null,

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

/**
 * Putting a job in the bin. `DR-R001` 5.5.
 *
 * The record stays and keeps everything hanging off it - its history, its
 * instruction image, its premise links - so nothing is orphaned. What it
 * stops doing is holding its meter, and that happens on the ast, not here.
 *
 * The delete's own stamps are never cleared by a later restore: the record
 * should be able to say it was once in the bin, and who put it there. Where
 * the fields and the history disagree, the history wins (5.7).
 */
function buildDeletePatch({ trnData, deleteReason, now, actorUid, actorName }) {
  return {
    "workflow.state": TRN_STATES.DELETED,
    "workflow.deletedAt": now,
    "workflow.deletedByUid": actorUid,
    "workflow.deletedByUser": actorName,
    "workflow.deleteReason": deleteReason,

    "metadata.updatedAt": now,
    "metadata.updatedByUid": actorUid,
    "metadata.updatedByUser": actorName,

    assignmentHistory: FieldValue.arrayUnion(
      buildAssignmentHistoryItem({
        trnData,
        action: "DELETE",
        reason: deleteReason,
        now,
        actorUid,
        actorName,
      }),
    ),
  };
}

/**
 * Taking it back out of the bin. `DR-R001` 5.5: `Deleted -> create`.
 *
 * It lands in `Created`, which HOLDS the meter again (5.2) - so the caller
 * must have re-run the duplication check first, because the office may have
 * issued a replacement while this one sat in the bin.
 */
function buildRestorePatch({ trnData, restoreReason, now, actorUid, actorName }) {
  return {
    "workflow.state": TRN_STATES.CREATED,
    ...RETURNED_TO_CREATED(now),
    "workflow.restoredAt": now,
    "workflow.restoredByUid": actorUid,
    "workflow.restoredByUser": actorName,

    // It comes back with nobody on it, whatever it had before.
    "assignment.targets": [],

    "metadata.updatedAt": now,
    "metadata.updatedByUid": actorUid,
    "metadata.updatedByUser": actorName,

    assignmentHistory: FieldValue.arrayUnion(
      buildAssignmentHistoryItem({
        trnData,
        action: "RESTORE",
        reason: restoreReason,
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

    // The office has taken it back, so nobody holds it: the state goes to
    // CREATED and the targets go with it. Leaving his name on it would make
    // the job his and nobody's at once (`DR-R001` 5.1).
    "workflow.state": TRN_STATES.CREATED,
    "assignment.targets": [],
    ...RETURNED_TO_CREATED(now),
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

/**
 * What happened, as the history records it. `DR-R001` 5.7.
 *
 * The event is what happened; the state is where it landed, and the two are
 * not the same word. `ALLOCATED` and `REASSIGNED` both land in `Issued`, and
 * `CANCELLED`, `DELETED` and an expiry all leave the record in a state that
 * cannot say which of them it was - so only the history can.
 */
/**
 * WHEN THE JOB CAME BACK TO THE POOL. `DR-R001` 9.2.
 *
 * The Waiting view has to say how long each job has been waiting, and nothing
 * recorded it. `workflow.issuedAt` is when it was last GIVEN OUT, so a job
 * cancelled or expired after three days would read as waiting three days when
 * it came back a minute ago - a plausible number covering a fact nobody held,
 * which `UI-R008` refuses. Only the history knew, and nothing reads the
 * history (there is no reader anywhere in either repo).
 *
 * Written by every move that lands in `Created`: a cancel, a restore and an
 * expiry. A job that has never been issued has none, and reads `NAv`.
 */
const RETURNED_TO_CREATED = (now) => ({ "workflow.returnedToCreatedAt": now });

const SUCCESS_WORD = Object.freeze({
  ALLOCATE: "allocated",
  REASSIGN: "reassigned",
  CANCEL: "cancelled",
  DELETE: "deleted",
  RESTORE: "restored",
});

const HISTORY_EVENT = Object.freeze({
  ALLOCATE: "ALLOCATED",
  REASSIGN: "REASSIGNED",
  CANCEL: "CANCELLED",
  DELETE: "DELETED",
  RESTORE: "RESTORED",
});

function historyNote({ action, cancelReason, deleteReason, restoreReason, reason, targetName }) {
  if (action === "CANCEL") return `Lifecycle instruction cancelled: ${cancelReason}`;
  if (action === "DELETE") return `Lifecycle instruction deleted: ${deleteReason}`;

  if (action === "RESTORE") {
    return `Lifecycle instruction restored, waiting to be allocated: ${restoreReason || "NAv"}`;
  }

  return `Lifecycle instruction ${
    action === "REASSIGN" ? "reassigned" : "allocated"
  } to ${targetName || "NAv"}: ${reason || "NAv"}`;
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
    // `saidReason` strips `NAv`, so a gap cannot satisfy the thing it is a
    // gap in (`DR-R001` 1.12.9).
    const reason = saidReason(data?.reason || data?.reassignmentReason);
    const cancelReason = saidReason(data?.cancelReason || data?.reason);

    // `DR-R001` 5.1: "A rejection still needs a reason. So does a
    // cancellation and a deletion." A restore is not on that list, so it may
    // carry one and is not refused for lacking one.
    const deleteReason = saidReason(data?.deleteReason || data?.reason);
    const restoreReason = saidReason(data?.restoreReason || data?.reason);

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

      // Who the person is, checked on the server. The screen's list is not a
      // guard; see `checkTargetsMayWork`.
      const trnSnapsForCheck = await Promise.all(
        trnIds.map((trnId) => db.collection("trns").doc(trnId).get()),
      );
      const lmPcodes = trnSnapsForCheck
        .filter((snap) => snap.exists)
        .map((snap) => String(snap.data()?.accessData?.parents?.lmPcode || "").trim());

      const mayWork = await checkTargetsMayWork({
        db,
        targets: newTargets,
        lmPcodes,
      });

      if (!mayWork.ok) {
        return buildFailureResult(mayWork.code, mayWork.message);
      }
    }

    if (action === "CANCEL" && !cancelReason) {
      return buildFailureResult(
        "CANCEL_REASON_REQUIRED",
        "Cancel reason is required when cancelling lifecycle instructions",
      );
    }

    if (action === "DELETE" && !deleteReason) {
      return buildFailureResult(
        "DELETE_REASON_REQUIRED",
        "Say why this work is being deleted.",
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

      // One meter and one kind of work may be restored once per call.
      const restoringLanes = new Map();

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

        // A RESTORE PUTS A JOB BACK ON A METER, so it has to ask the
        // question a create asks: is one of this kind already out?
        // `DR-R001` 5.2 - never two of the same kind. The office may have
        // issued a replacement while this one sat in the bin, and a restore
        // that wrote over it would leave two live jobs on one meter and
        // steal the replacement's hold.
        //
        // This job itself cannot match: it is DELETED, and the query is a
        // whitelist of the three states that hold the meter.
        if (action === "RESTORE") {
          const already = await tx.get(
            db
              .collection("trns")
              .where("ast.astData.astId", "==", astId)
              .where("accessData.trnType", "==", trnType)
              .where("workflow.state", "in", ACTIVE_LCT_WORKFLOW_STATES)
              .limit(1),
          );

          if (!already.empty) {
            responsePayload = buildFailureResult(
              "ACTIVE_LCT_ALREADY_EXISTS",
              "This meter already has an open job of this kind, so the deleted one cannot come back. Finish or cancel that one first.",
              {
                trnId: row.trnId,
                trnType,
                astId,
                blockingTrnId: already.docs[0].id,
              },
            );

            return;
          }

          // And not twice in one call either. Two restores of the same kind
          // on one meter would both pass the query above, because neither is
          // in an active state yet.
          const lane = `${astId}::${trnType}`;

          if (restoringLanes.has(lane)) {
            responsePayload = buildFailureResult(
              "ACTIVE_LCT_ALREADY_EXISTS",
              "Two deleted jobs of the same kind cannot both come back to one meter. Restore them one at a time.",
              { trnId: row.trnId, trnType, astId, alsoRestoring: restoringLanes.get(lane) },
            );

            return;
          }

          restoringLanes.set(lane, row.trnId);
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

        if (action === "DELETE") {
          tx.update(
            row.ref,
            buildDeletePatch({
              trnData: row.data,
              deleteReason,
              now,
              actorUid,
              actorName,
            }),
          );
        }

        if (action === "RESTORE") {
          tx.update(
            row.ref,
            buildRestorePatch({
              trnData: row.data,
              restoreReason,
              now,
              actorUid,
              actorName,
            }),
          );
        }

        // After a cancel nobody holds it, so the meter's marker names
        // nobody. The meter is still held - CREATED holds it (5.2) - by a
        // job waiting to be given out rather than by a worker.
        const assignedTo = allocating ? newTargets?.[0] || {} : {};

        // THE METER'S MARKER, AND THE ONE CASE WHERE IT IS REMOVED.
        //
        // `DR-R001` 5.5: "The meter is released the moment a job is flagged
        // deleted." `Deleted` is not a job out (5.2), so the marker goes -
        // the field is REMOVED with `FieldValue.delete()`, which is exactly
        // what a completed job does (`meterLifecycle/callables.js`). Not
        // null, not `{}`, and not the job with DELETED stamped on it: the
        // registry row's copy is made from the marker's PRESENCE, so a
        // marker left naming a deleted job would keep the Meter Registry's
        // launch button showing work already out on that meter.
        //
        // Nothing writes `registry_meters/{astId}.openJob` directly and
        // nothing should. Removing the marker is what frees it: the ast
        // write fires `onMeterUpdated`, which rebuilds the row, and the
        // rebuild reads no trnId and writes `openJob: null`.
        if (action === "DELETE") {
          // ONLY IF IT NAMES THIS JOB, and matched on the id ALONE.
          //
          // The marker is a single field, so it may be naming a different
          // kind of job on the same meter - an inspection, while a
          // disconnection is deleted - and clearing it blindly would
          // release that one's hold too.
          //
          // Never matched on the marker's state: the state written there is
          // not always the transaction's own. BGO writes
          // `WAITING_BATCH_ACCEPTANCE`, which the five states cannot place
          // at all.
          const marker = astSnapsById.get(astId)?.data()?.trnActiveLifecycle;

          if (String(marker?.trnId || "").trim() === row.trnId) {
            tx.update(db.collection("asts").doc(astId), {
              trnActiveLifecycle: FieldValue.delete(),

              // The stamp is not decoration: `onMeterUpdated` and the
              // registry rebuild both key off it.
              "metadata.updatedAt": now,
              "metadata.updatedByUid": actorUid,
              "metadata.updatedByUser": actorName,
            });
          }
        } else {
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
        }

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
            event: HISTORY_EVENT[action] || "ALLOCATED",
            workflowState: nextWorkflowState,
            actorUid,
            actorName,
            now,
            note: historyNote({
              action,
              cancelReason,
              deleteReason,
              restoreReason,
              reason,
              targetName: newTargets?.[0]?.name,
            }),
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
        SUCCESS_WORD[action]
          ? `Lifecycle instruction ${SUCCESS_WORD[action]} successfully`
          : "Lifecycle instruction allocated successfully",
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
