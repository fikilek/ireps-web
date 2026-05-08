import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import {
  buildFailureResult,
  buildSuccessResult,
  getActorNameFromRequest,
  getAstMeterType,
  normalizeUpper,
} from "../meterLifecycle/helpers.js";

import {
  COMMISSIONING_TRN_TYPE,
  buildCommissioningTrnPayload,
  validateCommissioningAgainstAst,
  validateCommissioningCreateInput,
} from "./helpers.js";

export const onCreateMeterCommissioningCallable = onCall(async (request) => {
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

    const inputCheck = validateCommissioningCreateInput(data);

    if (!inputCheck.ok) {
      return buildFailureResult(inputCheck.code, inputCheck.message);
    }

    const { trnId, trnType, astId, premiseId } = inputCheck;

    logger.info("onCreateMeterCommissioningCallable -- START", {
      trnId,
      trnType,
      astId,
      premiseId,
      actorUid,
    });

    if (trnType !== COMMISSIONING_TRN_TYPE) {
      return buildFailureResult(
        "INVALID_COMMISSIONING_TRN_TYPE",
        "Only METER_COMMISSIONING is supported by this callable",
        {
          trnId,
          trnType,
          astId,
        },
      );
    }

    const trnRef = db.collection("trns").doc(trnId);
    const astRef = db.collection("asts").doc(astId);
    const premiseRef = db.collection("premises").doc(premiseId);

    let responsePayload = null;

    await db.runTransaction(async (tx) => {
      // ------------------------------------------------------------
      // READS FIRST
      // Firestore transactions require all reads before writes.
      // ------------------------------------------------------------
      const trnSnap = await tx.get(trnRef);
      const astSnap = await tx.get(astRef);
      const premiseSnap = await tx.get(premiseRef);

      // ------------------------------------------------------------
      // IDEMPOTENCY
      // If client retries after timeout/offline sync, do not duplicate.
      // Treat existing immutable COMM TRN as success.
      // ------------------------------------------------------------
      if (trnSnap.exists) {
        logger.info(
          "onCreateMeterCommissioningCallable -- TRN already exists",
          {
            trnId,
            trnType,
            astId,
          },
        );

        responsePayload = buildSuccessResult(
          trnId,
          "Commissioning TRN already exists and is treated as successful",
          {
            trnType,
            astId,
            premiseId,
            idempotent: true,
            processingState: "TRN_ALREADY_EXISTS",
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
            premiseId,
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

      // ------------------------------------------------------------
      // COMMISSIONING VALIDATION
      // Validates FIELD-only, electricity-only, answers, notes, media.
      // This is validation only. AST updates happen in the trigger.
      // ------------------------------------------------------------
      const actionCheck = validateCommissioningAgainstAst({
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
            premiseId,
          },
        );

        return;
      }

      const statusAfter = normalizeUpper(
        actionCheck?.nextAstState || data?.status?.state || "FIELD",
      );

      const cleanTrn = buildCommissioningTrnPayload({
        data,
        astDoc,
        now,
        actorUid,
        actorName,
        statusState: statusAfter,
      });

      // ------------------------------------------------------------
      // WRITE ONLY THE AUDIT TRN
      // Do not update AST, premise, or meter_master here.
      // onMeterCommissioningTrnCreated will process the TRN.
      // ------------------------------------------------------------
      tx.create(trnRef, cleanTrn);

      responsePayload = buildSuccessResult(
        trnId,
        "Commissioning TRN created successfully",
        {
          trnType,
          astId,
          premiseId,
          meterType: getAstMeterType(astDoc, data),
          commissioningPassed: actionCheck?.commissioningPassed === true,
          astStatusBefore: actionCheck?.currentState || "NAv",
          astStatusAfter: statusAfter,
          astStatusChanged: false,
          processingState: "TRN_CREATED",
        },
      );
    });

    return (
      responsePayload ||
      buildFailureResult("UNKNOWN_ERROR", "Commissioning TRN was not created", {
        trnId,
        trnType,
        astId,
        premiseId,
      })
    );
  } catch (error) {
    logger.error("onCreateMeterCommissioningCallable -- ERROR", {
      message: error?.message || String(error),
      stack: error?.stack || "NAv",
    });

    return buildFailureResult(
      "UNKNOWN_ERROR",
      error?.message || "Failed to create commissioning TRN",
    );
  }
});
