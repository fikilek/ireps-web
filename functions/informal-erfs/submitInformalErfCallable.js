import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { recomputeGeoFenceCounts } from "../geofences/membership.js";
import {
  allocateInformalErfNumber,
  asTrimmedString,
  assertCandidateInsideWard,
  assertCanonicalParentDocuments,
  assertInformalErfId,
  assertNoExistingErfIntersection,
  assertPositiveEpochMs,
  assertSameCompletedSubmission,
  assertValidDeviceLocation,
  buildAdminHierarchy,
  buildCanonicalPolygon,
  buildInformalErfDocument,
  getActorContext,
  isPlainObject,
  normalizeReason,
  normalizeSitePhotos,
  resolveGeoFenceRefs,
} from "./helpers.js";

const COUNTER_COLLECTION = "ireps_counters";
const COUNTER_DOCUMENT = "informal_erfs";

function permanentDetails(details = {}) {
  return {
    retriable: false,
    errorType: "PERMANENT",
    ...details,
  };
}

function temporaryDetails(details = {}) {
  return {
    retriable: true,
    errorType: "TEMPORARY",
    ...details,
  };
}

function throwInvalidArgument(message, details = {}) {
  throw new HttpsError(
    "invalid-argument",
    message,
    permanentDetails(details),
  );
}

function throwPermissionDenied(message, details = {}) {
  throw new HttpsError(
    "permission-denied",
    message,
    permanentDetails(details),
  );
}

function throwFailedPrecondition(message, details = {}) {
  throw new HttpsError(
    "failed-precondition",
    message,
    permanentDetails(details),
  );
}

function throwAlreadyExists(message, details = {}) {
  throw new HttpsError(
    "already-exists",
    message,
    permanentDetails(details),
  );
}

async function assertStorageObjectsExist(sitePhotos) {
  const bucket = getStorage().bucket();

  const checks = await Promise.all(
    sitePhotos.map(async (photo) => {
      const [exists] = await bucket.file(photo.storagePath).exists();
      return { storagePath: photo.storagePath, exists };
    }),
  );

  const missing = checks.find((item) => !item.exists);

  if (missing) {
    throwFailedPrecondition(
      `The required site photograph was not found at ${missing.storagePath}.`,
      { businessCode: "SITE_PHOTO_NOT_FOUND" },
    );
  }
}

function buildCollisionQuery({ db, wardPcode, bbox }) {
  return db
    .collection("ireps_erfs")
    .where("admin.ward.pcode", "==", wardPcode)
    .where("bbox.minLat", "<=", bbox.maxLat)
    .where("bbox.maxLat", ">=", bbox.minLat)
    .where("bbox.minLng", "<=", bbox.maxLng)
    .where("bbox.maxLng", ">=", bbox.minLng);
}

function buildLegacyInformalQuery({ db, wardPcode }) {
  return db
    .collection("ireps_erfs")
    .where("admin.ward.pcode", "==", wardPcode)
    .where("erf.type", "==", "INFORMAL");
}

function buildGeoFenceQuery({ db, lmPcode, wardPcode }) {
  return db
    .collection("geo_fences")
    .where("parents.lmPcode", "==", lmPcode)
    .where("parents.wardPcode", "==", wardPcode)
    .where("status", "==", "ACTIVE");
}

function mergeDocumentSnapshots(...snapshots) {
  const byId = new Map();

  for (const snapshot of snapshots) {
    for (const documentSnapshot of snapshot?.docs || []) {
      byId.set(documentSnapshot.id, documentSnapshot);
    }
  }

  return Array.from(byId.values());
}

async function refreshMatchedGeoFenceCounts({
  db,
  geofenceRefs,
  lmPcode,
  wardPcode,
  erfId,
  parcelNo,
}) {
  const refs = Array.isArray(geofenceRefs) ? geofenceRefs : [];

  if (refs.length === 0) {
    return { matched: 0, updated: 0 };
  }

  logger.info("submitInformalErfCallable -- GEOFENCE COUNTS START", {
    erfId,
    parcelNo,
    matchedGeoFenceCount: refs.length,
  });

  let updated = 0;

  for (const [index, geoFenceRef] of refs.entries()) {
    logger.info("submitInformalErfCallable -- GEOFENCE COUNT PROGRESS", {
      erfId,
      parcelNo,
      current: index + 1,
      total: refs.length,
      geoFenceId: geoFenceRef.id,
    });

    const counts = await recomputeGeoFenceCounts({
      db,
      geoFenceId: geoFenceRef.id,
      lmPcode,
      wardPcode,
    });

    await db.collection("geo_fences").doc(geoFenceRef.id).update({
      counts,
      "metadata.updatedAt": new Date().toISOString(),
      "metadata.updatedByUid": "SYSTEM",
      "metadata.updatedByUser": "submitInformalErfCallable",
    });

    updated += 1;
  }

  logger.info("submitInformalErfCallable -- GEOFENCE COUNTS COMPLETE", {
    erfId,
    parcelNo,
    matched: refs.length,
    updated,
  });

  return { matched: refs.length, updated };
}

