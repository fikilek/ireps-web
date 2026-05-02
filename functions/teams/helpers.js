// /functions/teams/helpers.js

/* eslint-disable no-undef */

import { HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

/* =====================================================
   NORMALIZERS
   ===================================================== */

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  const seen = new Set();

  return normalizeArray(values)
    .map((value) => normalizeText(value))
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

export function normalizeTeamName(value = "") {
  return normalizeText(value);
}

export function normalizeTeamDescription(value = "") {
  const clean = normalizeText(value);
  return clean || "NAv";
}

export function normalizeMemberUserIds(memberUserIds = []) {
  return uniqueStrings(memberUserIds);
}

/* =====================================================
   USER HELPERS
   Supports both:
   - user.employment.role
   - user.profile.employment.role
   because your project has some older + newer shapes in play
   ===================================================== */

export function getUserRole(userDoc = {}) {
  return (
    userDoc?.employment?.role || userDoc?.profile?.employment?.role || "NAv"
  );
}

export function getUserDisplayName(userDoc = {}) {
  return (
    userDoc?.profile?.displayName ||
    userDoc?.displayName ||
    userDoc?.profile?.name ||
    "NAv"
  );
}

export function getUserServiceProvider(userDoc = {}) {
  return (
    userDoc?.employment?.serviceProvider ||
    userDoc?.profile?.employment?.serviceProvider ||
    null
  );
}

export function getUserServiceProviderId(userDoc = {}) {
  return normalizeText(getUserServiceProvider(userDoc)?.id || "");
}

export function getUserServiceProviderName(userDoc = {}) {
  return normalizeText(getUserServiceProvider(userDoc)?.name || "") || "NAv";
}

/* =====================================================
   METADATA HELPERS
   ===================================================== */

export function buildCreateMetadata(actorUid, actorName, now) {
  const safeNow = now || new Date().toISOString();
  const safeActorUid = normalizeText(actorUid) || "NAv";
  const safeActorName = normalizeText(actorName) || "NAv";

  return {
    createdAt: safeNow,
    createdByUid: safeActorUid,
    createdByUser: safeActorName,
    updatedAt: safeNow,
    updatedByUid: safeActorUid,
    updatedByUser: safeActorName,
  };
}

export function buildUpdateMetadata(
  existingMetadata = {},
  actorUid,
  actorName,
  now,
) {
  const safeNow = now || new Date().toISOString();
  const safeActorUid = normalizeText(actorUid) || "NAv";
  const safeActorName = normalizeText(actorName) || "NAv";

  return {
    createdAt: existingMetadata?.createdAt || safeNow,
    createdByUid: existingMetadata?.createdByUid || safeActorUid,
    createdByUser: existingMetadata?.createdByUser || safeActorName,
    updatedAt: safeNow,
    updatedByUid: safeActorUid,
    updatedByUser: safeActorName,
  };
}

/* =====================================================
   USER LOADERS
   ===================================================== */

export async function getUserDocByUid(db, uid) {
  const safeUid = normalizeText(uid);

  if (!safeUid) {
    throw new HttpsError("invalid-argument", "User uid is required.");
  }

  const userSnap = await db.collection("users").doc(safeUid).get();

  if (!userSnap.exists) {
    throw new HttpsError("not-found", `User [${safeUid}] was not found.`);
  }

  return {
    uid: userSnap.id,
    id: userSnap.id,
    ...userSnap.data(),
  };
}

export async function getActorUserDoc(db, actorUid) {
  const safeActorUid = normalizeText(actorUid);

  if (!safeActorUid) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }

  return getUserDocByUid(db, safeActorUid);
}

export function assertTeamManagerRole(userDoc = {}) {
  const role = getUserRole(userDoc);

  if (!["MNG", "SPV"].includes(role)) {
    throw new HttpsError(
      "permission-denied",
      "Only MNG or SPV may manage teams.",
    );
  }

  return role;
}

/* =====================================================
   SERVICE PROVIDER HELPERS
   ===================================================== */

