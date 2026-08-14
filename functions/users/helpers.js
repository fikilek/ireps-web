import { HttpsError } from "firebase-functions/v2/https";

export const VALID_USER_ROLES = Object.freeze([
  "SPU",
  "ADM",
  "MNG",
  "SPV",
  "FWR",
]);

const ROLE_LEVEL = Object.freeze({
  FWR: 1,
  SPV: 2,
  MNG: 3,
  ADM: 4,
  SPU: 5,
});

const ROLE_MANAGERS = new Set(["SPU", "ADM", "MNG"]);
const OPERATIONAL_TEAM_ROLES = new Set(["FWR", "SPV"]);

export function normalizeUserRole(value) {
  return String(value || "").trim().toUpperCase();
}

export function normalizeUid(value) {
  return String(value || "").trim();
}

export function getUserRole(userDoc = {}) {
  return normalizeUserRole(
    userDoc?.employment?.role ||
      userDoc?.profile?.employment?.role ||
      userDoc?.role ||
      "",
  );
}

export function getUserDisplayName(userDoc = {}) {
  const profile = userDoc?.profile || {};
  const fullName = [profile?.name, profile?.surname]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");

  return (
    String(profile?.displayName || "").trim() ||
    fullName ||
    String(profile?.email || userDoc?.email || userDoc?.auth?.email || "").trim() ||
    "NAv"
  );
}

export function assertValidRole(role, label = "Role") {
  const normalizedRole = normalizeUserRole(role);

  if (!VALID_USER_ROLES.includes(normalizedRole)) {
    throw new HttpsError(
      "invalid-argument",
      `${label} must be one of ${VALID_USER_ROLES.join(", ")}.`,
    );
  }

  return normalizedRole;
}

export function assertRoleManager(actorRole) {
  const normalizedActorRole = normalizeUserRole(actorRole);

  if (!ROLE_MANAGERS.has(normalizedActorRole)) {
    throw new HttpsError(
      "permission-denied",
      "Only SPU, ADM or MNG may change user roles.",
    );
  }

  return normalizedActorRole;
}

export function assertNotSelfRoleChange(actorUid, targetUid) {
  const normalizedActorUid = normalizeUid(actorUid);
  const normalizedTargetUid = normalizeUid(targetUid);

  if (!normalizedActorUid) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }

  if (!normalizedTargetUid) {
    throw new HttpsError("invalid-argument", "Target user uid is required.");
  }

  if (normalizedActorUid === normalizedTargetUid) {
    throw new HttpsError(
      "permission-denied",
      "You cannot change your own role.",
    );
  }
}

export function assertRoleHierarchy({
  actorRole,
  targetRole,
  newRole,
}) {
  const normalizedActorRole = assertRoleManager(actorRole);
  const normalizedTargetRole = assertValidRole(targetRole, "Target user role");
  const normalizedNewRole = assertValidRole(newRole, "New role");

  if (normalizedActorRole === "SPU") {
    return {
      actorRole: normalizedActorRole,
      targetRole: normalizedTargetRole,
      newRole: normalizedNewRole,
    };
  }

  const actorLevel = ROLE_LEVEL[normalizedActorRole];
  const targetLevel = ROLE_LEVEL[normalizedTargetRole];
  const newRoleLevel = ROLE_LEVEL[normalizedNewRole];

  if (actorLevel <= targetLevel) {
    throw new HttpsError(
      "permission-denied",
      "You cannot change a user at your role level or above.",
    );
  }

  if (actorLevel <= newRoleLevel) {
    throw new HttpsError(
      "permission-denied",
      "You cannot assign a role at your role level or above.",
    );
  }

  return {
    actorRole: normalizedActorRole,
    targetRole: normalizedTargetRole,
    newRole: normalizedNewRole,
  };
}

export function assertRoleActuallyChanges(previousRole, newRole) {
  const normalizedPreviousRole = assertValidRole(previousRole, "Current role");
  const normalizedNewRole = assertValidRole(newRole, "New role");

  if (normalizedPreviousRole === normalizedNewRole) {
    throw new HttpsError(
      "failed-precondition",
      `User already has role ${normalizedPreviousRole}.`,
    );
  }
}

export function requiresTeamMembershipCheck(newRole) {
  return !OPERATIONAL_TEAM_ROLES.has(assertValidRole(newRole, "New role"));
}

export function buildRoleUpdateFields({
  targetUserDoc = {},
  newRole,
  actorUid,
  actorName,
  now,
}) {
  const normalizedNewRole = assertValidRole(newRole, "New role");
  const safeNow = now || new Date().toISOString();
  const safeActorUid = normalizeUid(actorUid) || "NAv";
  const safeActorName = String(actorName || "").trim() || "NAv";

  const updateFields = {
    "employment.role": normalizedNewRole,
    "metadata.updatedAt": safeNow,
    "metadata.updatedByUid": safeActorUid,
    "metadata.updatedByUser": safeActorName,
    "metadata.roleUpdatedAt": safeNow,
    "metadata.roleUpdatedByUid": safeActorUid,
    "metadata.roleUpdatedByUser": safeActorName,
  };

  if (Object.prototype.hasOwnProperty.call(targetUserDoc, "role")) {
    updateFields.role = normalizedNewRole;
  }

  if (
    targetUserDoc?.profile?.employment &&
    Object.prototype.hasOwnProperty.call(
      targetUserDoc.profile.employment,
      "role",
    )
  ) {
    updateFields["profile.employment.role"] = normalizedNewRole;
  }

  return updateFields;
}
