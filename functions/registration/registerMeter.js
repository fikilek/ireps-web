// RG-R001: a registration produces its meter, or it never happened.
//
// One Firestore transaction writes the whole registration: the transaction, the meter, the meter
// master's field link and the premise's own list of meters. All of them, or none of them. Before this
// rule the transaction was written on its own and the meter was made afterwards by a trigger, so a
// transaction could stand with no meter behind it — 1 on DEV, 4 on TEST, 3 on LIVE by 28 September,
// and the phone had said MISSION SUCCESS for every one of them.
//
// This module is the ONE creator (RG-R001 section 9). The door calls it inside its own transaction;
// the old trigger calls it only for transactions written before the rule, and for repairs. Its
// collaborators are injected rather than imported, because they live in index.js today and moving
// them is its own piece of work.
//
// Nothing in here may have an effect outside Firestore: a transaction can be retried, so a message to
// a worker, a photograph upload or a counter bumped in here would happen twice (Firestore's own rule).

/** A failure the door can turn into a refusal the worker reads. */
export function registrationError(irepsCode, message) {
  return Object.assign(new Error(message), { irepsCode });
}

/**
 * Write a registration, whole, inside the caller's transaction.
 *
 * Reads first, writes after — Firestore requires it, and the batch completion reads too.
 * Returns what was written so the caller can put `derived` on the transaction in the same commit.
 */