export async function getAllServiceProviders(db) {
  const snapshot = await db.collection("serviceProviders").get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

export function getServiceProviderById(
  serviceProviderId,
  allServiceProviders = [],
) {
  const safeServiceProviderId = normalizeText(serviceProviderId);

  if (!safeServiceProviderId) return null;

  return (
    normalizeArray(allServiceProviders).find(
      (serviceProvider) => serviceProvider?.id === safeServiceProviderId,
    ) || null
  );
}

export function getServiceProviderName(serviceProvider = {}) {
  return (
    normalizeText(serviceProvider?.profile?.tradingName || "") ||
    normalizeText(serviceProvider?.name || "") ||
    "NAv"
  );
}

export function normalizeClients(clients = []) {
  return normalizeArray(clients);
}

export function getServiceProviderLmClients(serviceProvider = {}) {
  return normalizeClients(serviceProvider?.clients).filter(
    (client) =>
      client?.clientType === "LM" &&
      client?.relationshipType === "MNC" &&
      normalizeText(client?.id) &&
      normalizeText(client?.name),
  );
}

export function getServiceProviderParentSpClient(serviceProvider = {}) {
  return (
    normalizeClients(serviceProvider?.clients).find(
      (client) =>
        client?.clientType === "SP" &&
        client?.relationshipType === "SUBC" &&
        normalizeText(client?.id),
    ) || null
  );
}

export function isMncServiceProvider(serviceProvider = {}) {
  return getServiceProviderLmClients(serviceProvider).length > 0;
}

export function isSubcServiceProvider(serviceProvider = {}) {
  return Boolean(getServiceProviderParentSpClient(serviceProvider));
}

/* =====================================================
   MNC RESOLUTION
   ===================================================== */

export function resolveServiceProviderMnc(
  serviceProviderId,
  allServiceProviders = [],
  visitedIds = new Set(),
) {
  const safeServiceProviderId = normalizeText(serviceProviderId);

  if (!safeServiceProviderId) {
    return null;
  }

  if (visitedIds.has(safeServiceProviderId)) {
    logger.warn("resolveServiceProviderMnc -- circular SP relationship", {
      serviceProviderId: safeServiceProviderId,
    });
    return null;
  }

  visitedIds.add(safeServiceProviderId);

  const serviceProvider = getServiceProviderById(
    safeServiceProviderId,
    allServiceProviders,
  );

  if (!serviceProvider) {
    return null;
  }

  if (isMncServiceProvider(serviceProvider)) {
    return {
      id: serviceProvider.id,
      name: getServiceProviderName(serviceProvider),
      serviceProvider,
    };
  }

  const parentSpClient = getServiceProviderParentSpClient(serviceProvider);

  if (!parentSpClient?.id) {
    return null;
  }

  return resolveServiceProviderMnc(
    parentSpClient.id,
    allServiceProviders,
    visitedIds,
  );
}

export function resolveActorMncContext(actorUserDoc, allServiceProviders = []) {
  const actorServiceProviderId = getUserServiceProviderId(actorUserDoc);

  if (!actorServiceProviderId) {
    throw new HttpsError(
      "failed-precondition",
      "Actor is not linked to a valid service provider.",
    );
  }

  const actorServiceProvider = getServiceProviderById(
    actorServiceProviderId,
    allServiceProviders,
  );

  if (!actorServiceProvider) {
    throw new HttpsError("not-found", "Actor service provider was not found.");
  }

  const resolvedMnc = resolveServiceProviderMnc(
    actorServiceProviderId,
    allServiceProviders,
    new Set(),
  );

  if (!resolvedMnc?.id) {
    throw new HttpsError(
      "failed-precondition",
      "Could not resolve actor MNC context.",
    );
  }

  return {
    actorServiceProviderId,
    actorServiceProviderName: getServiceProviderName(actorServiceProvider),
    mncServiceProviderId: resolvedMnc.id,
    mncServiceProviderName: resolvedMnc.name || "NAv",
  };
}

/* =====================================================
   HIERARCHY VALIDATION
   ===================================================== */

export function isUserAllowedInMncHierarchy({
  candidateUserDoc = {},
  mncServiceProviderId,
  allServiceProviders = [],
}) {
  const safeMncServiceProviderId = normalizeText(mncServiceProviderId);
  const candidateServiceProviderId = getUserServiceProviderId(candidateUserDoc);

  if (!safeMncServiceProviderId || !candidateServiceProviderId) {
    return false;
  }

  const resolvedCandidateMnc = resolveServiceProviderMnc(
    candidateServiceProviderId,
    allServiceProviders,
    new Set(),
  );

  if (!resolvedCandidateMnc?.id) {
    return false;
  }

  return resolvedCandidateMnc.id === safeMncServiceProviderId;
}

export function assertUserAllowedInMncHierarchy({
  candidateUserDoc = {},
  mncServiceProviderId,
  allServiceProviders = [],
}) {
  const allowed = isUserAllowedInMncHierarchy({
    candidateUserDoc,
    mncServiceProviderId,
    allServiceProviders,
  });

  if (!allowed) {
    throw new HttpsError(
      "permission-denied",
      "User is outside the allowed MNC hierarchy.",
    );
  }

  return true;
}

export function assertTeamEligibleUser(candidateUserDoc = {}) {
  const candidateRole = getUserRole(candidateUserDoc);

  if (!["FWR", "SPV"].includes(candidateRole)) {
    throw new HttpsError(
      "failed-precondition",
      "Only FWR or SPV users may be team members.",
    );
  }

  return true;
}

// export function assertTeamEligibleUser(candidateUserDoc = {}) {
//   const candidateRole = getUserRole(candidateUserDoc);

//   if (candidateRole !== "FWR") {
//     throw new HttpsError(
//       "failed-precondition",
//       "Only FWR users may be team members.",
//     );
//   }

//   return true;
// }

/* =====================================================
   TEAM HELPERS
   ===================================================== */

export async function rebuildTeamServiceProviderIds(db, memberUserIds = []) {
  const normalizedMemberUserIds = normalizeMemberUserIds(memberUserIds);

  if (normalizedMemberUserIds.length === 0) {
    return [];
  }

  const serviceProviderIds = [];
  const seenServiceProviderIds = new Set();

  for (const userUid of normalizedMemberUserIds) {
    const userSnap = await db.collection("users").doc(userUid).get();

    if (!userSnap.exists) {
      logger.warn("rebuildTeamServiceProviderIds -- user missing", { userUid });
      continue;
    }

    const userData = userSnap.data() || {};
    const serviceProviderId = getUserServiceProviderId(userData);

    if (!serviceProviderId || seenServiceProviderIds.has(serviceProviderId)) {
      continue;
    }

    seenServiceProviderIds.add(serviceProviderId);
    serviceProviderIds.push(serviceProviderId);
  }

  return serviceProviderIds.sort((a, b) => String(a).localeCompare(String(b)));
}

export function assertTeamBelongsToActorMnc(
  teamData = {},
  actorMncServiceProviderId,
) {
  const teamMncServiceProviderId = normalizeText(
    teamData?.ownership?.mncServiceProviderId || "",
  );

  const safeActorMncServiceProviderId = normalizeText(
    actorMncServiceProviderId,
  );

  if (!teamMncServiceProviderId) {
    throw new HttpsError(
      "failed-precondition",
      "Team ownership is missing a valid MNC service provider.",
    );
  }

  if (teamMncServiceProviderId !== safeActorMncServiceProviderId) {
    throw new HttpsError(
      "permission-denied",
      "You may only manage teams in your MNC hierarchy.",
    );
  }

  return true;
}

export function buildTeamCreatePayload({
  teamId,
  teamName,
  description,
  mncServiceProviderId,
  mncServiceProviderName,
  actorUid,
  actorName,
  now,
}) {
  const safeTeamId = normalizeText(teamId);

  if (!safeTeamId) {
    throw new HttpsError("invalid-argument", "Team id is required.");
  }

  const safeTeamName = normalizeTeamName(teamName);

  if (!safeTeamName) {
    throw new HttpsError("invalid-argument", "Team name is required.");
  }

  const safeNow = now || new Date().toISOString();

  return {
    id: safeTeamId,

    team: {
      name: safeTeamName,
      code: "NAv",
      status: "ACTIVE",
      description: normalizeTeamDescription(description),
    },

    ownership: {
      mncServiceProviderId: normalizeText(mncServiceProviderId) || "NAv",
      mncServiceProviderName: normalizeText(mncServiceProviderName) || "NAv",
    },

    scope: {
      serviceProviderIds: [],
      memberUserIds: [],
    },

    visibility: {
      allowedRoleCodes: ["MNG", "SPV"],
    },

    metadata: buildCreateMetadata(actorUid, actorName, safeNow),
  };
}
