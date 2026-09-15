// Teams rules TM-R001: team membership periods (team_member_history). A period opens when a
// member is added and closes when they are removed or the team is deleted. Never deleted.
export const TEAM_MEMBER_HISTORY = "team_member_history";
export const START_SOURCE = "START_2026_09_15";
export const START_ACTOR = Object.freeze({ uid: "SYSTEM", name: "Team history start 2026-09-15" });

const text = value => String(value ?? "").trim();

export function memberHistoryId(teamId, userUid, joinedAt) {
  const millis = Date.parse(joinedAt);
  if (!text(teamId) || !text(userUid) || !Number.isFinite(millis)) throw new Error("A team, a member and a valid join date are required");
  return `${text(teamId)}__${text(userUid)}__${millis}`;
}

export function buildMemberJoined({ teamId, teamName, mncServiceProviderId, userUid, userName, joinedAt, actorUid, actorName, source = "ADD_MEMBER" }) {
  const id = memberHistoryId(teamId, userUid, joinedAt);
  return {
    id, teamId: text(teamId), teamName: text(teamName) || "NAv", mncServiceProviderId: text(mncServiceProviderId) || "NAv",
    userUid: text(userUid), userName: text(userName) || text(userUid), joinedAt, joinedByUid: text(actorUid) || "SYSTEM", joinedByUser: text(actorName) || "SYSTEM",
    leftAt: null, leftByUid: null, leftByUser: null, leftReason: null, source,
  };
}

export function buildMemberLeft({ leftAt, actorUid, actorName, reason }) {
  if (!["REMOVED", "TEAM_DELETED"].includes(reason)) throw new Error("A period ends only when the member is removed or the team is deleted");
  return { leftAt, leftByUid: text(actorUid) || "SYSTEM", leftByUser: text(actorName) || "SYSTEM", leftReason: reason };
}

// The open periods of a team, or of one member in a team.
export async function openMemberPeriods(db, { teamId, userUid = "" }) {
  let query = db.collection(TEAM_MEMBER_HISTORY).where("teamId", "==", text(teamId));
  if (text(userUid)) query = query.where("userUid", "==", text(userUid));
  const snapshot = await query.get();
  return snapshot.docs.filter(doc => doc.data()?.leftAt === null || doc.data()?.leftAt === undefined);
}
