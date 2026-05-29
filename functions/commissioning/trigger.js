import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import {
  getAstCurrentState,
  normalizeUpper,
} from "../meterLifecycle/helpers.js";

import {
  COMMISSIONING_TRN_TYPE,
  buildCommissioningAstPatch,
  getCommissioningAstId,
  validateCommissioningAgainstAst,
} from "./helpers.js";

const COMMISSIONING_TRIGGER_UID = "COMMISSIONING_TRIGGER";
const COMMISSIONING_TRIGGER_USER = "Commissioning Trigger";

function getCommissioningType(trn = {}) {
  return normalizeUpper(trn?.accessData?.trnType || trn?.trnType);
}

function isCommissioningTrn(trn = {}) {
  return getCommissioningType(trn) === COMMISSIONING_TRN_TYPE;
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

        const { actorUid, actorName } = getProcessingActor(trn);

        const astId = getCommissioningAstId(trn);

        if (!astId || astId === "NAv") {
          logger.warn("onMeterCommissioningTrnCreated -- invalid AST id", {
            trnId,
            astId,
          });
          return;
        }

        const astRef = db.collection("asts").doc(astId);
        const astSnap = await tx.get(astRef);

        if (!astSnap.exists) {
          logger.warn("onMeterCommissioningTrnCreated -- AST missing", {
            trnId,
            astId,
          });
          return;
        }

        const astDoc = astSnap.data() || {};
        const currentAstState = getAstCurrentState(astDoc);

        if (currentAstState === "CONNECTED") {
          logger.info(
            "onMeterCommissioningTrnCreated -- AST already connected",
            {
              trnId,
              astId,
            },
          );
          return;
        }

        const commissioningCheck = validateCommissioningAgainstAst({
          data: trn,
          astDoc,
        });

        if (!commissioningCheck?.ok) {
          logger.warn("onMeterCommissioningTrnCreated -- validation failed", {
            trnId,
            astId,
            code: commissioningCheck?.code,
            message: commissioningCheck?.message,
          });
          return;
        }

        if (commissioningCheck?.commissioningPassed !== true) {
          logger.info("onMeterCommissioningTrnCreated -- COMM not passed", {
            trnId,
            astId,
            currentAstState,
            nextAstState: commissioningCheck?.nextAstState || "FIELD",
          });
          return;
        }

        const astPatchResult = buildCommissioningAstPatch({
          astDoc,
          trn,
          now,
          actorUid,
          actorName,
        });

        if (!astPatchResult.ok) {
          logger.warn("onMeterCommissioningTrnCreated -- AST patch failed", {
            trnId,
            astId,
            code: astPatchResult.code,
            message: astPatchResult.message,
          });
          return;
        }

        tx.update(astRef, astPatchResult.patch);

        logger.info("onMeterCommissioningTrnCreated -- AST CONNECTED", {
          trnId,
          astId,
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
