/* eslint-disable no-undef */

import {
  onDocumentCreated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import {
  buildAccountMasterDoc,
  buildAccountMasterId,
  cleanAccounts,
  DATA_CLEANSING_SYSTEM_UID,
  mergeAccountRefs,
  rebuildRegistryAccountsForPremise,
} from "./helpers.js";

const FIELD_ACCOUNT_DATA_PROCESSOR_USER = "Field Account Data Processor";
const ACCOUNT_DATA_SYNC_USER = "Account Data Sync";
const ACCOUNT_MASTER_REGISTRY_SYNC_USER = "Account Master Registry Sync";

async function markFieldAccountDataFailed({
  ref,
  code = "UNKNOWN_ERROR",
  message = "Failed to process account data",
} = {}) {
  const now = new Date().toISOString();

  await ref.update({
    "processing.accountMasterStatus": "FAILED",
    "processing.errorCode": code,
    "processing.errorMessage": message,
    "processing.processedAt": now,
    "metadata.updatedAt": now,
    "metadata.updatedByUid": DATA_CLEANSING_SYSTEM_UID,
    "metadata.updatedByUser": FIELD_ACCOUNT_DATA_PROCESSOR_USER,
  });
}

async function processFieldAccountData({ fieldAccountDataId, ref, data }) {
  const db = getFirestore();
  const now = new Date().toISOString();

  const premiseId = data?.premise?.premiseId || "NAv";
  const lmPcode = data?.geography?.lmPcode || "NAv";
  const accounts = cleanAccounts(data?.accounts || []);

  if (!fieldAccountDataId || !data?.id) {
    throw new Error("Invalid field_account_data payload: id is required");
  }

  if (!premiseId || premiseId === "NAv") {
    throw new Error(
      "Invalid field_account_data payload: premise.premiseId is required",
    );
  }

  if (accounts.length === 0) {
    throw new Error(
      "Invalid field_account_data payload: at least one account is required",
    );
  }

  const premiseRef = db.collection("premises").doc(premiseId);
  const premiseSnap = await premiseRef.get();

  if (!premiseSnap.exists) {
    throw new Error(`Premise not found for account data: ${premiseId}`);
  }

  const accountMasterIds = accounts.map((account) =>
    buildAccountMasterId({
      lmPcode,
      accountNoNormalized: account.accountNo,
    }),
  );

  const accountMasterRefs = accountMasterIds.map((accountMasterId) =>
    db.collection("account_master").doc(accountMasterId),
  );

  const accountMasterSnaps = await Promise.all(
    accountMasterRefs.map((accountMasterRef) => accountMasterRef.get()),
  );

  const accountMasterDocs = accountMasterRefs.map((accountMasterRef, index) => {
    const account = accounts[index];
    const accountMasterSnap = accountMasterSnaps[index];

    return buildAccountMasterDoc({
      accountMasterId: accountMasterRef.id,
      accountNoNormalized: account.accountNo,
      fieldData: data,
      existingAccountMaster: accountMasterSnap.exists
        ? accountMasterSnap.data() || {}
        : null,
      now,
    });
  });

  const premiseData = premiseSnap.data() || {};
  const nextAccountRefs = mergeAccountRefs(
    premiseData?.accountRefs || [],
    accountMasterIds.map((accountMasterId) => ({ accountMasterId })),
  );

  const batch = db.batch();

  accountMasterRefs.forEach((accountMasterRef, index) => {
    batch.set(accountMasterRef, accountMasterDocs[index], { merge: true });
  });

  batch.update(premiseRef, {
    accountRefs: nextAccountRefs,
    "metadata.updatedAt": now,
    "metadata.updatedByUid": DATA_CLEANSING_SYSTEM_UID,
    "metadata.updatedByUser": ACCOUNT_DATA_SYNC_USER,
  });

  batch.update(ref, {
    "processing.accountMasterStatus": "UPDATED",
    "processing.accountMasterIds": accountMasterIds,
    "processing.errorCode": "NAv",
    "processing.errorMessage": "NAv",
    "processing.processedAt": now,
    "metadata.updatedAt": now,
    "metadata.updatedByUid": DATA_CLEANSING_SYSTEM_UID,
    "metadata.updatedByUser": FIELD_ACCOUNT_DATA_PROCESSOR_USER,
  });

  await batch.commit();

  return {
    premiseId,
    accountMasterIds,
    accountCount: accountMasterIds.length,
  };
}

export const onFieldAccountDataWritten = onDocumentCreated(
  "field_account_data/{fieldAccountDataId}",
  async (event) => {
    const startedAtMs = Date.now();
    const fieldAccountDataId = event.params.fieldAccountDataId;
    const snap = event.data;

    const logTime = (label, extra = {}) => {
      const elapsedSeconds = ((Date.now() - startedAtMs) / 1000).toFixed(2);
      logger.info(`⏱️ onFieldAccountDataWritten -- ${label}`, {
        elapsedSeconds,
        fieldAccountDataId,
        ...extra,
      });
    };

    try {
      logTime("START");

      if (!snap?.exists) {
        logTime("no snapshot");
        return null;
      }

      const data = snap.data() || {};
      const currentStatus = data?.processing?.accountMasterStatus || "PENDING";

      if (currentStatus === "UPDATED") {
        logTime("already processed");
        return null;
      }

      const result = await processFieldAccountData({
        fieldAccountDataId,
        ref: snap.ref,
        data,
      });

      logTime("SUCCESS END", result);

      return result;
    } catch (error) {
      const message = error?.message || String(error);

      logger.error("onFieldAccountDataWritten -- ERROR", {
        fieldAccountDataId,
        message,
        stack: error?.stack || "NAv",
      });

      if (snap?.ref) {
        await markFieldAccountDataFailed({
          ref: snap.ref,
          code: "PROCESSING_FAILED",
          message,
        }).catch((markError) => {
          logger.error("onFieldAccountDataWritten -- failed to mark FAILED", {
            fieldAccountDataId,
            message: markError?.message || String(markError),
          });
        });
      }

      logTime("ERROR END", { message });

      return null;
    }
  },
);

async function bumpPremiseAndErfAfterAccountRegistrySync({
  db,
  premiseId,
  updatedAt,
} = {}) {
  if (!premiseId || premiseId === "NAv") return null;

  const premiseRef = db.collection("premises").doc(premiseId);
  const premiseSnap = await premiseRef.get();

  if (!premiseSnap.exists) {
    logger.warn(
      "bumpPremiseAndErfAfterAccountRegistrySync -- premise not found",
      { premiseId },
    );
    return null;
  }

  const premise = premiseSnap.data() || {};
  const erfId = premise?.erfId || null;

  const patch = {
    "metadata.updatedAt": updatedAt,
    "metadata.updatedByUid": DATA_CLEANSING_SYSTEM_UID,
    "metadata.updatedByUser": ACCOUNT_MASTER_REGISTRY_SYNC_USER,
  };

  await premiseRef.update(patch);

  if (erfId && erfId !== "NAv") {
    await db
      .collection("ireps_erfs")
      .doc(erfId)
      .update(patch)
      .catch((error) => {
        logger.warn(
          "bumpPremiseAndErfAfterAccountRegistrySync -- ERF bump skipped",
          {
            premiseId,
            erfId,
            message: error?.message || String(error),
          },
        );
      });
  }

  return {
    premiseId,
    erfId: erfId || "NAv",
  };
}

export const onAccountMasterWritten = onDocumentWritten(
  "account_master/{accountMasterId}",
  async (event) => {
    const startedAtMs = Date.now();
    const accountMasterId = event.params.accountMasterId;
    const beforeSnap = event.data?.before;
    const afterSnap = event.data?.after;

    const logTime = (label, extra = {}) => {
      const elapsedSeconds = ((Date.now() - startedAtMs) / 1000).toFixed(2);
      logger.info(`⏱️ onAccountMasterWritten -- ${label}`, {
        elapsedSeconds,
        accountMasterId,
        ...extra,
      });
    };

    try {
      logTime("START");

      const afterExists = Boolean(afterSnap?.exists);
      const beforeExists = Boolean(beforeSnap?.exists);

      if (!afterExists && !beforeExists) {
        logTime("no before/after snapshot");
        return null;
      }

      const afterData = afterExists ? afterSnap.data() || {} : null;
      const beforeData = beforeExists ? beforeSnap.data() || {} : null;

      const premiseId =
        afterData?.premise?.premiseId || beforeData?.premise?.premiseId || "NAv";

      if (!premiseId || premiseId === "NAv") {
        logTime("missing premiseId, skipping registry_accounts rebuild");
        return null;
      }

      const latestFieldAccountDataId =
        afterData?.refs?.latestFieldAccountDataId ||
        beforeData?.refs?.latestFieldAccountDataId ||
        "NAv";

      const db = getFirestore();
      const registryRow = await rebuildRegistryAccountsForPremise({
        premiseId,
        latestFieldAccountDataId,
      });

      const updatedAt = new Date().toISOString();

      await bumpPremiseAndErfAfterAccountRegistrySync({
        db,
        premiseId,
        updatedAt,
      });

      logTime("SUCCESS END", {
        premiseId,
        latestFieldAccountDataId,
        registryStatus: registryRow?.reconciliation?.status || "NAv",
        accountCount: registryRow?.accounts?.length || 0,
        meterCount: registryRow?.meters?.length || 0,
      });

      return {
        success: true,
        premiseId,
        latestFieldAccountDataId,
      };
    } catch (error) {
      const message = error?.message || String(error);

      logger.error("onAccountMasterWritten -- ERROR", {
        accountMasterId,
        message,
        stack: error?.stack || "NAv",
      });

      logTime("ERROR END", { message });

      return null;
    }
  },
);
