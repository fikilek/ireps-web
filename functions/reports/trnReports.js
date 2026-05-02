import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import {
  isNoAccessTrn,
  getActivityDate,
  getNormalisationBucket,
  getAnomalyBucket,
  getUserActivityContribution,
} from "./reportHelpers.js";

export const onTrnWritten = onDocumentWritten("trns/{trnId}", async (event) => {
  const db = getFirestore();

  const before = event.data?.before?.data() || null;
  const after = event.data?.after?.data() || null;
  const trnId = event.params.trnId;

  try {
    await syncNoAccessReport(db, before, after, trnId);
    await syncNormalisationReport(db, before, after, trnId);
    await syncAnomalyReport(db, before, after, trnId);
    await syncUserActivityReport(db, before, after, trnId);
  } catch (error) {
    logger.error("TRN reports sync failed", {
      trnId,
      error: error?.message || error,
    });
  }
});

const syncNoAccessReport = async (db, before, after, trnId) => {
  const ref = db.collection("report_trn_no_access").doc(trnId);

  const beforeQualifies = before && isNoAccessTrn(before);
  const afterQualifies = after && isNoAccessTrn(after);

  if (!after && beforeQualifies) {
    await ref.delete().catch(() => null);
    return;
  }

  if (beforeQualifies && !afterQualifies) {
    await ref.delete().catch(() => null);
    return;
  }

  if (afterQualifies) {
    const existing = await ref.get();
    const existingCreatedAt = existing.exists
      ? existing.data()?.metadata?.createdAt || null
      : null;

    const row = buildNoAccessRow(after, trnId, existingCreatedAt);
    await ref.set(row, { merge: true });
  }
};

const buildNoAccessRow = (trn, trnId, existingCreatedAt = null) => {
  const now = new Date().toISOString();

  return {
    id: trnId,

    reportType: "NO_ACCESS",

    activityDate: getActivityDate(trn),

    parents: {
      lmPcode: trn?.accessData?.parents?.lmPcode || "NAv",
      wardPcode: trn?.accessData?.parents?.wardPcode || "NAv",
    },

    user: {
      uid: trn?.metadata?.updatedByUid || "NAv",
      name: trn?.metadata?.updatedByUser || "NAv",
    },

    premise: {
      id: trn?.accessData?.premise?.id || "NAv",
      address: trn?.accessData?.premise?.address || "NAv",
      propertyType: trn?.accessData?.premise?.propertyType || "NAv",
    },

    erf: {
      id: trn?.accessData?.erfId || "NAv",
      no: trn?.accessData?.erfNo || "NAv",
    },

    access: {
      hasAccess: "no",
      reason: trn?.accessData?.access?.reason || "NAv",
    },

    trn: {
      type: trn?.accessData?.trnType || "NAv",
      createdAt: trn?.metadata?.createdAt || "NAv",
      updatedAt: trn?.metadata?.updatedAt || "NAv",
    },

    metadata: {
      createdAt: existingCreatedAt || now,
      createdByUid: "SYSTEM",
      createdByUser: "TRN Report",
      updatedAt: now,
      updatedByUid: "SYSTEM",
      updatedByUser: "TRN Report",
    },
  };
};

const syncNormalisationReport = async (db, before, after) => {
  const lmBefore = before?.accessData?.parents?.lmPcode || null;
  const lmAfter = after?.accessData?.parents?.lmPcode || null;

  const beforeBucket = before ? getNormalisationBucket(before) : null;
  const afterBucket = after ? getNormalisationBucket(after) : null;

  if (beforeBucket && lmBefore) {
    await rebuildNormalisationBucket(
      db,
      lmBefore,
      beforeBucket.activityDate,
      beforeBucket.combinationKey,
      beforeBucket.actions,
    );
  }

  if (afterBucket && lmAfter) {
    const same =
      beforeBucket &&
      beforeBucket.activityDate === afterBucket.activityDate &&
      beforeBucket.combinationKey === afterBucket.combinationKey &&
      lmBefore === lmAfter;

    if (!same) {
      await rebuildNormalisationBucket(
        db,
        lmAfter,
        afterBucket.activityDate,
        afterBucket.combinationKey,
        afterBucket.actions,
      );
    }
  }
};

