import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import {
  getAstCurrentState,
  getAstMeterType,
  normalizeUpper,
} from "../meterLifecycle/helpers.js";

import {
  COMMISSIONING_TRN_TYPE,
  buildCommissioningAstPatch,
  buildCommissioningMasterPatch,
  buildCommissioningPremisePatch,
  buildCommissioningProcessingPatch,
  getCommissioningAstId,
  getCommissioningPremiseId,
  shouldApplyCommissioningAstUpdate,
  validateCommissioningAgainstAst,
} from "./helpers.js";

const COMMISSIONING_TRIGGER_UID = "COMMISSIONING_TRIGGER";
const COMMISSIONING_TRIGGER_USER = "Commissioning Trigger";

function getCommissioningType(trn = {}) {
  return normalizeUpper(
    trn?.accessData?.trnType ||
      trn?.trnType ||
      trn?.assignment?.instruction?.code,
  );
}

function isCommissioningTrn(trn = {}) {
  return getCommissioningType(trn) === COMMISSIONING_TRN_TYPE;
}

function getProcessingState(trn = {}) {
  return normalizeUpper(trn?.processing?.commissioning?.state || "");
}

function getProcessingActor(trn = {}) {
  const metadata = trn?.metadata || {};

  return {
    actorUid:
      metadata?.updatedByUid ||
      metadata?.createdByUid ||
      COMMISSIONING_TRIGGER_UID,

    actorName:
      metadata?.updatedByUser ||
      metadata?.createdByUser ||
      COMMISSIONING_TRIGGER_USER,
  };
}

function isAlreadyProcessed(state) {
  return [
    "AST_UPDATED",
    "AST_ALREADY_CONNECTED",
    "VALIDATION_FAILED",
    "PATCH_FAILED",
  ].includes(normalizeUpper(state));
}

function buildFailureProcessingPatch({
  now,
  actorUid,
  actorName,
  code,
  message,
  astStatusAfter = "NAv",
}) {
  return {
    "processing.commissioning.state": "VALIDATION_FAILED",
    "processing.commissioning.code": code || "COMMISSIONING_PROCESSING_FAILED",
    "processing.commissioning.message":
      message || "Commissioning processing failed",
    "processing.commissioning.processedAt": now,
    "processing.commissioning.processedByUid": actorUid,
    "processing.commissioning.processedByUser": actorName,
    "processing.commissioning.astStatusAfter": astStatusAfter,
    "processing.commissioning.trigger": "onMeterCommissioningTrnCreated",

    "metadata.updatedAt": now,
    "metadata.updatedByUid": actorUid,
    "metadata.updatedByUser": actorName,
  };
}

