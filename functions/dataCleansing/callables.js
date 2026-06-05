/* eslint-disable no-undef */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import {
  buildFailureResult,
  buildFieldAccountDataDoc,
  buildFieldAccountDataId,
  buildSuccessResult,
  getActorFromCallable,
  validateAccountDataPayload,
} from "./helpers.js";

export const onCreateAccountDataCallable = onCall(async (request) => {
  const startedAtMs = Date.now();

  const logTime = (label, extra = {}) => {
    const elapsedSeconds = ((Date.now() - startedAtMs) / 1000).toFixed(2);
    logger.info(`⏱️ onCreateAccountDataCallable -- ${label}`, {
      elapsedSeconds,
      ...extra,
    });
  };

  try {
    logTime("START");

    const db = getFirestore();
    const caller = request?.auth || null;
    const data = request?.data || {};

    if (!caller) {
      logTime("FAILED auth guard");
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const validation = validateAccountDataPayload(data);

    if (!validation.valid) {
      logTime("FAILED validation", {
        code: validation.code,
        premiseId: validation.premiseId,
      });

      return buildFailureResult(validation.code, validation.message);
    }

    const premiseId = validation.premiseId;
    const accounts = validation.accounts;
    const actor = getActorFromCallable(request);

    logTime("validation passed", {
      premiseId,
      accountCount: accounts.length,
      uid: actor.uid,
    });

    const premiseRef = db.collection("premises").doc(premiseId);
    const premiseSnap = await premiseRef.get();

    if (!premiseSnap.exists) {
      logTime("FAILED premise missing", { premiseId });

      return buildFailureResult(
        "PREMISE_NOT_FOUND",
        "Parent premise does not exist in premises collection",
      );
    }

    const now = new Date().toISOString();
    const timestampMs = Date.now();
    const fieldAccountDataId = buildFieldAccountDataId({
      timestampMs,
      premiseId,
    });

    const fieldAccountDataRef = db
      .collection("field_account_data")
      .doc(fieldAccountDataId);

    const fieldDoc = buildFieldAccountDataDoc({
      fieldAccountDataId,
      premiseId,
      premise: premiseSnap.data() || {},
      payload: data,
      accounts,
      actorUid: actor.uid,
      actorName: actor.name,
      now,
    });

    await fieldAccountDataRef.set(fieldDoc, { merge: false });

    logTime("SUCCESS END", {
      premiseId,
      fieldAccountDataId,
      accountCount: accounts.length,
    });

    return buildSuccessResult(
      fieldAccountDataId,
      "Account data saved to field_account_data successfully",
      {
        premiseId,
        accountCount: accounts.length,
      },
    );
  } catch (error) {
    logTime("ERROR END", {
      message: error?.message || String(error),
    });

    logger.error("onCreateAccountDataCallable -- ERROR", {
      message: error?.message || String(error),
      stack: error?.stack || "NAv",
    });

    if (error instanceof HttpsError) {
      throw error;
    }

    return buildFailureResult(
      "UNKNOWN_ERROR",
      error?.message || "Failed to create account data record",
    );
  }
});
