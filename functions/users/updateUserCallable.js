import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import {
  assertNotSelfRoleChange,
  assertRoleActuallyChanges,
  assertRoleHierarchy,
  assertValidRole,
  buildRoleUpdateFields,
  getUserDisplayName,
  getUserRole,
  normalizeUid,
  requiresTeamMembershipCheck,
} from "./helpers.js";

async function getUserSnapshotOrThrow(db, uid, label) {
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw new HttpsError("not-found", `${label} user was not found.`);
  }

  return { userRef, userSnap, userData: userSnap.data() || {} };
}

async function assertTargetMayLeaveOperationalRole(db, targetUid, newRole) {
  if (!requiresTeamMembershipCheck(newRole)) return;

  const teamSnap = await db
    .collection("teams")
    .where("scope.memberUserIds", "array-contains", targetUid)
    .limit(1)
    .get();

  if (!teamSnap.empty) {
    throw new HttpsError(
      "failed-precondition",
      "User is currently assigned to an operational team. Remove the user from the team before assigning this role.",
    );
  }
}

function toCallableError(error) {
  if (error instanceof HttpsError) return error;

  return new HttpsError(
    "internal",
    "Could not update the user role.",
  );
}

export const updateUserCallable = onCall(async (request) => {
  const actorUid = normalizeUid(request.auth?.uid);

  if (!actorUid) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }

  const targetUid = normalizeUid(request.data?.userUid);
  const newRole = assertValidRole(request.data?.newRole, "New role");

  if (!targetUid) {
    throw new HttpsError("invalid-argument", "Target user uid is required.");
  }

  assertNotSelfRoleChange(actorUid, targetUid);

  const db = getFirestore();
  const auth = getAuth();

  const actor = await getUserSnapshotOrThrow(db, actorUid, "Actor");
  const target = await getUserSnapshotOrThrow(db, targetUid, "Target");

  const actorRole = getUserRole(actor.userData);
  const previousRole = getUserRole(target.userData);

  assertRoleHierarchy({
    actorRole,
    targetRole: previousRole,
    newRole,
  });

  assertRoleActuallyChanges(previousRole, newRole);

  await assertTargetMayLeaveOperationalRole(db, targetUid, newRole);

  let authUser;

  try {
    authUser = await auth.getUser(targetUid);
  } catch (error) {
    logger.error("updateUserCallable -- target Firebase Auth user missing", {
      actorUid,
      targetUid,
      error,
    });

    throw new HttpsError(
      "failed-precondition",
      "Target user does not have a matching Firebase Auth account.",
    );
  }

  const previousClaims = { ...(authUser.customClaims || {}) };
  const nextClaims = {
    ...previousClaims,
    role: newRole,
  };

  const now = new Date().toISOString();
  const actorName = getUserDisplayName(actor.userData);
  const updateFields = buildRoleUpdateFields({
    targetUserDoc: target.userData,
    newRole,
    actorUid,
    actorName,
    now,
  });

  let authClaimsUpdated = false;

  try {
    await auth.setCustomUserClaims(targetUid, nextClaims);
    authClaimsUpdated = true;

    await target.userRef.update(updateFields);
  } catch (error) {
    if (authClaimsUpdated) {
      try {
        await auth.setCustomUserClaims(targetUid, previousClaims);
      } catch (rollbackError) {
        logger.error(
          "updateUserCallable -- CRITICAL Auth rollback failure",
          {
            actorUid,
            targetUid,
            previousRole,
            newRole,
            error,
            rollbackError,
          },
        );

        throw new HttpsError(
          "internal",
          "Role update failed and Firebase Auth rollback also failed. Administrator investigation is required.",
        );
      }
    }

    logger.error("updateUserCallable -- role update failed", {
      actorUid,
      targetUid,
      previousRole,
      newRole,
      error,
    });

    throw toCallableError(error);
  }

  logger.info("updateUserCallable -- SUCCESS", {
    actorUid,
    actorRole,
    targetUid,
    previousRole,
    newRole,
  });

  return {
    success: true,
    userUid: targetUid,
    previousRole,
    newRole,
    message: "User role updated successfully.",
  };
});
