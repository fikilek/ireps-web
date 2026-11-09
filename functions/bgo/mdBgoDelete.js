const upper = (value) => String(value ?? "").trim().toUpperCase();

const MD_BGO_WORK_LINK_FIELDS = [
  "bgo.batchId",
  "bgo.bgoBatchId",
  "refs.bgoBatchId",
  "refs.batchId",
  "origin.bgoBatchId",
  "bucket.batchId",
  "bmd.batchId",
  "bmd.bgoBatchId",
];

function isMdBgoBatch(batch = {}) {
  return (
    upper(batch?.bgo?.batchMode || batch?.batchMode) === "BMD" ||
    (upper(batch?.operationType) === "METER_DISCOVERY" &&
      upper(batch?.origin?.sourceModule) === "BULK_METER_DISCOVERY")
  );
}

function getMdBgoDeletionBlock(batch = {}) {
  const state = upper(batch?.workflow?.state || batch?.workflowState);
  const allowedStates = new Set(["READY_FOR_ALLOCATION", "ALLOCATED", "ISSUED"]);
  const workflow = batch?.workflow || {};
  const executionReleased = upper(batch?.bgo?.releaseState) === "RELEASED_TO_EXECUTION";
  const executionStarted = Boolean(
    workflow?.acceptedAt ||
      workflow?.acceptedByUid ||
      workflow?.executionStartedAt ||
      workflow?.startedAt ||
      workflow?.releasedAt ||
      workflow?.completedAt ||
      workflow?.cancelledAt ||
      executionReleased,
  );

  if (!allowedStates.has(state) || executionStarted) {
    return {
      code: "BGO_BATCH_NOT_DELETABLE",
      message:
        "Only MD BGO batches that have not started field execution can be deleted",
      workflowState: state || "NAv",
    };
  }

  return null;
}

async function queryDocsByBatchLink({ transaction, db, collectionName, bgoBatchId, fields }) {
  const docsByPath = new Map();

  for (const field of fields) {
    const query = db
      .collection(collectionName)
      .where(field, "==", bgoBatchId)
      .limit(1000);
    const snapshot = await transaction.get(query);
    snapshot.docs.forEach((doc) => docsByPath.set(doc.ref.path, doc));
  }

  return Array.from(docsByPath.values());
}

async function queryWorkDocs({ transaction, db, bgoBatchId }) {
  const [trns, premises, asts] = await Promise.all([
    queryDocsByBatchLink({
      transaction,
      db,
      collectionName: "trns",
      bgoBatchId,
      fields: MD_BGO_WORK_LINK_FIELDS,
    }),
    queryDocsByBatchLink({
      transaction,
      db,
      collectionName: "premises",
      bgoBatchId,
      fields: MD_BGO_WORK_LINK_FIELDS,
    }),
    queryDocsByBatchLink({
      transaction,
      db,
      collectionName: "asts",
      bgoBatchId,
      fields: MD_BGO_WORK_LINK_FIELDS,
    }),
  ]);

  return { trns, premises, asts, total: trns.length + premises.length + asts.length };
}

function rowShowsStartedWork(row = {}) {
  const state = upper(row?.workflow?.state || row?.workflowState);
  const releaseState = upper(row?.bgo?.releaseState || row?.releaseState);
  return Boolean(
    row?.refs?.premiseId ||
      row?.premise?.id ||
      ["ACCEPTED", "IN_PROGRESS", "COMPLETED"].includes(state) ||
      releaseState === "RELEASED_TO_EXECUTION",
  );
}

/**
 * Atomically validates and removes an unstarted MD BGO batch, its rows,
 * history, linked notifications, and its geofence claim.
 */
