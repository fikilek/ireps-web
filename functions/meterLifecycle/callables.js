import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import { writeRegistryMreadFromTrn } from "../registry/mread/writeRegistryMreadFromTrn.js";

import {
  IMPLEMENTED_LIFECYCLE_TRN_TYPES,
  buildFailureResult,
  buildLifecycleTrnPayload,
  buildPremiseServiceSnapshotPatch,
  buildSuccessResult,
  getActorNameFromRequest,
  getAstMeterType,
  normalizeUpper,
  validateAssignment,
  validateCommonLifecycleInput,
  validateMeterCommissioning,
  validateMeterInspection,
  validateMeterRemoval,
  validateMeterReading,
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

const INSTRUCTION_MEDIA_TAG = "instructionMedia";

function isMeaningfulLifecycleText(value) {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text) return false;

  return !["nav", "n/av", "n/a", "na", "null", "undefined"].includes(
    text.toLowerCase(),
  );
}

function firstMeaningfulLifecycleText(...values) {
  for (const value of values) {
    if (isMeaningfulLifecycleText(value)) return String(value).trim();
  }

  return "NAv";
}

function withResolvedNoAccessReason({ executionOutcome = {}, access = {} } = {}) {
  if (executionOutcome?.outcome !== "NO_ACCESS") return executionOutcome;

  const noAccessReason = firstMeaningfulLifecycleText(
    executionOutcome?.noAccessReason,
    executionOutcome?.reasonText,
    executionOutcome?.reason,
    access?.noAccessReason,
    access?.reasonText,
    access?.reason,
  );

  return {
    ...executionOutcome,
    noAccessReason,
    reasonText: noAccessReason,
    reason: noAccessReason,
  };
}

function withResolvedNoAccessAccessBlock(access = {}, executionOutcome = {}) {
  if (executionOutcome?.outcome !== "NO_ACCESS") return access;

  const noAccessReason = firstMeaningfulLifecycleText(
    access?.noAccessReason,
    access?.reasonText,
    access?.reason,
    executionOutcome?.noAccessReason,
    executionOutcome?.reasonText,
    executionOutcome?.reason,
  );

  return {
    ...access,
    hasAccess: "no",
    reason: noAccessReason,
    noAccessReason,
  };
}


function readMediaUniqueKey(mediaItem = {}) {
  return [
    String(mediaItem?.tag || "").trim(),
    String(mediaItem?.url || mediaItem?.uri || "").trim(),
  ].join("::");
}

function getPreservedInstructionMedia(existingMedia = []) {
  if (!Array.isArray(existingMedia)) return [];

  return existingMedia.filter((mediaItem) => {
    if (!mediaItem) return false;
    if (mediaItem?.tag !== INSTRUCTION_MEDIA_TAG) return false;

    return Boolean(mediaItem?.url || mediaItem?.uri);
  });
}

function mergeUniqueMediaGroups(mediaGroups = []) {
  const seenKeys = new Set();
  const mergedMedia = [];

  mediaGroups.forEach((mediaGroup) => {
    const safeMediaGroup = Array.isArray(mediaGroup) ? mediaGroup : [];

    safeMediaGroup.forEach((mediaItem) => {
      if (!mediaItem) return;

      const key = readMediaUniqueKey(mediaItem);

      if (seenKeys.has(key)) return;

      seenKeys.add(key);
      mergedMedia.push(mediaItem);
    });
  });

  return mergedMedia;
}

