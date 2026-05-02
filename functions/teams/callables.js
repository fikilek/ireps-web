// /functions/teams/callables.js

/* eslint-disable no-undef */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

import {
  normalizeTeamName,
  normalizeTeamDescription,
  normalizeMemberUserIds,
  buildCreateMetadata,
  buildUpdateMetadata,
  getActorUserDoc,
  getUserDocByUid,
  assertTeamManagerRole,
  assertTeamEligibleUser,
  getAllServiceProviders,
  resolveActorMncContext,
  assertUserAllowedInMncHierarchy,
  assertTeamBelongsToActorMnc,
  rebuildTeamServiceProviderIds,
  buildTeamCreatePayload,
  getUserDisplayName,
} from "./helpers.js";

/* =====================================================
   CREATE TEAM
   ===================================================== */

export const createTeam = onCall(async (request) => {
  const db = getFirestore();

  const actorUid = request.auth?.uid || null;
  if (!actorUid) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }

  const rawName = normalizeTeamName(request.data?.name);
  const rawDescription = normalizeTeamDescription(request.data?.description);

  if (!rawName) {
    throw new HttpsError("invalid-argument", "Team name is required.");
  }

  const actorUserDoc = await getActorUserDoc(db, actorUid);
  assertTeamManagerRole(actorUserDoc);

  const allServiceProviders = await getAllServiceProviders(db);

  const mncContext = resolveActorMncContext(actorUserDoc, allServiceProviders);

  const teamRef = db.collection("teams").doc();

  const now = new Date().toISOString();
  const actorName = getUserDisplayName(actorUserDoc);

  const payload = buildTeamCreatePayload({
    teamId: teamRef.id,
    teamName: rawName,
    description: rawDescription,
    mncServiceProviderId: mncContext.mncServiceProviderId,
    mncServiceProviderName: mncContext.mncServiceProviderName,
    actorUid,
    actorName,
    now,
  });

  await teamRef.set(payload);

  return {
    success: true,
    message: "Team created successfully.",
    teamId: teamRef.id,
  };
});

/* =====================================================
   RENAME TEAM
   ===================================================== */

export const renameTeam = onCall(async (request) => {
  const db = getFirestore();

  const actorUid = request.auth?.uid || null;
  if (!actorUid) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }

  const teamId = String(request.data?.teamId || "").trim();
  const newName = normalizeTeamName(request.data?.name);

  if (!teamId) {
    throw new HttpsError("invalid-argument", "Team id is required.");
  }

  if (!newName) {
    throw new HttpsError("invalid-argument", "Team name is required.");
  }

  const actorUserDoc = await getActorUserDoc(db, actorUid);
  assertTeamManagerRole(actorUserDoc);

  const allServiceProviders = await getAllServiceProviders(db);
  const mncContext = resolveActorMncContext(actorUserDoc, allServiceProviders);

  const teamRef = db.collection("teams").doc(teamId);
  const teamSnap = await teamRef.get();

  if (!teamSnap.exists) {
    throw new HttpsError("not-found", "Team not found.");
  }

  const teamData = teamSnap.data() || {};

  assertTeamBelongsToActorMnc(teamData, mncContext.mncServiceProviderId);

  const now = new Date().toISOString();
  const actorName = getUserDisplayName(actorUserDoc);

  const metadata = buildUpdateMetadata(
    teamData?.metadata || {},
    actorUid,
    actorName,
    now,
  );

  await teamRef.update({
    "team.name": newName,
    metadata,
  });

  return {
    success: true,
    message: "Team renamed successfully.",
    teamId,
  };
});

/* =====================================================
   ADD TEAM MEMBER
   ===================================================== */