const rebuildNormalisationBucket = async (
  db,
  lmPcode,
  activityDate,
  combinationKey,
  actions,
) => {
  if (!lmPcode || !activityDate || !combinationKey) return;

  const docId = `${lmPcode}__${activityDate}__${combinationKey}`;
  const ref = db.collection("report_trn_normalisation").doc(docId);

  const snapshot = await db
    .collection("trns")
    .where("accessData.parents.lmPcode", "==", lmPcode)
    .get();

  let count = 0;

  snapshot.forEach((doc) => {
    const trn = doc.data();
    const bucket = getNormalisationBucket(trn);

    if (!bucket) return;

    const same =
      bucket.activityDate === activityDate &&
      bucket.combinationKey === combinationKey;

    if (same) count += 1;
  });

  if (count === 0) {
    await ref.delete().catch(() => null);
    return;
  }

  const existing = await ref.get();
  const existingCreatedAt = existing.exists
    ? existing.data()?.metadata?.createdAt || null
    : null;

  const now = new Date().toISOString();

  await ref.set(
    {
      id: docId,

      reportType: "NORMALISATION",

      activityDate,

      parents: {
        lmPcode,
      },

      normalisation: {
        combinationKey,
        actions,
        actionCount: actions.length,
      },

      counts: {
        trns: count,
      },

      metadata: {
        createdAt: existingCreatedAt || now,
        createdByUid: "SYSTEM",
        createdByUser: "TRN Report",
        updatedAt: now,
        updatedByUid: "SYSTEM",
        updatedByUser: "TRN Report",
      },
    },
    { merge: true },
  );
};

const syncAnomalyReport = async (db, before, after) => {
  const lmBefore = before?.accessData?.parents?.lmPcode || null;
  const lmAfter = after?.accessData?.parents?.lmPcode || null;

  const beforeBucket = before ? getAnomalyBucket(before) : null;
  const afterBucket = after ? getAnomalyBucket(after) : null;

  // rebuild old bucket
  if (beforeBucket && lmBefore) {
    await rebuildAnomalyBucket(
      db,
      lmBefore,
      beforeBucket.activityDate,
      beforeBucket.anomalyKey,
      beforeBucket.detailKey,
      beforeBucket.name,
      beforeBucket.detail,
    );
  }

  // rebuild new bucket
  if (afterBucket && lmAfter) {
    const same =
      beforeBucket &&
      beforeBucket.activityDate === afterBucket.activityDate &&
      beforeBucket.anomalyKey === afterBucket.anomalyKey &&
      beforeBucket.detailKey === afterBucket.detailKey &&
      lmBefore === lmAfter;

    if (!same) {
      await rebuildAnomalyBucket(
        db,
        lmAfter,
        afterBucket.activityDate,
        afterBucket.anomalyKey,
        afterBucket.detailKey,
        afterBucket.name,
        afterBucket.detail,
      );
    }
  }
};

const rebuildAnomalyBucket = async (
  db,
  lmPcode,
  activityDate,
  anomalyKey,
  detailKey,
  name,
  detail,
) => {
  if (!lmPcode || !activityDate || !anomalyKey) return;

  const docId = `${lmPcode}__${activityDate}__${anomalyKey}__${detailKey}`;
  const ref = db.collection("report_trn_anomaly").doc(docId);

  const snapshot = await db
    .collection("trns")
    .where("accessData.parents.lmPcode", "==", lmPcode)
    .get();

  let count = 0;

  snapshot.forEach((doc) => {
    const trn = doc.data();
    const bucket = getAnomalyBucket(trn);

    if (!bucket) return;

    const same =
      bucket.activityDate === activityDate &&
      bucket.anomalyKey === anomalyKey &&
      bucket.detailKey === detailKey;

    if (same) count += 1;
  });

  if (count === 0) {
    await ref.delete().catch(() => null);
    return;
  }

  const existing = await ref.get();
  const existingCreatedAt = existing.exists
    ? existing.data()?.metadata?.createdAt || null
    : null;

  const now = new Date().toISOString();

  await ref.set(
    {
      id: docId,

      reportType: "ANOMALY",

      activityDate,

      parents: {
        lmPcode,
      },

      anomaly: {
        name,
        detail,
        anomalyKey,
        detailKey,
      },

      counts: {
        trns: count,
      },

      metadata: {
        createdAt: existingCreatedAt || now,
        createdByUid: "SYSTEM",
        createdByUser: "TRN Report",
        updatedAt: now,
        updatedByUid: "SYSTEM",
        updatedByUser: "TRN Report",
      },
    },
    { merge: true },
  );
};

