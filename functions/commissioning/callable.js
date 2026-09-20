import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

import {
  buildFailureResult,
  buildSuccessResult,
  getActorNameFromRequest,
} from "../meterLifecycle/helpers.js";

// Targeted Batch rules TB-R059 (1.3.60): work on a meter in another team's allocated batch is refused.
import { astMeterNo, checkBatchWork, recordErfOverride } from "../targetedBatches/batch-work-guard.js";
import { recordDifferentMeterAtErf } from "../targetedBatches/differentMeterAtErf.js";

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
    // Targeted Batch rules TB-R062 (1.3.65): kept for after the transaction, so a use of the
    // illegally-connected gate is recorded only when the work itself went through.
    let batchWorkDecision = null;
    // Targeted Batch rules TB-R063 (1.3.66): the meter and the ERF this work recorded, kept for after the
    // transaction, so a Sales meter replaced at that ERF is settled only once the work itself is committed.
    let workMeterNo = "";
    let workErfId = "";

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

      // Targeted Batch rules TB-R059 (1.3.60): commissioning a meter that sits in another team's allocated
      // batch is refused, and nothing is written. The meter number comes from the AST read above.
      // Rules TB-R062 (1.3.65): so is commissioning any meter on an ERF that belongs to another team's
      // allocated batch, unless the meter is reported as illegally connected.
      const batchWorkCheck = await checkBatchWork({
        db,
        read: (refOrQuery) => tx.get(refOrQuery),
        meterNo: astMeterNo(astDoc),
        uid: actorUid,
        erfId: astDoc?.accessData?.erfId || data?.accessData?.erfId || "",
        premiseId,
        anomaly: [data, astDoc?.ast],
        log: logger,
      });

      batchWorkDecision = batchWorkCheck;
      workMeterNo = astMeterNo(astDoc);
      workErfId = astDoc?.accessData?.erfId || data?.accessData?.erfId || "";

      if (!batchWorkCheck.allowed) {
        responsePayload = buildFailureResult(
          batchWorkCheck.code,
          batchWorkCheck.message,
          {
            trnId,
            trnType,
            astId,
            premiseId,
            batch: batchWorkCheck.details,
          },
        );

        return;
      }

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

    // Targeted Batch rules TB-R062 (1.3.65): one document per use of the illegally-connected gate, written
    // once the work itself is committed, so the office can count them per worker and per team.
    if (responsePayload?.success === true) {
      await recordErfOverride({ db, decision: batchWorkDecision, trnId, trnType, log: logger });
      // Targeted Batch rules TB-R063 (1.3.66): a Sales meter was expected at this ERF under another number.
      // It has been replaced, so it reads Completed and its batch row closes. Never fails the submission.
      await recordDifferentMeterAtErf({ db, Timestamp, FieldValue, meterNo: workMeterNo, erfId: workErfId, premiseId,
        trnId, trnType, astId, uid: actorUid, log: logger });
    }

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

    // An error that already carries an iREPS code keeps it, so the phone can tell a refusal iREPS
    // decided on (TB-R059, 1.3.62) from an unknown failure.
    return buildFailureResult(
      error?.irepsCode || "UNKNOWN_ERROR",
      error?.message || "Failed to create commissioning TRN",
    );
  }
});
