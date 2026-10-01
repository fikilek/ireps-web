// DR-R001 section 4: office work is sent to somebody, and only that somebody
// may accept it, open it and report it. This module answers the two questions
// the server must never take on trust: who is submitting, and is this job
// theirs. The phone hides other people's work; these checks are what make it
// a rule rather than a courtesy.

import { normalizeUpper } from "./helpers.js";

function readFirstString(...values) {
  for (const value of values) {
    const clean = String(value || "").trim();
    if (clean) return clean;
  }

  return "";
}

export async function loadActorProfile(db, uid) {
  if (!uid) return {};

  const candidatePaths = [`users/${uid}`, `userProfiles/${uid}`, `profiles/${uid}`];

  for (const path of candidatePaths) {
    const snap = await db.doc(path).get();

    if (snap.exists) return snap.data() || {};
  }

  return {};
}

export function readActorRole({ profile = {}, token = {} }) {
  return normalizeUpper(
    readFirstString(
      token?.role,
      token?.userRole,
      token?.employmentRole,
      token?.employment_role,
      token?.irepsRole,
      profile?.employment?.role,
      profile?.role,
      profile?.userRole,
    ),
  );
}

export function readActorServiceProviderId({ profile = {}, token = {} }) {
  return readFirstString(
    token?.spId,
    token?.serviceProviderId,
    token?.employmentServiceProviderId,
    profile?.employment?.serviceProvider?.id,
    profile?.serviceProvider?.id,
  );
}

export async function resolveActorIdentity({ db, request }) {
  const uid = request?.auth?.uid || "";
  const token = request?.auth?.token || {};
  const profile = await loadActorProfile(db, uid);

  return {
    uid,
    role: readActorRole({ profile, token }),
    spId: readActorServiceProviderId({ profile, token }),
  };
}

export function assignmentTargetsOf(trnData = {}) {
  const targets = Array.isArray(trnData?.assignment?.targets)
    ? trnData.assignment.targets
    : [];

  return targets
    .map((target) => ({
      type: normalizeUpper(target?.type),
      id: String(target?.id || "").trim(),
    }))
    .filter(
      (target) => target.id && ["USER", "TEAM", "SP"].includes(target.type),
    );
}

// The job is the actor's when their own name is on it, when it went to a team
// they belong to, or when it went to their own service provider. `reader` is a
// Firestore transaction when one is open, so the team read happens before any
// write; otherwise it is the database itself.
export async function actorIsAssignee({
  reader,
  db,
  trnData = {},
  actorUid = "",
  actorSpId = "",
}) {
  const targets = assignmentTargetsOf(trnData);

  if (targets.length === 0 || !actorUid) return false;

  if (
    targets.some((target) => target.type === "USER" && target.id === actorUid)
  ) {
    return true;
  }

  if (
    actorSpId &&
    targets.some((target) => target.type === "SP" && target.id === actorSpId)
  ) {
    return true;
  }

  const teamIds = targets
    .filter((target) => target.type === "TEAM")
    .map((target) => target.id);

  for (const teamId of teamIds) {
    const teamRef = db.collection("teams").doc(teamId);
    const teamSnap = reader ? await reader.get(teamRef) : await teamRef.get();
    const memberIds = Array.isArray(teamSnap.data()?.scope?.memberUserIds)
      ? teamSnap.data().scope.memberUserIds
      : [];

    if (memberIds.map((id) => String(id)).includes(actorUid)) return true;
  }

  return false;
}