const syncUserActivityReport = async (db, before, after) => {
  const beforeUser = before?.metadata?.updatedByUid || null;
  const afterUser = after?.metadata?.updatedByUid || null;

  const lmBefore = before?.accessData?.parents?.lmPcode || null;
  const lmAfter = after?.accessData?.parents?.lmPcode || null;

  if (beforeUser && lmBefore) {
    await rebuildUserActivityBucket(db, lmBefore, beforeUser);
  }

  if (afterUser && lmAfter) {
    const sameBucket = beforeUser === afterUser && lmBefore === lmAfter;
    if (!sameBucket) {
      await rebuildUserActivityBucket(db, lmAfter, afterUser);
      return;
    }
  }

  if (afterUser && lmAfter) {
    await rebuildUserActivityBucket(db, lmAfter, afterUser);
  }
};

const rebuildUserActivityBucket = async (db, lmPcode, userUid) => {
  if (!lmPcode || !userUid) return;

  const docId = `${lmPcode}_${userUid}`;
  const ref = db.collection("report_trn_user_activity").doc(docId);

  const snapshot = await db
    .collection("trns")
    .where("accessData.parents.lmPcode", "==", lmPcode)
    .where("metadata.updatedByUid", "==", userUid)
    .get();

  const counts = {
    totalTrns: 0,
    noAccessTrns: 0,

    meterDiscoveryTrns: 0,
    meterInstallationTrns: 0,
    meterDisconnectionTrns: 0,
    meterReconnectionTrns: 0,
    meterInspectionTrns: 0,
    meterRemovalTrns: 0,

    otherTrns: 0,
  };

  snapshot.forEach((doc) => {
    const trn = doc.data();
    const contribution = getUserActivityContribution(trn);

    Object.keys(counts).forEach((key) => {
      counts[key] += contribution[key] || 0;
    });
  });

  if (counts.totalTrns === 0) {
    await ref.delete().catch(() => null);
    return;
  }

  const userSnap = await db.collection("users").doc(userUid).get();
  const userDoc = userSnap.exists ? userSnap.data() : null;

  const userName = userDoc?.profile?.displayName || "NAv";

  const role = userDoc?.employment?.role || "NAv";

  const serviceProviderId = userDoc?.employment?.serviceProvider?.id || "NAv";

  const serviceProviderName =
    userDoc?.employment?.serviceProvider?.name || "NAv";

  const teamId = userDoc?.employment?.team?.id || "NAv";
  const teamName = userDoc?.employment?.team?.name || "NAv";

  const existing = await ref.get();
  const existingCreatedAt = existing.exists
    ? existing.data()?.metadata?.createdAt || null
    : null;

  const now = new Date().toISOString();

  await ref.set(
    {
      id: docId,

      reportType: "USER_ACTIVITY",

      user: {
        uid: userUid,
        name: userName,
        role,
        teamId,
        teamName,
        serviceProviderId,
        serviceProviderName,
      },

      parents: {
        lmPcode,
      },

      counts,

      metadata: {
        createdAt: existingCreatedAt || now,
        createdByUid: "SYSTEM",
        createdByUser: "TRN Report",
        updatedAt: now,
        updatedByUid: "SYSTEM",
        updatedByUser: "TRN Report",
      },
    },
    { merge: true },
  );
};