export const addTeamMember = onCall(async (request) => {
  const db = getFirestore();

  const actorUid = request.auth?.uid || null;
  if (!actorUid) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }

  const teamId = String(request.data?.teamId || "").trim();
  const userUid = String(request.data?.userUid || "").trim();

  if (!teamId || !userUid) {
    throw new HttpsError(
      "invalid-argument",
      "Team id and user uid are required.",
    );
  }

  const actorUserDoc = await getActorUserDoc(db, actorUid);
  assertTeamManagerRole(actorUserDoc);

  const allServiceProviders = await getAllServiceProviders(db);
  const mncContext = resolveActorMncContext(actorUserDoc, allServiceProviders);

  const teamRef = db.collection("teams").doc(teamId);
  const teamSnap = await teamRef.get();

  if (!teamSnap.exists) {
    throw new HttpsError("not-found", "Team not found.");
  }

  const teamData = teamSnap.data() || {};

  assertTeamBelongsToActorMnc(teamData, mncContext.mncServiceProviderId);

  const candidateUserDoc = await getUserDocByUid(db, userUid);

  assertTeamEligibleUser(candidateUserDoc);

  assertUserAllowedInMncHierarchy({
    candidateUserDoc,
    mncServiceProviderId: mncContext.mncServiceProviderId,
    allServiceProviders,
  });

  const existingMemberUserIds = normalizeMemberUserIds(
    teamData?.scope?.memberUserIds,
  );

  if (existingMemberUserIds.includes(userUid)) {
    throw new HttpsError(
      "already-exists",
      "User is already a member of this team.",
    );
  }

  const nextMemberUserIds = normalizeMemberUserIds([
    ...existingMemberUserIds,
    userUid,
  ]);

  const nextServiceProviderIds = await rebuildTeamServiceProviderIds(
    db,
    nextMemberUserIds,
  );

  const now = new Date().toISOString();
  const actorName = getUserDisplayName(actorUserDoc);

  const metadata = buildUpdateMetadata(
    teamData?.metadata || {},
    actorUid,
    actorName,
    now,
  );

  await teamRef.update({
    "scope.memberUserIds": nextMemberUserIds,
    "scope.serviceProviderIds": nextServiceProviderIds,
    metadata,
  });

  return {
    success: true,
    message: "Member added successfully.",
    teamId,
    userUid,
  };
});

/* =====================================================
   REMOVE TEAM MEMBER
   ===================================================== */

export const removeTeamMember = onCall(async (request) => {
  const db = getFirestore();

  const actorUid = request.auth?.uid || null;
  if (!actorUid) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }

  const teamId = String(request.data?.teamId || "").trim();
  const userUid = String(request.data?.userUid || "").trim();

  if (!teamId || !userUid) {
    throw new HttpsError(
      "invalid-argument",
      "Team id and user uid are required.",
    );
  }

  const actorUserDoc = await getActorUserDoc(db, actorUid);
  assertTeamManagerRole(actorUserDoc);

  const allServiceProviders = await getAllServiceProviders(db);
  const mncContext = resolveActorMncContext(actorUserDoc, allServiceProviders);

  const teamRef = db.collection("teams").doc(teamId);
  const teamSnap = await teamRef.get();

  if (!teamSnap.exists) {
    throw new HttpsError("not-found", "Team not found.");
  }

  const teamData = teamSnap.data() || {};

  assertTeamBelongsToActorMnc(teamData, mncContext.mncServiceProviderId);

  const existingMemberUserIds = normalizeMemberUserIds(
    teamData?.scope?.memberUserIds,
  );

  if (!existingMemberUserIds.includes(userUid)) {
    throw new HttpsError("not-found", "User is not a member of this team.");
  }

  const nextMemberUserIds = normalizeMemberUserIds(
    existingMemberUserIds.filter((uid) => uid !== userUid),
  );

  const nextServiceProviderIds = await rebuildTeamServiceProviderIds(
    db,
    nextMemberUserIds,
  );

  const now = new Date().toISOString();
  const actorName = getUserDisplayName(actorUserDoc);

  const metadata = buildUpdateMetadata(
    teamData?.metadata || {},
    actorUid,
    actorName,
    now,
  );

  await teamRef.update({
    "scope.memberUserIds": nextMemberUserIds,
    "scope.serviceProviderIds": nextServiceProviderIds,
    metadata,
  });

  return {
    success: true,
    message: "Member removed successfully.",
    teamId,
    userUid,
  };
});

/* =====================================================
   DELETE TEAM
   ===================================================== */

export const deleteTeam = onCall(async (request) => {
  const db = getFirestore();

  const actorUid = request.auth?.uid || null;
  if (!actorUid) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }

  const teamId = String(request.data?.teamId || "").trim();

  if (!teamId) {
    throw new HttpsError("invalid-argument", "Team id is required.");
  }

  const actorUserDoc = await getActorUserDoc(db, actorUid);
  assertTeamManagerRole(actorUserDoc);

  const allServiceProviders = await getAllServiceProviders(db);
  const mncContext = resolveActorMncContext(actorUserDoc, allServiceProviders);

  const teamRef = db.collection("teams").doc(teamId);
  const teamSnap = await teamRef.get();

  if (!teamSnap.exists) {
    throw new HttpsError("not-found", "Team not found.");
  }

  const teamData = teamSnap.data() || {};

  assertTeamBelongsToActorMnc(teamData, mncContext.mncServiceProviderId);

  await teamRef.delete();

  return {
    success: true,
    message: "Team deleted successfully.",
    teamId,
  };
});