export async function deleteMdBgoBatchAtomically({
  db,
  bgoBatchId,
  now,
  actorUid,
  actorName,
}) {
  const batchRef = db.collection("bgo_batches").doc(bgoBatchId);

  return db.runTransaction(async (transaction) => {
    const batchSnap = await transaction.get(batchRef);
    if (!batchSnap.exists) {
      return {
        success: false,
        code: "BGO_BATCH_NOT_FOUND",
        message: "The selected BGO batch was not found",
      };
    }

    const batch = batchSnap.data() || {};
    if (!isMdBgoBatch(batch)) {
      return {
        success: false,
        code: "BGO_BATCH_TYPE_CHANGED",
        message: "The selected batch is no longer an MD BGO batch",
      };
    }

    const eligibilityBlock = getMdBgoDeletionBlock(batch);
    if (eligibilityBlock) {
      return {
        success: false,
        ...eligibilityBlock,
        bgoBatchId,
      };
    }

    const geofenceId = String(
      batch?.geofenceRef?.id || batch?.geofenceId || "",
    ).trim();
    const geofenceRef = geofenceId
      ? db.collection("geo_fences").doc(geofenceId)
      : null;
    const rowsCollection = db.collection("bgo_rows");
    const historyQuery = batchRef.collection("history");
    const notificationQuery = db
      .collection("notifications")
      .where("bgo.batchId", "==", bgoBatchId);

    const [geofenceSnap, rowsByBgoBatch, rowsByBatch, historySnap, notificationSnap, linkedWorkDocs] =
      await Promise.all([
        geofenceRef ? transaction.get(geofenceRef) : Promise.resolve(null),
        transaction.get(rowsCollection.where("bgoBatchId", "==", bgoBatchId)),
        transaction.get(rowsCollection.where("batchId", "==", bgoBatchId)),
        transaction.get(historyQuery),
        transaction.get(notificationQuery),
        queryWorkDocs({ transaction, db, bgoBatchId }),
      ]);

    const rowDocsByPath = new Map();
    [...rowsByBgoBatch.docs, ...rowsByBatch.docs].forEach((doc) =>
      rowDocsByPath.set(doc.ref.path, doc),
    );
    const rowDocs = Array.from(rowDocsByPath.values());
    const declaredErfRows = Number(batch?.summary?.erfCount || 0);
    const rowWorkStarted = rowDocs.some((doc) => rowShowsStartedWork(doc.data() || {}));
    const extraRowsExist = declaredErfRows > 0 && rowDocs.length > declaredErfRows;

    if (linkedWorkDocs.total > 0 || rowWorkStarted || extraRowsExist) {
      return {
        success: false,
        code: "BMD_BGO_HAS_CREATED_WORK",
        message:
          "This MD BGO batch cannot be deleted because field work has started or premise or meter work exists under it",
        bgoBatchId,
        linkedTrns: linkedWorkDocs.trns.length,
        linkedPremises: linkedWorkDocs.premises.length,
        linkedMeters: linkedWorkDocs.asts.length,
        linkedBgoRows: rowDocs.length,
      };
    }

    const shouldUnlinkGeofence =
      geofenceSnap?.exists &&
      String(geofenceSnap.data()?.bgo?.batchId || "").trim() === bgoBatchId;
    const deleteCount =
      rowDocs.length +
      historySnap.docs.length +
      notificationSnap.docs.length +
      1 +
      (shouldUnlinkGeofence ? 1 : 0);

    if (deleteCount > 500) {
      return {
        success: false,
        code: "BMD_BGO_DELETE_LIMIT_EXCEEDED",
        message: "The MD BGO batch has too many linked records for a safe atomic deletion",
        bgoBatchId,
        linkedBgoRows: rowDocs.length,
      };
    }

    rowDocs.forEach((doc) => transaction.delete(doc.ref));
    historySnap.docs.forEach((doc) => transaction.delete(doc.ref));
    notificationSnap.docs.forEach((doc) => transaction.delete(doc.ref));

    if (shouldUnlinkGeofence) {
      transaction.update(geofenceRef, {
        "bgo.batchId": null,
        "bgo.linkState": "UNLINKED",
        "bgo.batchedAt": null,
        "bgo.batchedByUid": null,
        "bgo.batchedByUser": null,
        "metadata.updatedAt": now,
        "metadata.updatedByUid": actorUid || "NAv",
        "metadata.updatedByUser": actorName || "NAv",
      });
    }

    transaction.delete(batchRef);

    return {
      success: true,
      bgoBatchId,
      deletedBgoRows: rowDocs.length,
      deletedHistoryDocs: historySnap.docs.length,
      deletedNotifications: notificationSnap.docs.length,
      geofenceUnlinked: Boolean(shouldUnlinkGeofence),
      committedWrites: deleteCount,
    };
  });
}
