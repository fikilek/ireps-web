import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import {
  asTrimmedString,
  assertInformalErfId,
  assertPositiveEpochMs,
  assertValidDeviceLocation,
  assertValidLatLng,
  assertPolygonGeometry,
  buildAdminHierarchy,
  buildInformalErfDocument,
  geometryContainsPointInclusive,
  getActorContext,
  getBboxPointRelation,
  isPlainObject,
  normalizeReason,
  normalizeSitePhotos,
  parseGeoJsonGeometry,
} from "./helpers.js";

function throwInvalidArgument(message) {
  throw new HttpsError("invalid-argument", message, {
    retriable: false,
    errorType: "PERMANENT",
  });
}

function throwPermissionDenied(message) {
  throw new HttpsError("permission-denied", message, {
    retriable: false,
    errorType: "PERMANENT",
  });
}

function throwFailedPrecondition(message, details = {}) {
  throw new HttpsError("failed-precondition", message, {
    retriable: false,
    errorType: "PERMANENT",
    ...details,
  });
}

async function assertStorageObjectsExist(sitePhotos) {
  const bucket = getStorage().bucket();

  const checks = await Promise.all(
    sitePhotos.map(async (photo) => {
      const [exists] = await bucket.file(photo.storagePath).exists();

      return {
        storagePath: photo.storagePath,
        exists,
      };
    }),
  );

  const missing = checks.find((item) => !item.exists);

  if (missing) {
    throwFailedPrecondition(
      `The required site photograph was not found at ${missing.storagePath}.`,
    );
  }
}

function assertCanonicalParentDocuments({
  lmPcode,
  wardPcode,
  lmSnap,
  wardSnap,
}) {
  if (!lmSnap.exists) {
    throw new HttpsError(
      "not-found",
      `Local Municipality ${lmPcode} was not found.`,
      {
        retriable: false,
        errorType: "PERMANENT",
      },
    );
  }

  if (!wardSnap.exists) {
    throw new HttpsError(
      "not-found",
      `Ward ${wardPcode} was not found.`,
      {
        retriable: false,
        errorType: "PERMANENT",
      },
    );
  }

  const lmData = lmSnap.data() || {};
  const wardData = wardSnap.data() || {};

  const storedLmPcode = asTrimmedString(
    lmData?.pcode || lmData?.id || lmSnap.id,
  );
  const storedWardPcode = asTrimmedString(
    wardData?.pcode || wardData?.id || wardSnap.id,
  );
  const wardParentLmPcode = asTrimmedString(
    wardData?.parents?.localMunicipalityId,
  );

  if (storedLmPcode && storedLmPcode !== lmPcode) {
    throwFailedPrecondition(
      `LM document identity does not match ${lmPcode}.`,
    );
  }

  if (storedWardPcode && storedWardPcode !== wardPcode) {
    throwFailedPrecondition(
      `Ward document identity does not match ${wardPcode}.`,
    );
  }

  if (wardParentLmPcode !== lmPcode) {
    throwFailedPrecondition(
      `Ward ${wardPcode} does not belong to LM ${lmPcode}.`,
    );
  }

  return { lmData, wardData };
}


