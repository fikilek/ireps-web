import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import {
  buildFailureResult,
  buildSuccessResult,
  getActorNameFromRequest,
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
      const trnSnap = await tx.get(trnRef);
      const astSnap = await tx.get(astRef);
      const premiseSnap = await tx.get(premiseRef);

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

      const commissioningCheck = validateCommissioningAgainstAst({
        data,
        astDoc,
      });

      if (!commissioningCheck?.ok) {
        responsePayload = buildFailureResult(
          commissioningCheck?.code,
          commissioningCheck?.message,
          {
            trnId,
            trnType,
            astId,
            premiseId,
          },
        );

        return;
      }

      const cleanTrn = buildCommissioningTrnPayload({
        data,
        astDoc,
        now,
        actorUid,
        actorName,
      });

      tx.create(trnRef, cleanTrn);

      responsePayload = buildSuccessResult(
        trnId,
        "Commissioning TRN created successfully",
        {
          trnType,
          astId,
          premiseId,
          meterType: cleanTrn?.meterType || "NAv",
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