function buildWmsCompletedMedia({
  existingTrn = {},
  executionMedia = [],
} = {}) {
  const preservedInstructionMedia = getPreservedInstructionMedia(
    existingTrn?.media,
  );

  const safeExecutionMedia = Array.isArray(executionMedia)
    ? executionMedia
    : [];

  return mergeUniqueMediaGroups([
    preservedInstructionMedia,
    safeExecutionMedia,
  ]);
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

function getActionCheck({ trnType, data, astDoc, actorUid = "NAv", actorName = "NAv" }) {
  if (trnType === "METER_COMMISSIONING") {
    return validateMeterCommissioning({
      data,
      astDoc,
    });
  }

  if (trnType === "METER_INSPECTION") {
    return validateMeterInspection({
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

  if (trnType === "METER_READING") {
    return validateMeterReading({
      data,
      astDoc,
      actorUid,
      actorName,
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

    const WMS_EXECUTION_TRN_TYPES = [
      "METER_INSPECTION",
      "METER_DISCONNECTION",
      "METER_RECONNECTION",
      "METER_REMOVAL",
      "METER_READING",
    ];

    const isWmsLifecycleExecution =
      WMS_EXECUTION_TRN_TYPES.includes(trnType) && instructionTrnId === trnId;

    logger.info("onMeterLifecycleTrnCallable -- START", {
      trnId,
      instructionTrnId,
      trnType,
      astId,
      premiseId,
      actorUid,
      isWmsLifecycleExecution,
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

    if (trnType === "METER_INSPECTION" && !isWmsLifecycleExecution) {
      return buildFailureResult(
        "INSPECTION_OFFICE_WMS_ONLY",
        "Meter inspection execution must complete an accepted office-originated instruction TRN",
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
      if (isWmsLifecycleExecution) {
        if (!trnSnap.exists) {
          responsePayload = buildFailureResult(
            "INSTRUCTION_TRN_NOT_FOUND",
            "The lifecycle instruction TRN does not exist",
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

        if (existingTrnType !== trnType) {
          responsePayload = buildFailureResult(
            "INVALID_INSTRUCTION_TRN_TYPE",
            "The referenced instruction TRN type does not match the execution payload",
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
            `${trnType} instruction is already completed`,
            {
              trnType,
              astId,
              premiseId,
              astStatusAfter: astDoc?.status?.state || "NAv",
              astStatusChanged: false,
              astDataChanged: false,
              executionOutcome: existingTrn?.executionOutcome || {
                outcome: existingOutcome,
                success: ["SUCCESS", "SUCCESSFUL_READING"].includes(existingOutcome),
              },
              idempotent: true,
            },
          );

          return;
        }

        if (["REJECTED", "CANCELLED"].includes(workflowState)) {
          responsePayload = buildFailureResult(
            "INSTRUCTION_NOT_EXECUTABLE",
            "Rejected or cancelled lifecycle instructions cannot be executed",
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
            "Lifecycle instruction must be accepted before execution can be submitted",
            {
              trnId,
              trnType,
              workflowState,
              astId,
            },
          );

          return;
        }

        const actionCheck = getActionCheck({
          trnType,
          data,
          astDoc,
          actorUid,
          actorName,
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

        const passed =
          trnType === "METER_INSPECTION"
            ? actionCheck.inspectionPassed === true
            : trnType === "METER_DISCONNECTION"
              ? actionCheck.disconnectionPassed === true
              : trnType === "METER_RECONNECTION"
                ? actionCheck.reconnectionPassed === true
                : trnType === "METER_REMOVAL"
                  ? actionCheck.removalPassed === true
                  : trnType === "METER_READING"
                    ? actionCheck.readingPassed === true
                    : false;

        const baseExecutionOutcome = actionCheck.executionOutcome ||
          cleanExecution?.executionOutcome || {
            outcome:
              trnType === "METER_READING" && passed
                ? "SUCCESSFUL_READING"
                : passed
                  ? "SUCCESS"
                  : "NO_ACCESS",
            success: passed,
          };

        const executionOutcome = withResolvedNoAccessReason({
          executionOutcome: baseExecutionOutcome,
          access: cleanExecution?.accessData?.access || {},
        });

        const completedAccessBlock = withResolvedNoAccessAccessBlock(
          cleanExecution?.accessData?.access || {
            hasAccess: "yes",
            reason: "NAv",
          },
          executionOutcome,
        );

        const completedMedia = buildWmsCompletedMedia({
          existingTrn,
          executionMedia: cleanExecution?.media || [],
        });

        const trnUpdatePatch = {
          "workflow.state": "COMPLETED",
          "workflow.completedAt": now,
          "workflow.completedByUid": actorUid,
          "workflow.completedByUser": actorName,

          ...(trnType === "METER_INSPECTION"
            ? { inspection: cleanExecution?.inspection || {} }
            : {}),

          ...(trnType === "METER_DISCONNECTION"
            ? { disconnection: cleanExecution?.disconnection || {} }
            : {}),

          ...(trnType === "METER_RECONNECTION"
            ? { reconnection: cleanExecution?.reconnection || {} }
            : {}),

          ...(trnType === "METER_REMOVAL"
            ? { removal: cleanExecution?.removal || {} }
            : {}),

          ...(trnType === "METER_READING"
            ? { meterReading: cleanExecution?.meterReading || {} }
            : {}),

          executionOutcome,

          media: completedMedia,

          status: cleanExecution?.status || {
            state: statusAfter,
            id: astDoc?.status?.id || "NAv",
            detail: astDoc?.status?.detail || "NAv",
          },

          "accessData.access": completedAccessBlock,

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

          trnActiveLifecycle: FieldValue.delete(),

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
                ? `${trnType} completed with NO_ACCESS outcome`
                : `${trnType} completed successfully`,
          }),
        );

        responsePayload = buildSuccessResult(
          trnId,

          executionOutcome?.outcome === "NO_ACCESS"
            ? `${trnType} completed with NO ACCESS. AST status unchanged.`
            : trnType === "METER_READING" &&
                executionOutcome?.outcome === "UNSUCCESSFUL_READING"
              ? `${trnType} completed with UNSUCCESSFUL_READING. AST reading cache unchanged.`
              : trnType === "METER_INSPECTION"
                ? `${trnType} completed successfully. AST status unchanged.`
                : `${trnType} completed and AST updated successfully`,

          {
            trnType,
            astId,
            premiseId,
            astStatusAfter: statusAfter,
            astStatusChanged: actionCheck.astStatusChanged === true,
            astDataChanged,
            executionOutcome,
            distanceMeters: actionCheck.distanceMeters ?? null,
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
        actorUid,
        actorName,
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

      const trnToCreate =
        trnType === "METER_READING"
          ? {
              ...cleanTrn,
              executionOutcome:
                actionCheck.executionOutcome || cleanTrn?.executionOutcome,
            }
          : cleanTrn;

      // ------------------------------------------------------------
      // WRITES
      // Audit TRN first, then AST, then premise snapshot.
      // All writes commit together or all fail together.
      // ------------------------------------------------------------
      tx.create(trnRef, trnToCreate);

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
          executionOutcome: actionCheck.executionOutcome || null,
          distanceMeters: actionCheck.distanceMeters ?? null,
        },
      );
    });

    if (trnType === "METER_READING" && responsePayload?.success === true) {
      try {
        await writeRegistryMreadFromTrn({
          db,
          trnId,
          source: "MREAD_COMPLETION",
        });
      } catch (registryError) {
        logger.error("onMeterLifecycleTrnCallable -- registry_mread write failed", {
          trnId,
          trnType,
          astId,
          message: registryError?.message || String(registryError),
          stack: registryError?.stack || "NAv",
        });
      }
    }

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
