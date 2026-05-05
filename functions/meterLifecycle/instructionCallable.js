import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import {
  ACTIVE_LCT_WORKFLOW_STATES,
  buildFailureResult,
  buildLifecycleInstructionTrnPayload,
  buildSuccessResult,
  getActorNameFromRequest,
  normalizeUpper,
  validateCreateLifecycleInstructionInput,
  validateLifecycleInstructionAssignment,
  validateLifecycleInstructionEligibility,
} from "./helpers.js";

function readFirstString(...values) {
  for (const value of values) {
    const clean = String(value || "").trim();
    if (clean) return clean;
  }

  return "";
}

function extractRoleFromProfileOrToken({ profile = {}, token = {} }) {
  return normalizeUpper(
    readFirstString(
      token?.role,
      token?.userRole,
      token?.employmentRole,
      token?.employment_role,
      token?.irepsRole,
      profile?.role,
      profile?.userRole,
      profile?.employment?.role,
      profile?.employment?.position,
    ),
  );
}

function extractServiceProviderRelationship({ profile = {}, token = {} }) {
  return normalizeUpper(
    readFirstString(
      token?.serviceProviderRelationshipType,
      token?.relationshipType,
      token?.spRelationshipType,
      token?.employmentServiceProviderRelationshipType,
      profile?.employment?.serviceProvider?.relationshipType,
      profile?.employment?.serviceProvider?.clientRelationshipType,
      profile?.serviceProvider?.relationshipType,
    ),
  );
}

function extractServiceProviderClientType({ profile = {}, token = {} }) {
  return normalizeUpper(
    readFirstString(
      token?.serviceProviderClientType,
      token?.clientType,
      token?.spClientType,
      profile?.employment?.serviceProvider?.clientType,
      profile?.serviceProvider?.clientType,
    ),
  );
}

async function findActorProfile(db, uid) {
  const candidatePaths = [
    `users/${uid}`,
    `userProfiles/${uid}`,
    `profiles/${uid}`,
  ];

  for (const path of candidatePaths) {
    const snap = await db.doc(path).get();

    if (snap.exists) {
      return snap.data() || {};
    }
  }

  return {};
}

async function resolveCreateInstructionAuthority({ db, request }) {
  const uid = request?.auth?.uid;
  const token = request?.auth?.token || {};

  const profile = await findActorProfile(db, uid);

  const role = extractRoleFromProfileOrToken({
    profile,
    token,
  });

  const relationshipType = extractServiceProviderRelationship({
    profile,
    token,
  });

  const clientType = extractServiceProviderClientType({
    profile,
    token,
  });

  const isMnc =
    relationshipType === "MNC" ||
    clientType === "MNC" ||
    profile?.employment?.serviceProvider?.isMnc === true ||
    profile?.serviceProvider?.isMnc === true;

  const isMng = role === "MNG";
  const isMncSpv = role === "SPV" && isMnc;

  return {
    ok: isMng || isMncSpv,
    role: role || "UNKNOWN",
    relationshipType: relationshipType || "UNKNOWN",
    clientType: clientType || "UNKNOWN",
    isMnc,
  };
}

export const onCreateMeterLifecycleInstructionCallable = onCall(
  async (request) => {
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

      const authority = await resolveCreateInstructionAuthority({
        db,
        request,
      });

      if (!authority.ok) {
        return buildFailureResult(
          "UNAUTHORIZED_LCT_ORIGINATOR",
          "Only MNG and MNC supervisors can create lifecycle instructions",
          {
            actorRole: authority.role,
            actorRelationshipType: authority.relationshipType,
            actorClientType: authority.clientType,
          },
        );
      }

      const inputCheck = validateCreateLifecycleInstructionInput(data);

      if (!inputCheck.ok) {
        return buildFailureResult(inputCheck.code, inputCheck.message);
      }

      const { trnId, trnType, astId, premiseId } = inputCheck;

      logger.info("onCreateMeterLifecycleInstructionCallable -- START", {
        trnId,
        trnType,
        astId,
        premiseId,
        actorUid,
        actorRole: authority.role,
      });

      const assignmentCheck = validateLifecycleInstructionAssignment(
        data?.assignment || {},
        trnType,
      );

      if (!assignmentCheck.ok) {
        return buildFailureResult(
          assignmentCheck.code,
          assignmentCheck.message,
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

      await db.runTransaction(async (tx) => {
        const trnSnap = await tx.get(trnRef);
        const astSnap = await tx.get(astRef);
        const premiseSnap = await tx.get(premiseRef);

        const activeInstructionQuery = db
          .collection("trns")
          .where("ast.astData.astId", "==", astId)
          .where("accessData.trnType", "==", trnType)
          .where("workflow.state", "in", ACTIVE_LCT_WORKFLOW_STATES)
          .limit(1);

        const activeInstructionSnap = await tx.get(activeInstructionQuery);

        if (trnSnap.exists) {
          responsePayload = buildFailureResult(
            "TRN_ALREADY_EXISTS",
            "A TRN with this id already exists",
            {
              trnId,
              trnType,
              astId,
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

        if (!activeInstructionSnap.empty) {
          const existingDoc = activeInstructionSnap.docs[0];
          const existingData = existingDoc.data() || {};

          responsePayload = buildFailureResult(
            "ACTIVE_LCT_ALREADY_EXISTS",
            "This meter already has an active lifecycle instruction of this type",
            {
              trnId,
              trnType,
              astId,
              existingTrnId: existingDoc.id,
              existingWorkflowState: existingData?.workflow?.state || "NAv",
            },
          );

          return;
        }

        const astDoc = astSnap.data() || {};
        const premiseData = premiseSnap.data() || {};

        const eligibilityCheck = validateLifecycleInstructionEligibility({
          trnType,
          astDoc,
        });

        if (!eligibilityCheck.ok) {
          responsePayload = buildFailureResult(
            eligibilityCheck.code,
            eligibilityCheck.message,
            {
              trnId,
              trnType,
              astId,
            },
          );

          return;
        }

        const cleanInstructionTrn = buildLifecycleInstructionTrnPayload({
          data,
          astDoc,
          premiseData,
          now,
          actorUid,
          actorName,
        });

        tx.create(trnRef, cleanInstructionTrn);

        responsePayload = buildSuccessResult(
          trnId,
          "Lifecycle instruction TRN created successfully",
          {
            trnType,
            astId,
            premiseId,
            workflowState: "ISSUED",
          },
        );
      });

      return (
        responsePayload ||
        buildFailureResult(
          "UNKNOWN_ERROR",
          "Lifecycle instruction TRN was not created",
        )
      );
    } catch (error) {
      logger.error("onCreateMeterLifecycleInstructionCallable -- ERROR", {
        message: error?.message || String(error),
        stack: error?.stack || "NAv",
      });

      return buildFailureResult(
        "UNKNOWN_ERROR",
        error?.message || "Failed to create lifecycle instruction",
      );
    }
  },
);
