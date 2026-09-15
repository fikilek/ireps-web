import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createTeam, addTeamMember, removeTeamMember, deleteTeam } from "../teams/callables.js";

// Teams rules TM-R001: adding, removing and deleting write the membership history.
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host || "")) throw new Error("Firestore emulator unavailable: explicitly set a localhost FIRESTORE_EMULATOR_HOST; real projects are prohibited");
const projectId = "demo-ireps-sales-batch";
const app = initializeApp({ projectId });
const db = getFirestore(app);
const sp = { id: "MNC1", name: "MNC One" };
const as = (uid, data) => ({ auth: { uid, token: {} }, data });
const history = async () => (await db.collection("team_member_history").get()).docs.map(doc => doc.data()).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));

beforeEach(async () => {
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" }); assert.equal(response.ok, true);
  await Promise.all([
    db.doc("serviceProviders/MNC1").set({ ...sp, clients: [{ clientType: "LM", relationshipType: "MNC", id: "ZA5241", name: "Test LM" }] }),
    db.doc("users/MNG1").set({ profile: { displayName: "Manager One" }, employment: { role: "MNG", serviceProvider: sp } }),
    db.doc("users/FWR1").set({ profile: { displayName: "Worker One" }, employment: { role: "FWR", serviceProvider: sp } }),
  ]);
});
after(async () => { await deleteApp(app); });

test("each membership is a period that outlives removal and team deletion", async () => {
  const { teamId } = await createTeam.run(as("MNG1", { name: "Kaiser Team" }));
  assert.deepEqual(await history(), [], "a new team starts with no members");

  await addTeamMember.run(as("MNG1", { teamId, userUid: "FWR1" }));
  let periods = await history();
  assert.equal(periods.length, 1);
  assert.deepEqual([periods[0].teamId, periods[0].teamName, periods[0].mncServiceProviderId, periods[0].userUid, periods[0].userName, periods[0].joinedByUser, periods[0].leftAt, periods[0].source],
    [teamId, "Kaiser Team", "MNC1", "FWR1", "Worker One", "Manager One", null, "ADD_MEMBER"]);
  assert.equal(periods[0].id, `${teamId}__FWR1__${Date.parse(periods[0].joinedAt)}`);

  await assert.rejects(addTeamMember.run(as("MNG1", { teamId, userUid: "FWR1" })), { code: "already-exists" });
  assert.equal((await history()).length, 1, "a refused add writes no history");

  await removeTeamMember.run(as("MNG1", { teamId, userUid: "FWR1" }));
  periods = await history();
  assert.deepEqual([periods[0].leftReason, periods[0].leftByUser, typeof periods[0].leftAt], ["REMOVED", "Manager One", "string"]);

  await addTeamMember.run(as("MNG1", { teamId, userUid: "FWR1" }));
  assert.deepEqual((await history()).map(period => period.leftReason), ["REMOVED", null], "re-joining opens a new period");

  await deleteTeam.run(as("MNG1", { teamId }));
  assert.equal((await db.doc(`teams/${teamId}`).get()).exists, false);
  periods = await history();
  assert.deepEqual(periods.map(period => period.leftReason), ["REMOVED", "TEAM_DELETED"], "the history outlives the team");
  assert.ok(periods.every(period => period.leftAt && period.teamName === "Kaiser Team"));
});