export const onMeterCommissioningTrnCreated = onDocumentCreated(
  "trns/{trnId}",
  async (event) => {
    const db = getFirestore();
    const trnId = event.params.trnId;

    try {
      const createdSnap = event.data;

      if (!createdSnap?.exists) {
        logger.info("onMeterCommissioningTrnCreated -- no snapshot", {
          trnId,
        });
        return null;
      }

      const createdTrn = createdSnap.data() || {};

      if (!isCommissioningTrn(createdTrn)) {
        return null;
      }

      logger.info("onMeterCommissioningTrnCreated -- START", {
        trnId,
        trnType: getCommissioningType(createdTrn),
      });

      const trnRef = db.collection("trns").doc(trnId);

      await db.runTransaction(async (tx) => {
        const now = new Date().toISOString();

        // ------------------------------------------------------------
        // READ CURRENT TRN FIRST
        // The event snapshot is the create-time snapshot. Reading the
        // current doc makes this trigger safe on retries.
        // ------------------------------------------------------------
        const trnSnap = await tx.get(trnRef);

        if (!trnSnap.exists) {
          logger.warn("onMeterCommissioningTrnCreated -- TRN missing", {
            trnId,
          });
          return;
        }

        const trn = trnSnap.data() || {};

        if (!isCommissioningTrn(trn)) {
          return;
        }

        const existingProcessingState = getProcessingState(trn);

        if (isAlreadyProcessed(existingProcessingState)) {
          logger.info("onMeterCommissioningTrnCreated -- already processed", {
            trnId,
            existingProcessingState,
          });
          return;
        }

        const { actorUid, actorName } = getProcessingActor(trn);

        const astId = getCommissioningAstId(trn);
        const premiseId = getCommissioningPremiseId(trn);

        if (!astId || astId === "NAv") {
          tx.update(
            trnRef,
            buildFailureProcessingPatch({
              now,
              actorUid,
              actorName,
              code: "INVALID_AST_ID",
              message: "Commissioning TRN does not have a valid AST id",
            }),
          );
          return;
        }

        if (!premiseId || premiseId === "NAv") {
          tx.update(
            trnRef,
            buildFailureProcessingPatch({
              now,
              actorUid,
              actorName,
              code: "INVALID_PREMISE_ID",
              message: "Commissioning TRN does not have a valid premise id",
            }),
          );
          return;
        }

        const astRef = db.collection("asts").doc(astId);
        const premiseRef = db.collection("premises").doc(premiseId);

        // ------------------------------------------------------------
        // READS FIRST
        // ------------------------------------------------------------
        const astSnap = await tx.get(astRef);
        const premiseSnap = await tx.get(premiseRef);

        if (!astSnap.exists) {
          tx.update(
            trnRef,
            buildFailureProcessingPatch({
              now,
              actorUid,
              actorName,
              code: "AST_NOT_FOUND",
              message: "The referenced AST does not exist",
            }),
          );
          return;
        }

        if (!premiseSnap.exists) {
          tx.update(
            trnRef,
            buildFailureProcessingPatch({
              now,
              actorUid,
              actorName,
              code: "PREMISE_NOT_FOUND",
              message: "The referenced premise does not exist",
            }),
          );
          return;
        }

        const astDoc = astSnap.data() || {};
        const premiseData = premiseSnap.data() || {};

        const currentAstState = getAstCurrentState(astDoc);
        const targetStatusState = normalizeUpper(trn?.status?.state);

        // ------------------------------------------------------------
        // IDEMPOTENCY
        // If AST is already CONNECTED from a previous successful run,
        // do not fail validation just because the AST is no longer FIELD.
        // ------------------------------------------------------------
        if (
          currentAstState === "CONNECTED" &&
          targetStatusState === "CONNECTED"
        ) {
          tx.update(trnRef, {
            ...buildCommissioningProcessingPatch({
              actionCheck: {
                ok: true,
                commissioningPassed: true,
                nextAstState: "CONNECTED",
              },
              now,
              actorUid,
              actorName,
              processingState: "AST_ALREADY_CONNECTED",
              message:
                "Commissioning TRN already reflected on AST. No update required.",
            }),
            "processing.commissioning.trigger":
              "onMeterCommissioningTrnCreated",
          });

          logger.info(
            "onMeterCommissioningTrnCreated -- AST already connected",
            {
              trnId,
              astId,
            },
          );

          return;
        }

        // ------------------------------------------------------------
        // REPLAY CRITICAL VALIDATION
        // This reuses the COMM validation: FIELD-only, electricity-only,
        // evidence requirements, and failed-answer notes.
        // ------------------------------------------------------------
        const actionCheck = validateCommissioningAgainstAst({
          data: trn,
          astDoc,
        });

        if (!actionCheck?.ok) {
          tx.update(
            trnRef,
            buildFailureProcessingPatch({
              now,
              actorUid,
              actorName,
              code: actionCheck?.code || "COMMISSIONING_VALIDATION_FAILED",
              message:
                actionCheck?.message || "Commissioning validation failed",
              astStatusAfter: currentAstState,
            }),
          );

          logger.warn("onMeterCommissioningTrnCreated -- validation failed", {
            trnId,
            astId,
            code: actionCheck?.code,
            message: actionCheck?.message,
          });

          return;
        }

        const statusAfter = normalizeUpper(actionCheck?.nextAstState);

        if (!shouldApplyCommissioningAstUpdate(actionCheck)) {
          tx.update(trnRef, {
            ...buildCommissioningProcessingPatch({
              actionCheck,
              now,
              actorUid,
              actorName,
              processingState: "AST_UNCHANGED",
              message:
                "Commissioning TRN was processed. AST status was not changed.",
            }),
            "status.state": statusAfter,
            "processing.commissioning.trigger":
              "onMeterCommissioningTrnCreated",
          });

          logger.info("onMeterCommissioningTrnCreated -- AST unchanged", {
            trnId,
            astId,
            statusAfter,
          });

          return;
        }

        const astPatchResult = buildCommissioningAstPatch({
          actionCheck,
          now,
          actorUid,
          actorName,
        });

        if (!astPatchResult.ok) {
          tx.update(
            trnRef,
            buildFailureProcessingPatch({
              now,
              actorUid,
              actorName,
              code: astPatchResult.code,
              message: astPatchResult.message,
              astStatusAfter: currentAstState,
            }),
          );
          return;
        }

        const premisePatchResult = buildCommissioningPremisePatch({
          premiseData,
          astId,
          meterType: getAstMeterType(astDoc, trn),
          status: statusAfter,
          now,
          actorUid,
          actorName,
        });

        if (!premisePatchResult.ok) {
          tx.update(
            trnRef,
            buildFailureProcessingPatch({
              now,
              actorUid,
              actorName,
              code: premisePatchResult.code,
              message: premisePatchResult.message,
              astStatusAfter: currentAstState,
            }),
          );
          return;
        }

        const masterPatchResult = buildCommissioningMasterPatch({
          trn,
          astDoc,
          statusState: statusAfter,
          now,
          actorUid,
          actorName,
        });

        if (!masterPatchResult.ok) {
          tx.update(
            trnRef,
            buildFailureProcessingPatch({
              now,
              actorUid,
              actorName,
              code: masterPatchResult.code,
              message: masterPatchResult.message,
              astStatusAfter: currentAstState,
            }),
          );
          return;
        }

        const masterRef = db
          .collection("meter_master")
          .doc(masterPatchResult.meterNo);

        // ------------------------------------------------------------
        // WRITES
        // TRN already exists as audit source.
        // This trigger applies derived state changes.
        // ------------------------------------------------------------
        tx.update(astRef, astPatchResult.patch);
        tx.update(premiseRef, premisePatchResult.patch);
        tx.set(masterRef, masterPatchResult.patch, { merge: true });

        tx.update(trnRef, {
          ...buildCommissioningProcessingPatch({
            actionCheck,
            now,
            actorUid,
            actorName,
            processingState: "AST_UPDATED",
            message:
              "Commissioning processed successfully. AST updated to CONNECTED.",
          }),
          "status.state": statusAfter,
          "processing.commissioning.trigger": "onMeterCommissioningTrnCreated",
        });

        logger.info("onMeterCommissioningTrnCreated -- SUCCESS", {
          trnId,
          astId,
          premiseId,
          statusAfter,
          meterMasterId: masterPatchResult.meterNo,
        });
      });

      return null;
    } catch (error) {
      logger.error("onMeterCommissioningTrnCreated -- ERROR", {
        trnId,
        message: error?.message || String(error),
        stack: error?.stack || "NAv",
      });

      return null;
    }
  },
);