async function assertProposedLocationIsAvailable({
  db,
  wardData,
  wardPcode,
  proposedErfLocation,
}) {
  let wardGeometry;

  try {
    wardGeometry = assertPolygonGeometry(
      wardData?.geometry,
      `wards/${wardPcode}.geometry`,
    );
  } catch (error) {
    throwFailedPrecondition(
      "The selected ward boundary is unavailable or invalid.",
      {
        businessCode: "WARD_GEOMETRY_UNAVAILABLE",
        wardPcode,
        validationMessage: error?.message || "Invalid ward geometry.",
      },
    );
  }

  let pointInsideWard = false;

  try {
    pointInsideWard = geometryContainsPointInclusive(
      wardGeometry,
      proposedErfLocation,
      `wards/${wardPcode}.geometry`,
    );
  } catch (error) {
    throwFailedPrecondition(
      "The selected ward boundary could not be validated.",
      {
        businessCode: "WARD_GEOMETRY_UNAVAILABLE",
        wardPcode,
        validationMessage: error?.message || "Ward validation failed.",
      },
    );
  }

  if (!pointInsideWard) {
    throwFailedPrecondition(
      "The proposed Informal ERF position is outside the selected ward.",
      {
        businessCode: "LOCATION_OUTSIDE_SELECTED_WARD",
        wardPcode,
        proposedErfLocation,
      },
    );
  }

  const erfSnapshot = await db
    .collection("ireps_erfs")
    .where("admin.ward.pcode", "==", wardPcode)
    .get();

  let bboxCandidates = 0;
  let polygonChecks = 0;
  let pointOnlyInformalErfsSkipped = 0;

  for (const erfDoc of erfSnapshot.docs) {
    const existingErf = erfDoc.data() || {};
    const bboxRelation = getBboxPointRelation(
      existingErf?.bbox,
      proposedErfLocation,
    );

    if (bboxRelation === "OUTSIDE") {
      continue;
    }

    bboxCandidates += 1;

    let geometry;

    try {
      geometry = parseGeoJsonGeometry(
        existingErf?.geometry,
        `ireps_erfs/${erfDoc.id}.geometry`,
      );
    } catch (error) {
      throwFailedPrecondition(
        "Existing cadastral geometry could not be validated safely.",
        {
          businessCode: "CADASTRAL_VALIDATION_UNAVAILABLE",
          existingErfId: erfDoc.id,
          wardPcode,
          validationMessage:
            error?.message || "Existing ERF geometry is invalid.",
        },
      );
    }

    const existingErfType = String(
      existingErf?.erf?.type || "FORMAL",
    ).toUpperCase();

    if (geometry.type === "Point" && existingErfType === "INFORMAL") {
      pointOnlyInformalErfsSkipped += 1;
      continue;
    }

    if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
      throwFailedPrecondition(
        "Existing cadastral geometry could not be validated safely.",
        {
          businessCode: "CADASTRAL_VALIDATION_UNAVAILABLE",
          existingErfId: erfDoc.id,
          existingErfType,
          geometryType: geometry.type || "UNKNOWN",
          wardPcode,
        },
      );
    }

    polygonChecks += 1;

    let pointInsideExistingErf = false;

    try {
      pointInsideExistingErf = geometryContainsPointInclusive(
        geometry,
        proposedErfLocation,
        `ireps_erfs/${erfDoc.id}.geometry`,
      );
    } catch (error) {
      throwFailedPrecondition(
        "Existing cadastral geometry could not be validated safely.",
        {
          businessCode: "CADASTRAL_VALIDATION_UNAVAILABLE",
          existingErfId: erfDoc.id,
          wardPcode,
          validationMessage:
            error?.message || "Existing ERF polygon validation failed.",
        },
      );
    }

    if (pointInsideExistingErf) {
      throwFailedPrecondition(
        "An existing ERF already covers the proposed position.",
        {
          businessCode: "LOCATION_INSIDE_EXISTING_ERF",
          existingErfId: erfDoc.id,
          existingErfType,
          existingErfNo:
            existingErf?.sg?.erfNo ||
            existingErf?.sg?.parcelNo ||
            "NAv",
          wardPcode,
          proposedErfLocation,
        },
      );
    }
  }

  return {
    wardPcode,
    wardErfCount: erfSnapshot.size,
    bboxCandidates,
    polygonChecks,
    pointOnlyInformalErfsSkipped,
  };
}