export async function registerMeterInTransaction({
  tx,
  db,
  Timestamp,
  trnData,
  trnId,
  rawMeterNo,
  normalizedMeterNo,
  meterType,
  lmPcode,
  premiseId,
  erfId,
  metadata,
  deps,
}) {
  const {
    classifyOperationalAstChange,
    METER_MASTER_CLASSIFICATIONS,
    MeterMasterConflictError,
    buildCanonicalFieldOnlyMeterMaster,
    buildOperationalAstUpdate,
    deriveMasterVisibility,
    syncSalesAllMetersFromMaster,
    completeTargetedBatchMeterDiscoveryInTransaction,
    normalizeCreationReadings,
    projectMeterDiscoveryAstMedia,
    buildPremiseUpdateMetadata,
    getServiceBucketFromMeterType,
    normalizePremiseServiceSnapshotItem,
    logger,
  } = deps;

  const astId = trnId;
  const astRef = db.collection("asts").doc(astId);
  const masterRef = db.collection("meter_master").doc(normalizedMeterNo);
  const salesRef = db.collection("sales-all-meters").doc(normalizedMeterNo);
  const premiseRef = db.collection("premises").doc(premiseId);
  const erfRef =
    erfId && erfId !== "NAv" ? db.collection("ireps_erfs").doc(erfId) : null;

  // RG-R001 section 2: the premise's own list of meters is part of the registration, because that
  // list is what the premise card reads. A meter that commits without it exists and does not show.
  const serviceBucket = getServiceBucketFromMeterType({ meterType, trnId });
  if (!serviceBucket) {
    throw registrationError(
      "INVALID_SERVICE_BUCKET",
      "Could not tell whether this is a water or an electricity meter",
    );
  }

  // ---- reads ----
  const [astSnap, masterSnap, salesSnap, premiseSnap] = await Promise.all([
    tx.get(astRef),
    tx.get(masterRef),
    tx.get(salesRef),
    tx.get(premiseRef),
  ]);

  if (!premiseSnap.exists) {
    throw registrationError(
      "PREMISE_NOT_FOUND",
      "Parent premise does not exist in premises collection",
    );
  }

  const targetedBatchCompletion =
    await completeTargetedBatchMeterDiscoveryInTransaction({
      transaction: tx,
      db,
      trnData,
      astId,
      normalizedMeterNo,
      now: Timestamp.now(),
    });

  const masterBefore = masterSnap.exists ? masterSnap.data() : null;
  const masterDecision = classifyOperationalAstChange({
    masterId: normalizedMeterNo,
    existing: masterBefore,
    incomingAstId: astId,
    incomingLmPcode: lmPcode,
    incomingMeterType: meterType,
    sourceWriter: "registerMeterInTransaction",
  });

  if (masterDecision.classification === METER_MASTER_CLASSIFICATIONS.CONFLICT) {
    logger.error("registerMeter ---- Meter Master conflict", {
      ...masterDecision.conflict,
      existingValues: undefined,
    });
    throw new MeterMasterConflictError(masterDecision.conflict);
  }

  const masterOperationTimestamp = Timestamp.now();
  const canonicalFieldOnlyMaster =
    masterDecision.classification ===
    METER_MASTER_CLASSIFICATIONS.CREATE_FIELD_ONLY
      ? buildCanonicalFieldOnlyMeterMaster({
          lmPcode,
          meterNoRaw: rawMeterNo,
          meterType,
          astId,
          actorUid: metadata.updatedByUid,
          actorUser: metadata.updatedByUser,
          operationTimestamp: masterOperationTimestamp,
        })
      : null;

  const nextMasterData = masterSnap.exists
    ? {
        ...masterBefore,
        refs: {
          ...(masterBefore?.refs || {}),
          asts: { ...(masterBefore?.refs?.asts || {}), id: astId },
        },
        metadata: {
          ...(masterBefore?.metadata || {}),
          updatedAt: masterOperationTimestamp,
          updatedByUid: metadata.updatedByUid,
          updatedByUser: metadata.updatedByUser,
        },
      }
    : canonicalFieldOnlyMaster;

  // MV-R001: VISIBLE only when the master carries both a field link and a Sales link. Always derived,
  // never assumed, on both registration functions (RG-R001 1.1.0 section 2).
  const visibility = deriveMasterVisibility(nextMasterData);

  const creationData = normalizeCreationReadings({
    data: trnData,
    trnId,
    now: metadata.createdOnDevice,
  });

  const astPayload = {
    ...creationData.ast,
    astData: { ...(creationData.ast?.astData || {}), astId },
  };

  // ---- writes ----

  // 1. The meter. Kept if it is somehow already there, so a repair can never double-write it.
  if (!astSnap.exists) {
    tx.create(astRef, {
      accessData: trnData.accessData,
      ast: astPayload,
      ...(creationData.mreadings.length
        ? { mreadings: creationData.mreadings }
        : {}),
      ...(creationData.treadings.length
        ? { treadings: creationData.treadings }
        : {}),
      media: projectMeterDiscoveryAstMedia(trnData.media || []),
      meterType,
      trnId,
      master: { id: normalizedMeterNo, visibility },
      metadata,
      status: trnData?.status || null,
      serviceProvider: trnData?.serviceProvider || { id: "NAv", name: "NAv" },
    });
  }

  // 2. The meter master's field link.
  if (
    masterDecision.classification ===
    METER_MASTER_CLASSIFICATIONS.CREATE_FIELD_ONLY
  ) {
    tx.create(masterRef, canonicalFieldOnlyMaster);
  } else if (
    masterDecision.classification ===
    METER_MASTER_CLASSIFICATIONS.UPDATE_AST_LINK
  ) {
    tx.update(
      masterRef,
      buildOperationalAstUpdate({
        astId,
        actorUid: metadata.updatedByUid,
        actorUser: metadata.updatedByUser,
        operationTimestamp: masterOperationTimestamp,
      }),
    );
  }

  // 3. Sales, from the master's own truth. Matched or unmatched, both are correct (MV-R001).
  const salesSync = await syncSalesAllMetersFromMaster({
    tx,
    normalizedMeterNo,
    masterData: nextMasterData,
    salesSnap,
    sourceWriter: "registerMeterInTransaction",
  });

  // 4. The premise: accessed, and the meter on its own list.
  const premiseMetadataPatch = buildPremiseUpdateMetadata(
    metadata.updatedByUid,
    metadata.updatedByUser,
  );
  const premiseServices = premiseSnap.data()?.services || {};
  const currentServiceItems = Array.isArray(premiseServices?.[serviceBucket])
    ? premiseServices[serviceBucket]
    : [];
  const nextServiceItem = {
    trnId,
    status: String(trnData?.status?.state || "RECORDED").toUpperCase(),
    updatedAt: premiseMetadataPatch.updatedAt,
  };
  const nextServiceItems = currentServiceItems
    .map(normalizePremiseServiceSnapshotItem)
    .filter(Boolean);
  const existingServiceIndex = nextServiceItems.findIndex(
    (item) => item?.trnId === trnId,
  );
  if (existingServiceIndex >= 0) {
    nextServiceItems[existingServiceIndex] = {
      ...nextServiceItems[existingServiceIndex],
      ...nextServiceItem,
    };
  } else {
    nextServiceItems.push(nextServiceItem);
  }

  tx.update(premiseRef, {
    [`services.${serviceBucket}`]: nextServiceItems,
    "occupancy.status": "Accessed",
    "metadata.updatedAt": premiseMetadataPatch.updatedAt,
    "metadata.updatedByUid": premiseMetadataPatch.updatedByUid,
    "metadata.updatedByUser": premiseMetadataPatch.updatedByUser,
  });

  // 5. The ERF is told something changed under it.
  if (erfRef) {
    tx.update(erfRef, {
      "metadata.updatedAt": metadata.updatedOnServer,
      "metadata.updatedByUid": metadata.updatedByUid,
      "metadata.updatedByUser": metadata.updatedByUser,
    });
  }

  // What the caller writes onto the transaction, in the same commit.
  const derived = {
    astId,
    master: { id: normalizedMeterNo, visibility },
    ...(targetedBatchCompletion?.applied
      ? {
          targetedBatch: {
            tbId: targetedBatchCompletion.tbId,
            rowId: targetedBatchCompletion.rowId,
            salesDocId: targetedBatchCompletion.salesDocId,
            premiseId: targetedBatchCompletion.premiseId,
            meterId: targetedBatchCompletion.meterId,
            trnId: targetedBatchCompletion.trnId,
            meterMatch: targetedBatchCompletion.meterMatch,
            batchCompleted: targetedBatchCompletion.batchCompleted,
          },
        }
      : {}),
    processedAt: metadata.updatedOnServer,
  };

  return { astId, visibility, derived, salesSync, serviceBucket };
}
