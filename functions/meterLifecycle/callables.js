import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import {
  IMPLEMENTED_LIFECYCLE_TRN_TYPES,
  buildFailureResult,
  buildLifecycleTrnPayload,
  buildPremiseServiceSnapshotPatch,
  buildSuccessResult,
  getActorNameFromRequest,
  getAstMeterType,
  validateAssignment,
  validateCommonLifecycleInput,
  validateMeterCommissioning,
  validateMeterRemoval,
  validateMeterDisconnection,
  validateMeterReconnection,
} from "./helpers.js";

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

    logger.info("onMeterLifecycleTrnCallable -- START", {
      trnId,
      trnType,
      astId,
      premiseId,
      actorUid,
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

      // ------------------------------------------------------------
      // IDEMPOTENCY
      // If the client retries after timeout/offline sync, do not edit.
      // Treat existing immutable TRN as success.
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
      // ACTION-SPECIFIC VALIDATION
      // ------------------------------------------------------------
      let actionCheck = null;

      if (trnType === "METER_COMMISSIONING") {
        actionCheck = validateMeterCommissioning({
          data,
          astDoc,
        });
      } else if (trnType === "METER_REMOVAL") {
        actionCheck = validateMeterRemoval({
          data,
          astDoc,
        });
      } else if (trnType === "METER_DISCONNECTION") {
        actionCheck = validateMeterDisconnection({
          data,
          astDoc,
        });
      } else if (trnType === "METER_RECONNECTION") {
        actionCheck = validateMeterReconnection({
          data,
          astDoc,
        });
      } else {
        actionCheck = {
          ok: false,
          code: "LCT_TYPE_NOT_IMPLEMENTED",
          message: `${trnType} is not implemented yet`,
        };
      }

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

      if (actionCheck.astStatusChanged) {
        const astPatch = actionCheck?.astPatch || {};
        const astDataChanged = Object.keys(astPatch).length > 0;
        const shouldUpdateAst = actionCheck.astStatusChanged || astDataChanged;

        if (shouldUpdateAst) {
          const astUpdatePatch = {
            ...astPatch,
            "metadata.updatedAt": now,
            "metadata.updatedByUid": actorUid,
            "metadata.updatedByUser": actorName,
          };

          if (actionCheck.astStatusChanged) {
            astUpdatePatch["status.state"] = statusAfter;
          }

          tx.update(astRef, astUpdatePatch);
        }

        if (actionCheck.astStatusChanged) {
          tx.update(premiseRef, {
            ...premiseServicePatch,
            "metadata.updatedAt": now,
            "metadata.updatedByUid": actorUid,
            "metadata.updatedByUser": actorName,
          });
        }
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