async function refreshMatchedGeoFenceCountsOrThrow(args) {
  try {
    return await refreshMatchedGeoFenceCounts(args);
  } catch (error) {
    logger.error(
      "submitInformalErfCallable -- GEOFENCE COUNT REFRESH FAILED",
      {
        erfId: args.erfId,
        parcelNo: args.parcelNo,
        errorMessage: error?.message || "Unknown geofence count error.",
      },
    );

    throw new HttpsError(
      "unavailable",
      "The Informal ERF exists, but geofence counts could not be refreshed. Retry safely with the same erfId.",
      temporaryDetails({
        erfId: args.erfId,
        parcelNo: args.parcelNo,
        erfCreated: true,
      }),
    );
  }
}

function buildSuccessResult({ erfId, parcelNo, duplicate }) {
  return {
    success: true,
    code: duplicate
      ? "INFORMAL_ERF_ALREADY_CREATED"
      : "INFORMAL_ERF_CREATED",
    erfId,
    parcelNo,
    duplicate,
    message: duplicate
      ? "This Informal ERF was already created."
      : "Informal ERF created successfully.",
  };
}

export const submitInformalErfCallable = onCall(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async (request) => {
    const startedAtMs = Date.now();
    const callerUid = request.auth?.uid || null;

    if (!callerUid) {
      throw new HttpsError(
        "unauthenticated",
        "Authentication is required.",
        permanentDetails(),
      );
    }

    if (!isPlainObject(request.data)) {
      throwInvalidArgument("The callable payload must be an object.");
    }

    const data = request.data;

    if (Number(data?.schemaVersion) !== 2) {
      throwInvalidArgument("schemaVersion must be 2.");
    }

    if (data?.formType !== "INFORMAL_ERF_CREATE") {
      throwInvalidArgument("formType must be INFORMAL_ERF_CREATE.");
    }

    const lmPcode = asTrimmedString(data?.lmPcode).toUpperCase();
    const wardPcode = asTrimmedString(data?.wardPcode).toUpperCase();

    if (!lmPcode || !wardPcode) {
      throwInvalidArgument("lmPcode and wardPcode are required.");
    }

    if (!wardPcode.startsWith(lmPcode)) {
      throwInvalidArgument(
        "wardPcode must belong to the submitted lmPcode.",
      );
    }

    let erfId;
    let canonicalPolygon;
    let deviceLocation;
    let reason;
    let sitePhotos;

    try {
      erfId = assertInformalErfId(data?.erfId, wardPcode);
      canonicalPolygon = buildCanonicalPolygon(data?.boundaryPoints);
      deviceLocation = assertValidDeviceLocation(data?.deviceLocation);
      reason = normalizeReason(data?.reasonCode, data?.reasonOther);
      sitePhotos = normalizeSitePhotos(data?.media, erfId);
      assertPositiveEpochMs(
        data?.clientSubmittedAtMs,
        "clientSubmittedAtMs",
      );
    } catch (error) {
      logger.error("submitInformalErfCallable -- VALIDATION FAILED", {
        callerUid,
        erfId: asTrimmedString(data?.erfId) || null,
        lmPcode,
        wardPcode,
        errorCode: error?.code || "invalid-argument",
        errorMessage: error?.message || "Unknown validation error.",
        errorStack: error?.stack || null,
        elapsedMs: Date.now() - startedAtMs,
      });
      throwInvalidArgument(error.message);
    }

    logger.info("submitInformalErfCallable -- START", {
      erfId,
      callerUid,
      lmPcode,
      wardPcode,
      boundaryVertexCount: canonicalPolygon.boundaryPoints.length,
      sitePhotoCount: sitePhotos.length,
      sitePhotoUrlCount: sitePhotos.filter((photo) =>
        Boolean(photo?.url),
      ).length,
    });

    try {
      const db = getFirestore();
      const userRef = db.collection("users").doc(callerUid);
      const lmRef = db.collection("lms").doc(lmPcode);
      const wardRef = db.collection("wards").doc(wardPcode);
      const erfRef = db.collection("ireps_erfs").doc(erfId);
      const counterRef = db
        .collection(COUNTER_COLLECTION)
        .doc(COUNTER_DOCUMENT);

      const userSnap = await userRef.get();

      if (!userSnap.exists) {
        throwPermissionDenied("The authenticated user profile was not found.");
      }

      let actor;

      try {
        actor = getActorContext(
          userSnap.data() || {},
          request.auth?.token || {},
        );
      } catch (error) {
        logger.error("submitInformalErfCallable -- ACTOR VALIDATION FAILED", {
          erfId,
          callerUid,
          lmPcode,
          wardPcode,
          errorMessage: error?.message || "Unknown actor validation error.",
          errorStack: error?.stack || null,
        });
        throwPermissionDenied(error.message);
      }

      if (actor.activeWorkbaseId !== lmPcode) {
        throwPermissionDenied(`The active workbase must be ${lmPcode}.`);
      }

      // A completed retry must not depend on the original media object still
      // being present or allocate another number. The transaction repeats this
      // check to cover a concurrent first creation.
      const fastExistingSnap = await erfRef.get();

      if (fastExistingSnap.exists) {
        let existingResult;

        try {
          existingResult = assertSameCompletedSubmission({
            existing: fastExistingSnap.data() || {},
            erfId,
            lmPcode,
            wardPcode,
            actorUid: callerUid,
          });
        } catch (error) {
          logger.error("submitInformalErfCallable -- IDEMPOTENCY CHECK FAILED", {
            erfId,
            callerUid,
            lmPcode,
            wardPcode,
            errorMessage: error?.message || "Unknown idempotency error.",
            errorStack: error?.stack || null,
          });
          throwAlreadyExists(error.message, { erfId });
        }

        await refreshMatchedGeoFenceCountsOrThrow({
          db,
          geofenceRefs: existingResult.geofenceRefs,
          lmPcode,
          wardPcode,
          erfId,
          parcelNo: existingResult.parcelNo,
        });

        const duplicateResult = buildSuccessResult({
          erfId,
          parcelNo: existingResult.parcelNo,
          duplicate: true,
        });

        logger.info("submitInformalErfCallable -- COMPLETE", {
          erfId,
          callerUid,
          lmPcode,
          wardPcode,
          parcelNo: duplicateResult.parcelNo,
          duplicate: true,
          elapsedMs: Date.now() - startedAtMs,
        });

        return duplicateResult;
      }

      await assertStorageObjectsExist(sitePhotos);

      const collisionQuery = buildCollisionQuery({
        db,
        wardPcode,
        bbox: canonicalPolygon.bbox,
      });
      const legacyInformalQuery = buildLegacyInformalQuery({
        db,
        wardPcode,
      });
      const geoFenceQuery = buildGeoFenceQuery({
        db,
        lmPcode,
        wardPcode,
      });

      const transactionResult = await db.runTransaction(
        async (transaction) => {
          const existingSnap = await transaction.get(erfRef);

          if (existingSnap.exists) {
            let existingResult;

            try {
              existingResult = assertSameCompletedSubmission({
                existing: existingSnap.data() || {},
                erfId,
                lmPcode,
                wardPcode,
                actorUid: callerUid,
              });
            } catch (error) {
              logger.error(
                "submitInformalErfCallable -- TRANSACTION IDEMPOTENCY CHECK FAILED",
                {
                  erfId,
                  callerUid,
                  lmPcode,
                  wardPcode,
                  errorMessage:
                    error?.message || "Unknown transaction idempotency error.",
                  errorStack: error?.stack || null,
                },
              );
              throwAlreadyExists(error.message, { erfId });
            }

            return {
              duplicate: true,
              parcelNo: existingResult.parcelNo,
              geofenceRefs: existingResult.geofenceRefs,
            };
          }

          const transactionUserSnap = await transaction.get(userRef);
          const lmSnap = await transaction.get(lmRef);
          const wardSnap = await transaction.get(wardRef);

          let transactionActor;
          let lmData;
          let wardData;
          let admin;

          try {
            if (!transactionUserSnap.exists) {
              throw new Error("The authenticated user profile was not found.");
            }

            transactionActor = getActorContext(
              transactionUserSnap.data() || {},
              request.auth?.token || {},
            );

            if (transactionActor.activeWorkbaseId !== lmPcode) {
              throw new Error(`The active workbase must be ${lmPcode}.`);
            }
          } catch (error) {
            logger.error(
              "submitInformalErfCallable -- TRANSACTION ACTOR VALIDATION FAILED",
              {
                erfId,
                callerUid,
                lmPcode,
                wardPcode,
                errorMessage:
                  error?.message || "Unknown transaction actor error.",
                errorStack: error?.stack || null,
              },
            );
            throwPermissionDenied(error.message);
          }

          try {
            ({ lmData, wardData } = assertCanonicalParentDocuments({
              lmPcode,
              wardPcode,
              lmSnap,
              wardSnap,
            }));
            admin = buildAdminHierarchy({
              lmPcode,
              wardPcode,
              lmData,
              wardData,
            });
            assertCandidateInsideWard(
              canonicalPolygon.feature,
              wardData?.geometry,
            );
          } catch (error) {
            logger.error("submitInformalErfCallable -- WARD VALIDATION FAILED", {
              erfId,
              callerUid,
              lmPcode,
              wardPcode,
              errorMessage: error?.message || "Unknown ward validation error.",
              errorStack: error?.stack || null,
            });
            throwFailedPrecondition(error.message, {
              businessCode: "WARD_VALIDATION_FAILED",
              wardPcode,
            });
          }

          const collisionSnapshot = await transaction.get(collisionQuery);
          const legacyInformalSnapshot = await transaction.get(
            legacyInformalQuery,
          );
          const collisionDocuments = mergeDocumentSnapshots(
            collisionSnapshot,
            legacyInformalSnapshot,
          );
          let collisionResult;

          try {
            collisionResult = assertNoExistingErfIntersection({
              candidateFeature: canonicalPolygon.feature,
              candidateBbox: canonicalPolygon.bbox,
              erfDocs: collisionDocuments,
              erfId,
            });
          } catch (error) {
            logger.error(
              "submitInformalErfCallable -- COLLISION VALIDATION FAILED",
              {
                erfId,
                callerUid,
                lmPcode,
                wardPcode,
                errorMessage:
                  error?.message || "Unknown collision validation error.",
                errorStack: error?.stack || null,
              },
            );
            throwFailedPrecondition(
              "Existing ERF geometry could not be validated safely.",
              {
                businessCode: "EXISTING_ERF_VALIDATION_UNAVAILABLE",
                validationMessage: error.message,
                wardPcode,
              },
            );
          }

          if (collisionResult.collision) {
            throwFailedPrecondition(
              "The proposed Informal ERF touches or intersects an existing ERF.",
              {
                businessCode: "INFORMAL_ERF_INTERSECTS_EXISTING_ERF",
                wardPcode,
                existingErfId: collisionResult.existingErfId,
                existingErfNo: collisionResult.existingErfNo,
                existingErfType: collisionResult.existingErfType,
              },
            );
          }

          const geoFenceSnapshot = await transaction.get(geoFenceQuery);
          const geofenceRefs = resolveGeoFenceRefs({
            geoFenceDocs: geoFenceSnapshot.docs,
            centroid: canonicalPolygon.centroid,
          });

          const counterSnap = await transaction.get(counterRef);
          let allocation;

          try {
            allocation = allocateInformalErfNumber(
              counterSnap.exists ? counterSnap.data() || {} : {},
            );
          } catch (error) {
            logger.error("submitInformalErfCallable -- COUNTER FAILED", {
              erfId,
              callerUid,
              lmPcode,
              wardPcode,
              errorMessage: error?.message || "Unknown counter error.",
              errorStack: error?.stack || null,
            });
            throwFailedPrecondition(error.message, {
              businessCode: "INFORMAL_ERF_COUNTER_INVALID",
            });
          }

          const erfDocument = buildInformalErfDocument({
            erfId,
            admin,
            canonicalPolygon,
            parcelNo: allocation.parcelNo,
            geofenceRefs,
            reason,
            deviceLocation,
            sitePhotos,
            actorUid: callerUid,
            actorName: transactionActor.displayName,
          });

          transaction.set(
            counterRef,
            { lastNumber: allocation.lastNumber },
            { merge: true },
          );
          transaction.create(erfRef, erfDocument);

          return {
            duplicate: false,
            parcelNo: allocation.parcelNo,
            geofenceRefs,
            collisionCandidates: collisionDocuments.length,
            matchedGeoFenceCount: geofenceRefs.length,
          };
        },
      );

      await refreshMatchedGeoFenceCountsOrThrow({
        db,
        geofenceRefs: transactionResult.geofenceRefs,
        lmPcode,
        wardPcode,
        erfId,
        parcelNo: transactionResult.parcelNo,
      });

      const result = buildSuccessResult({
        erfId,
        parcelNo: transactionResult.parcelNo,
        duplicate: transactionResult.duplicate,
      });

      logger.info("submitInformalErfCallable -- COMPLETE", {
        erfId,
        callerUid,
        lmPcode,
        wardPcode,
        parcelNo: result.parcelNo,
        duplicate: result.duplicate,
        geofenceCount: transactionResult.geofenceRefs.length,
        collisionCandidates:
          transactionResult.collisionCandidates ?? null,
        elapsedMs: Date.now() - startedAtMs,
      });

      return result;
    } catch (error) {
      logger.error("submitInformalErfCallable -- FAILED", {
        erfId,
        callerUid,
        lmPcode,
        wardPcode,
        errorCode: error?.code || "internal",
        errorMessage: error?.message || "Unknown callable error.",
        errorStack: error?.stack || null,
        elapsedMs: Date.now() - startedAtMs,
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        "The Informal ERF could not be created.",
        temporaryDetails({ erfId }),
      );
    }
  },
);