export const submitInformalErfCallable = onCall(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (request) => {
    const startedAtMs = Date.now();
    const callerUid = request.auth?.uid || null;

    if (!callerUid) {
      throw new HttpsError(
        "unauthenticated",
        "Authentication is required.",
        {
          retriable: false,
          errorType: "PERMANENT",
        },
      );
    }

    if (!isPlainObject(request.data)) {
      throwInvalidArgument("The callable payload must be an object.");
    }

    const data = request.data;

    if (Number(data?.schemaVersion) !== 1) {
      throwInvalidArgument("schemaVersion must be 1.");
    }

    if (data?.formType !== "INFORMAL_ERF_CREATE") {
      throwInvalidArgument(
        "formType must be INFORMAL_ERF_CREATE.",
      );
    }

    const lmPcode = asTrimmedString(data?.lmPcode).toUpperCase();
    const wardPcode = asTrimmedString(data?.wardPcode).toUpperCase();

    if (!lmPcode || !wardPcode) {
      throwInvalidArgument("lmPcode and wardPcode are required.");
    }

    let erfId;
    let proposedErfLocation;
    let deviceLocation;
    let reason;
    let sitePhotos;
    let clientSubmittedAtMs;

    try {
      erfId = assertInformalErfId(data?.erfId, wardPcode);
      proposedErfLocation = assertValidLatLng(
        data?.proposedErfLocation,
        "proposedErfLocation",
      );
      deviceLocation = assertValidDeviceLocation(data?.deviceLocation);
      reason = normalizeReason(
        data?.reasonCode,
        data?.reasonOther,
      );
      sitePhotos = normalizeSitePhotos(data?.media, erfId);
      clientSubmittedAtMs = assertPositiveEpochMs(
        data?.clientSubmittedAtMs,
        "clientSubmittedAtMs",
      );
    } catch (error) {
      throwInvalidArgument(error.message);
    }

    logger.info("submitInformalErfCallable -- START", {
      erfId,
      callerUid,
      lmPcode,
      wardPcode,
      sitePhotoCount: sitePhotos.length,
    });

    try {
      const db = getFirestore();

      const [userSnap, lmSnap, wardSnap] = await Promise.all([
        db.collection("users").doc(callerUid).get(),
        db.collection("lms").doc(lmPcode).get(),
        db.collection("wards").doc(wardPcode).get(),
      ]);

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
        throwPermissionDenied(error.message);
      }

      if (actor.activeWorkbaseId !== lmPcode) {
        throwPermissionDenied(
          `The active workbase must be ${lmPcode}.`,
        );
      }

      const { lmData, wardData } = assertCanonicalParentDocuments({
        lmPcode,
        wardPcode,
        lmSnap,
        wardSnap,
      });

      let admin;

      try {
        admin = buildAdminHierarchy({
          lmPcode,
          wardPcode,
          lmData,
          wardData,
        });
      } catch (error) {
        throwFailedPrecondition(error.message);
      }

      const spatialValidation = await assertProposedLocationIsAvailable({
        db,
        wardData,
        wardPcode,
        proposedErfLocation,
      });

      logger.info("submitInformalErfCallable -- SPATIAL VALIDATION PASSED", {
        erfId,
        callerUid,
        lmPcode,
        ...spatialValidation,
      });

      await assertStorageObjectsExist(sitePhotos);

      const nowIso = new Date().toISOString();

      const erfDocument = buildInformalErfDocument({
        erfId,
        admin,
        proposedErfLocation,
        reason,
        deviceLocation,
        sitePhotos,
        clientSubmittedAtMs,
        actorUid: callerUid,
        actorName: actor.displayName,
        nowIso,
      });

      const erfRef = db.collection("ireps_erfs").doc(erfId);

      const result = await db.runTransaction(async (transaction) => {
        const existingSnap = await transaction.get(erfRef);

        if (existingSnap.exists) {
          const existing = existingSnap.data() || {};

          const isSameSubmission =
            existing?.erfId === erfId &&
            existing?.erf?.type === "INFORMAL" &&
            existing?.admin?.localMunicipality?.pcode === lmPcode &&
            existing?.admin?.ward?.pcode === wardPcode &&
            existing?.metadata?.createdByUid === callerUid;

          if (!isSameSubmission) {
            throw new HttpsError(
              "already-exists",
              "The erfId is already used by a different ERF submission.",
              {
                retriable: false,
                errorType: "PERMANENT",
                erfId,
              },
            );
          }

          return {
            success: true,
            code: "INFORMAL_ERF_ALREADY_CREATED",
            erfId,
            duplicate: true,
            message: "This Informal ERF was already created.",
          };
        }

        transaction.create(erfRef, erfDocument);

        return {
          success: true,
          code: "INFORMAL_ERF_CREATED",
          erfId,
          duplicate: false,
          message: "Informal ERF created successfully.",
        };
      });

      logger.info("submitInformalErfCallable -- COMPLETE", {
        erfId,
        callerUid,
        lmPcode,
        wardPcode,
        duplicate: result.duplicate,
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
        elapsedMs: Date.now() - startedAtMs,
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        "The Informal ERF could not be created.",
        {
          retriable: true,
          errorType: "TEMPORARY",
          erfId,
        },
      );
    }
  },
);
