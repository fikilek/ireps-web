// DR-R001 section 5 and section 9: the worker opens the form, and the office
// can see that he is busy with it. Nothing wrote IN_PROGRESS before, so a job
// the office had sent looked untouched until the moment it was finished.
//
// The phone calls this when the execution form opens. It is deliberately
// small: it moves the state and stamps the time, and it refuses anybody the
// job was not sent to.

import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import {
  IMPLEMENTED_LIFECYCLE_TRN_TYPES,
  buildFailureResult,
  buildSuccessResult,
  buildTrnActiveLifecycle,
  getActorNameFromRequest,
  normalizeUpper,
} from "./helpers.js";

import { actorIsAssignee, resolveActorIdentity } from "./assignee.js";

function readWorkflowState(trnData = {}) {
  return normalizeUpper(trnData?.workflow?.state || trnData?.workflowState || "");
}

function readTrnType(trnData = {}) {
  return normalizeUpper(trnData?.accessData?.trnType || trnData?.trnType || "");
}

function buildHistoryEvent({
  trnId,
  trnType,
  astId,
  actorUid,
  actorName,
  now,
}) {
  return {
    event: "IN_PROGRESS",
    workflowState: "IN_PROGRESS",
    outcome: "NAv",
    trnId,
    trnType,
    astId,
    note: `${trnType} opened in the field`,
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

export const onStartLifecycleInstructionCallable = onCall(async (request) => {
  try {
    const db = getFirestore();

    const data = request?.data || {};
    const authContext = request?.auth || null;

    if (!authContext?.uid) {
      return buildFailureResult("UNAUTHENTICATED", "Authentication is required");
    }

    const actorUid = authContext.uid;
    const actorName = getActorNameFromRequest(request);
    const now = new Date().toISOString();

    const trnId = String(data?.trnId || data?.instructionTrnId || "").trim();

    if (!trnId) {
      return buildFailureResult("INVALID_TRN_ID", "TRN id is required");
    }

    const actorIdentity = await resolveActorIdentity({ db, request });

    const trnRef = db.collection("trns").doc(trnId);

    let responsePayload = null;

    await db.runTransaction(async (tx) => {
      const trnSnap = await tx.get(trnRef);

      if (!trnSnap.exists) {
        responsePayload = buildFailureResult(
          "INSTRUCTION_TRN_NOT_FOUND",
          "The lifecycle instruction TRN does not exist",
          { trnId },
        );

        return;
      }

      const trnData = trnSnap.data() || {};
      const trnType = readTrnType(trnData);
      const astId = String(trnData?.ast?.astData?.astId || "").trim();
      const workflowState = readWorkflowState(trnData);

      if (!IMPLEMENTED_LIFECYCLE_TRN_TYPES.includes(trnType)) {
        responsePayload = buildFailureResult(
          "INVALID_INSTRUCTION_TRN_TYPE",
          "This transaction is not a lifecycle instruction",
          { trnId, trnType },
        );

        return;
      }

      const assigned = await actorIsAssignee({
        reader: tx,
        db,
        trnData,
        actorUid,
        actorSpId: actorIdentity?.spId || "",
      });

      if (!assigned) {
        responsePayload = buildFailureResult(
          "INSTRUCTION_NOT_ASSIGNED",
          "This work was sent to somebody else",
          { trnId, trnType, astId, actorUid },
        );

        return;
      }

      // Opening the form twice is the same thing happening twice, not an
      // error: the office already knows he is busy.
      if (workflowState === "IN_PROGRESS") {
        responsePayload = buildSuccessResult(
          trnId,
          `${trnType} is already in progress`,
          {
            trnType,
            astId,
            workflowState,
            executionStartedAt: trnData?.workflow?.executionStartedAt || null,
            idempotent: true,
          },
        );

        return;
      }

      if (workflowState !== "ACCEPTED") {
        responsePayload = buildFailureResult(
          "INSTRUCTION_NOT_ACCEPTED",
          "The work must be accepted before it can be started",
          { trnId, trnType, astId, workflowState },
        );

        return;
      }

      tx.update(trnRef, {
        "workflow.state": "IN_PROGRESS",
        "workflow.executionStartedAt": now,
        "metadata.updatedAt": now,
        "metadata.updatedByUid": actorUid,
        "metadata.updatedByUser": actorName,
      });

      if (astId) {
        const assignedTo =
          (Array.isArray(trnData?.assignment?.targets)
            ? trnData.assignment.targets[0]
            : null) || {};

        tx.update(db.collection("asts").doc(astId), {
          trnActiveLifecycle: buildTrnActiveLifecycle({
            trnId,
            trnType,
            workflowState: "IN_PROGRESS",
            outcome: "NAv",
            assignedTo,
            updatedAt: now,
            updatedByUser: actorName,
          }),
          "metadata.updatedAt": now,
          "metadata.updatedByUid": actorUid,
          "metadata.updatedByUser": actorName,
        });
      }

      tx.set(
        trnRef.collection("history").doc(),
        buildHistoryEvent({
          trnId,
          trnType,
          astId,
          actorUid,
          actorName,
          now,
        }),
      );

      responsePayload = buildSuccessResult(trnId, `${trnType} is now in progress`, {
        trnType,
        astId,
        workflowState: "IN_PROGRESS",
        executionStartedAt: now,
      });
    });

    if (responsePayload?.success !== true) {
      logger.info("onStartLifecycleInstructionCallable -- refused", {
        trnId,
        actorUid,
        code: responsePayload?.code || "NAv",
      });
    }

    return responsePayload;
  } catch (error) {
    logger.error("onStartLifecycleInstructionCallable -- ERROR", {
      message: error?.message || String(error),
    });

    return buildFailureResult(
      "UNKNOWN_ERROR",
      "The work could not be started. Try again.",
    );
  }
});
