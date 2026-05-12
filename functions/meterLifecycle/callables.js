import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import {
  IMPLEMENTED_LIFECYCLE_TRN_TYPES,
  buildFailureResult,
  buildLifecycleTrnPayload,
  buildPremiseServiceSnapshotPatch,
  buildSuccessResult,
  buildTrnActiveLifecycle,
  getActorNameFromRequest,
  getAstMeterType,
  normalizeUpper,
  validateAssignment,
  validateCommonLifecycleInput,
  validateMeterCommissioning,
  validateMeterRemoval,
  validateMeterDisconnection,
  validateMeterReconnection,
} from "./helpers.js";

function readWorkflowState(trnData = {}) {
  return normalizeUpper(
    trnData?.workflow?.state || trnData?.workflowState || "",
  );
}

function readTrnType(trnData = {}) {
  return normalizeUpper(trnData?.accessData?.trnType || trnData?.trnType || "");
}

function buildHistoryEvent({
  trnId,
  trnType,
  astId,
  event,
  workflowState,
  outcome = "NAv",
  actorUid,
  actorName,
  now,
  note = "",
}) {
  return {
    event,
    workflowState,
    outcome,
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

function buildUpdateMetadataPatch({ now, actorUid, actorName }) {
  return {
    "metadata.updatedAt": now,
    "metadata.updatedByUid": actorUid || "NAv",
    "metadata.updatedByUser": actorName || "NAv",
  };
}

function getActionCheck({ trnType, data, astDoc }) {
  if (trnType === "METER_COMMISSIONING") {
    return validateMeterCommissioning({
      data,
      astDoc,
    });
  }

  if (trnType === "METER_REMOVAL") {
    return validateMeterRemoval({
      data,
      astDoc,
    });
  }

  if (trnType === "METER_DISCONNECTION") {
    return validateMeterDisconnection({
      data,
      astDoc,
    });
  }

  if (trnType === "METER_RECONNECTION") {
    return validateMeterReconnection({
      data,
      astDoc,
    });
  }

  return {
    ok: false,
    code: "LCT_TYPE_NOT_IMPLEMENTED",
    message: `${trnType} is not implemented yet`,
  };
}

export const onMeterLifecycleTrnCallable = onCall(async (request) => {
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

    const commonCheck = validateCommonLifecycleInput(data);

    if (!commonCheck.ok) {
      return buildFailureResult(commonCheck.code, commonCheck.message);
    }

    const { trnId, trnType, astId, premiseId } = commonCheck;

    const instructionTrnId = String(data?.instructionTrnId || "").trim();
    const isWmsDisconnectionExecution =
      trnType === "METER_DISCONNECTION" && instructionTrnId === trnId;

    logger.info("onMeterLifecycleTrnCallable -- START", {
      trnId,
      instructionTrnId,
      trnType,
      astId,
      premiseId,
      actorUid,
      isWmsDisconnectionExecution,
    });

    if (!IMPLEMENTED_LIFECYCLE_TRN_TYPES.includes(trnType)) {
      return buildFailureResult(
        "LCT_TYPE_NOT_IMPLEMENTED",
        `${trnType} is not implemented yet`,
        {
          trnId,
          trnType,
          astId,
        },
      );
    }

    const assignmentCheck = validateAssignment(data?.assignment || {}, trnType);

    if (!assignmentCheck.ok) {
      return buildFailureResult(assignmentCheck.code, assignmentCheck.message, {
        trnId,
        trnType,
        astId,
      });
    }

    const trnRef = db.collection("trns").doc(trnId);
    const astRef = db.collection("asts").doc(astId);
    const premiseRef = db.collection("premises").doc(premiseId);

    let responsePayload = null;

    await db.runTransaction(async (tx) => {
      // ------------------------------------------------------------
      // READS FIRST
      // Firestore transactions must do all reads before writes.
      // ------------------------------------------------------------
      const trnSnap = await tx.get(trnRef);
      const astSnap = await tx.get(astRef);
      const premiseSnap = await tx.get(premiseRef);

      if (!astSnap.exists) {
        responsePayload = buildFailureResult(
          "AST_NOT_FOUND",
          "The referenced AST does not exist",
          {
            trnId,
            trnType,
            astId,
          },
        );

        return;
      }

      if (!premiseSnap.exists) {
        responsePayload = buildFailureResult(
          "PREMISE_NOT_FOUND",
          "The referenced premise does not exist",
          {
            trnId,
            trnType,
            astId,
            premiseId,
          },
        );

        return;
      }

      const astDoc = astSnap.data() || {};
      const premiseData = premiseSnap.data() || {};

      // ------------------------------------------------------------
      // WMS DCN EXECUTION PATH
      // DCN execution updates the existing instructionTrnId.
      // It must not create a second TRN_MDCN document.
      // ------------------------------------------------------------
      if (isWmsDisconnectionExecution) {
        if (!trnSnap.exists) {
          responsePayload = buildFailureResult(
            "INSTRUCTION_TRN_NOT_FOUND",
            "The DCN instruction TRN does not exist",
            {
              trnId,
              trnType,
              astId,
            },
          );

          return;
        }

        const existingTrn = trnSnap.data() || {};
        const existingTrnType = readTrnType(existingTrn);
        const workflowState = readWorkflowState(existingTrn);

        if (existingTrnType !== "METER_DISCONNECTION") {
          responsePayload = buildFailureResult(
            "INVALID_INSTRUCTION_TRN_TYPE",
            "The referenced instruction TRN is not a DCN instruction",
            {
              trnId,
              existingTrnType,
              trnType,
              astId,
            },
          );

          return;
        }

        if (workflowState === "COMPLETED") {
          const existingOutcome =
            existingTrn?.executionOutcome?.outcome || "NAv";

          responsePayload = buildSuccessResult(
            trnId,
            "DCN instruction is already completed",
            {
              trnType,
              astId,
              premiseId,
              astStatusAfter: astDoc?.status?.state || "NAv",
              astStatusChanged: false,
              astDataChanged: false,
              executionOutcome: existingTrn?.executionOutcome || {
                outcome: existingOutcome,
                success: existingOutcome === "SUCCESS",
              },
              idempotent: true,
            },
          );

          return;
        }

        if (["REJECTED", "CANCELLED"].includes(workflowState)) {
          responsePayload = buildFailureResult(
            "INSTRUCTION_NOT_EXECUTABLE",
            "Rejected or cancelled DCN instructions cannot be executed",
            {
              trnId,
              trnType,
              workflowState,
              astId,
            },
          );

          return;
        }

        if (workflowState !== "ACCEPTED") {
          responsePayload = buildFailureResult(
            "INSTRUCTION_NOT_ACCEPTED",
            "DCN instruction must be accepted before execution can be submitted",
            {
              trnId,
              trnType,
              workflowState,
              astId,
            },
          );

          return;
        }

        const actionCheck = validateMeterDisconnection({
          data,
          astDoc,
        });

        if (!actionCheck?.ok) {
          responsePayload = buildFailureResult(
            actionCheck?.code,
            actionCheck?.message,
            {
              trnId,
              trnType,
              astId,
            },
          );

          return;
        }

        const statusAfter = actionCheck.nextAstState;

        const cleanExecution = buildLifecycleTrnPayload({
          data,
          astDoc,
          now,
          actorUid,
          actorName,
          statusState: statusAfter,
        });

        let premiseServicePatch = null;

        if (actionCheck.astStatusChanged) {
          const servicePatchResult = buildPremiseServiceSnapshotPatch({
            premiseData,
            astId,
            meterType: getAstMeterType(astDoc, data),
            status: statusAfter,
            updatedAt: now,
          });

          if (!servicePatchResult.ok) {
            responsePayload = buildFailureResult(
              servicePatchResult.code,
              servicePatchResult.message,
              {
                trnId,
                trnType,
                astId,
              },
            );

            return;
          }

          premiseServicePatch = servicePatchResult.patch;
        }

        const executionOutcome = actionCheck.executionOutcome ||
          cleanExecution?.executionOutcome || {
            outcome: actionCheck.disconnectionPassed ? "SUCCESS" : "NO_ACCESS",
            success: actionCheck.disconnectionPassed === true,
          };

        const trnUpdatePatch = {
          "workflow.state": "COMPLETED",
          "workflow.completedAt": now,
          "workflow.completedByUid": actorUid,
          "workflow.completedByUser": actorName,

          disconnection: cleanExecution?.disconnection || {},
          executionOutcome,

          media: cleanExecution?.media || [],
          status: cleanExecution?.status || {
            state: statusAfter,
            id: astDoc?.status?.id || "NAv",
            detail: astDoc?.status?.detail || "NAv",
          },

          "accessData.access": cleanExecution?.accessData?.access || {
            hasAccess: "yes",
            reason: "NAv",
          },

          ...buildUpdateMetadataPatch({
            now,
            actorUid,
            actorName,
          }),
        };

        tx.update(trnRef, trnUpdatePatch);

        const astPatch = actionCheck?.astPatch || {};
        const astDataChanged = Object.keys(astPatch).length > 0;

        const astUpdatePatch = {
          ...astPatch,

          trnActiveLifecycle: buildTrnActiveLifecycle({
            trnId,
            trnType,
            workflowState: "COMPLETED",
            outcome: executionOutcome?.outcome || "NAv",
            updatedAt: now,
            updatedByUser: actorName,
          }),

          ...buildUpdateMetadataPatch({
            now,
            actorUid,
            actorName,
          }),
        };

        if (actionCheck.astStatusChanged) {
          astUpdatePatch["status.state"] = statusAfter;
        }

        tx.update(astRef, astUpdatePatch);

        if (actionCheck.astStatusChanged) {
          tx.update(premiseRef, {
            ...premiseServicePatch,
            ...buildUpdateMetadataPatch({
              now,
              actorUid,
              actorName,
            }),
          });
        }

        const historyRef = trnRef.collection("history").doc();

        tx.set(
          historyRef,
          buildHistoryEvent({
            trnId,
            trnType,
            astId,
            event: "COMPLETED",
            workflowState: "COMPLETED",
            outcome: executionOutcome?.outcome || "NAv",
            actorUid,
            actorName,
            now,
            note:
              executionOutcome?.outcome === "NO_ACCESS"
                ? "DCN completed with NO_ACCESS outcome"
                : "DCN completed successfully",
          }),
        );

        responsePayload = buildSuccessResult(
          trnId,
          executionOutcome?.outcome === "NO_ACCESS"
            ? "DCN completed with NO ACCESS. AST status unchanged."
            : "DCN completed and AST updated successfully",
          {
            trnType,
            astId,
            premiseId,
            astStatusAfter: statusAfter,
            astStatusChanged: actionCheck.astStatusChanged === true,
            astDataChanged,
            executionOutcome,
          },
        );

        return;
      }

      // ------------------------------------------------------------
      // CURRENT CREATE-STYLE LIFECYCLE PATH
      // This remains for non-WMS create-style lifecycle submissions.
      // ------------------------------------------------------------
      if (trnSnap.exists) {
        logger.info("onMeterLifecycleTrnCallable -- TRN already exists", {
          trnId,
          trnType,
          astId,
        });

        responsePayload = buildSuccessResult(
          trnId,
          "Lifecycle TRN already exists and is treated as successful",
          {
            trnType,
            astId,
            idempotent: true,
          },
        );

        return;
      }

      const actionCheck = getActionCheck({
        trnType,
        data,
        astDoc,
      });

      if (!actionCheck?.ok) {
        responsePayload = buildFailureResult(
          actionCheck?.code,
          actionCheck?.message,
          {
            trnId,
            trnType,
            astId,
          },
        );

        return;
      }

      const statusAfter = actionCheck.nextAstState;

      const cleanTrn = buildLifecycleTrnPayload({
        data,
        astDoc,
        now,
        actorUid,
        actorName,
        statusState: statusAfter,
      });

      let premiseServicePatch = null;

      if (actionCheck.astStatusChanged) {
        const servicePatchResult = buildPremiseServiceSnapshotPatch({
          premiseData,
          astId,
          meterType: getAstMeterType(astDoc, data),
          status: statusAfter,
          updatedAt: now,
        });

        if (!servicePatchResult.ok) {
          responsePayload = buildFailureResult(
            servicePatchResult.code,
            servicePatchResult.message,
            {
              trnId,
              trnType,
              astId,
            },
          );

          return;
        }

        premiseServicePatch = servicePatchResult.patch;
      }

      // ------------------------------------------------------------
      // WRITES
      // Audit TRN first, then AST, then premise snapshot.
      // All writes commit together or all fail together.
      // ------------------------------------------------------------
      tx.create(trnRef, cleanTrn);

      const astPatch = actionCheck?.astPatch || {};
      const astDataChanged = Object.keys(astPatch).length > 0;
      const shouldUpdateAst = actionCheck.astStatusChanged || astDataChanged;

      if (shouldUpdateAst) {
        const astUpdatePatch = {
          ...astPatch,
          ...buildUpdateMetadataPatch({
            now,
            actorUid,
            actorName,
          }),
        };

        if (actionCheck.astStatusChanged) {
          astUpdatePatch["status.state"] = statusAfter;
        }

        tx.update(astRef, astUpdatePatch);
      }

      if (actionCheck.astStatusChanged) {
        tx.update(premiseRef, {
          ...premiseServicePatch,
          ...buildUpdateMetadataPatch({
            now,
            actorUid,
            actorName,
          }),
        });
      }

      responsePayload = buildSuccessResult(
        trnId,
        actionCheck.astStatusChanged
          ? "Meter lifecycle TRN created and AST updated successfully"
          : "Meter lifecycle TRN created successfully. AST state unchanged.",
        {
          trnType,
          astId,
          premiseId,
          astStatusAfter: statusAfter,
          astStatusChanged: actionCheck.astStatusChanged === true,
          astDataChanged: actionCheck.astDataChanged === true,
        },
      );
    });

    return (
      responsePayload ||
      buildFailureResult("UNKNOWN_ERROR", "Lifecycle TRN was not processed", {
        trnId,
        trnType,
        astId,
      })
    );
  } catch (error) {
    logger.error("onMeterLifecycleTrnCallable -- ERROR", {
      message: error?.message || String(error),
      stack: error?.stack || "NAv",
    });

    return buildFailureResult(
      "UNKNOWN_ERROR",
      error?.message || "Failed to submit lifecycle transaction",
    );
  }
});
