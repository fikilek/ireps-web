import test from "node:test";
import assert from "node:assert/strict";
import { buildMemberJoined, buildMemberLeft, memberHistoryId, openMemberPeriods, START_SOURCE, TEAM_MEMBER_HISTORY } from "../teams/member-history.js";
import { classifyTrn, isBatchTrn, summarizeFieldWork, teamOnDate } from "../teams/field-work-summary.js";
import { getFieldWorkSummary } from "../teams/fieldWorkSummaryCallable.js";

// Teams rules TM-R001 and Targeted Batch rules TB-R045 (1.3.26).
const period = (teamId, teamName, userUid, joinedAt, leftAt = null) => ({ teamId, teamName, userUid, joinedAt, leftAt });
const trn = (uid, createdAt, extra = {}) => ({ accessData: { trnType: "METER_DISCOVERY", access: { hasAccess: "yes" } }, metadata: { createdByUid: uid, createdByUser: uid === "W1" ? "Peter Peter" : "Zamo Ngubs", createdAt }, serviceProvider: { id: "RSTE", name: "RSTE" }, ...extra });

test("a membership period opens on add and closes on remove or team deletion", () => {
  const joined = buildMemberJoined({ teamId: "T1", teamName: "Kaiser Team", mncServiceProviderId: "MNC1", userUid: "W1", userName: "Worker", joinedAt: "2026-09-15T08:00:00.000Z", actorUid: "M1", actorName: "Manager" });
  assert.equal(joined.id, `T1__W1__${Date.parse("2026-09-15T08:00:00.000Z")}`);
  assert.deepEqual([joined.leftAt, joined.leftByUid, joined.leftReason, joined.source, joined.joinedByUser], [null, null, null, "ADD_MEMBER", "Manager"]);
  assert.deepEqual(buildMemberLeft({ leftAt: "2026-09-16T08:00:00.000Z", actorUid: "M1", actorName: "Manager", reason: "REMOVED" }), { leftAt: "2026-09-16T08:00:00.000Z", leftByUid: "M1", leftByUser: "Manager", leftReason: "REMOVED" });
  assert.throws(() => buildMemberLeft({ leftAt: "x", reason: "OTHER" }), /removed or the team is deleted/);
  assert.throws(() => memberHistoryId("T1", "W1", "not a date"));
  assert.equal(START_SOURCE, "START_2026_09_15"); assert.equal(TEAM_MEMBER_HISTORY, "team_member_history");
});

test("only open periods are returned for closing", async () => {
  const docs = [{ data: () => ({ teamId: "T1", userUid: "W1", leftAt: null }) }, { data: () => ({ teamId: "T1", userUid: "W1", leftAt: "2026-09-01T00:00:00.000Z" }) }];
  const filters = [];
  const query = { where(...args) { filters.push(args); return this; }, get: async () => ({ docs }) };
  const db = { collection: name => { assert.equal(name, "team_member_history"); return query; } };
  assert.equal((await openMemberPeriods(db, { teamId: "T1", userUid: "W1" })).length, 1);
  assert.deepEqual(filters, [["teamId", "==", "T1"], ["userUid", "==", "W1"]]);
});

test("batch work is left out; normal-path work is a transaction or No Access, never both", () => {
  assert.equal(isBatchTrn({ sourceModule: "SALES_TARGETED_BATCH" }), true);
  assert.equal(isBatchTrn({ targetedBatchContext: { tbId: "TGB_1" } }), true);
  assert.equal(isBatchTrn({ derived: { targetedBatch: { tbId: "TGB_1" } } }), true);
  assert.equal(isBatchTrn({ accessData: { trnType: "METER_DISCOVERY" } }), false);
  for (const trnType of ["METER_DISCOVERY", "METER_INSTALLATION", "METER_REMOVAL", "METER_DISCONNECTION", "METER_RECONNECTION", "METER_COMMISSIONING", "METER_READING", "METER_INSPECTION"]) {
    assert.equal(classifyTrn({ accessData: { trnType, access: { hasAccess: "yes" } } }), "TRANSACTION", trnType);
    assert.equal(classifyTrn({ accessData: { trnType, access: { hasAccess: "no" } } }), "NO_ACCESS", trnType);
  }
});

test("work is credited to the team on the date of the work; a move starts afresh in the new team", () => {
  const periods = [period("T1", "Kaiser Team", "W1", "2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"), period("T2", "Simo Team", "W1", "2026-09-01T00:00:00.000Z")];
  assert.equal(teamOnDate(periods, "W1", Date.parse("2026-08-20T10:00:00.000Z")).teamId, "T1");
  assert.equal(teamOnDate(periods, "W1", Date.parse("2026-09-01T00:00:00.000Z")).teamId, "T2", "the move date belongs to the new team");
  assert.equal(teamOnDate(periods, "W1", Date.parse("2026-07-01T00:00:00.000Z")), null, "before joining any team");
  assert.equal(teamOnDate(periods, "W1", null).teamId, "T2", "a record without a date uses the open period");
  const overlapping = [...periods, period("T3", "Peter Team", "W1", "2026-09-10T00:00:00.000Z")];
  assert.equal(teamOnDate(overlapping, "W1", Date.parse("2026-09-12T00:00:00.000Z")).teamId, "T3", "the most recently joined team");
  const summary = summarizeFieldWork({ periods, trns: [
    trn("W1", "2026-08-20T10:00:00.000Z"), trn("W1", "2026-09-05T10:00:00.000Z"),
    trn("W1", "2026-09-06T10:00:00.000Z", { accessData: { trnType: "METER_DISCOVERY", access: { hasAccess: "no" } } }),
    trn("W1", "2026-09-07T10:00:00.000Z", { accessData: { trnType: "METER_RECONNECTION", access: { hasAccess: "yes" } } }),
    trn("W1", "2026-09-08T10:00:00.000Z", { sourceModule: "SALES_TARGETED_BATCH", targetedBatchContext: { tbId: "TGB_1" } }),
    trn("M1", "2026-09-09T10:00:00.000Z", { accessData: { trnType: "METER_DISCONNECTION", access: { hasAccess: "yes" } } }),
  ] });
  assert.deepEqual(summary.totals, { trns: 6, batchTrns: 1, normalTrns: 5, transactions: 4, noAccess: 1 });
  const byKey = Object.fromEntries(summary.groups.map(group => [group.key, group]));
  assert.deepEqual([byKey["TEAM:T1"].transactions, byKey["TEAM:T1"].noAccess], [1, 0], "August work stays with the old team");
  assert.deepEqual([byKey["TEAM:T2"].transactions, byKey["TEAM:T2"].noAccess], [2, 1], "a discovery and a reconnection; the No Access visit is not a transaction");
  assert.deepEqual([byKey["NO_TEAM:RSTE"].name, byKey["NO_TEAM:RSTE"].transactions, byKey["NO_TEAM:RSTE"].workers], ["RSTE (no team)", 1, ["Zamo Ngubs"]]);
});

test("the totals Function is for management users of that LM only", async () => {
  const profile = { employment: { role: "MNG" }, access: { activeWorkbase: { id: "ZA5241" }, workbases: [{ id: "ZA5241" }] } };
  const collection = docs => ({ where() { return this; }, select() { return this; }, get: async () => ({ docs: docs.map(data => ({ data: () => data })) }) });
  const db = user => ({ doc: () => ({ get: async () => ({ exists: Boolean(user), data: () => user }) }),
    collection: name => name === "trns" ? collection([trn("W1", "2026-09-05T10:00:00.000Z")]) : collection([period("T1", "Kaiser Team", "W1", "2026-08-01T00:00:00.000Z")]) });
  await assert.rejects(getFieldWorkSummary({ db: db(profile), request: { data: { lmPcode: "ZA5241" } } }), { code: "unauthenticated" });
  await assert.rejects(getFieldWorkSummary({ db: db(profile), request: { auth: { uid: "U" }, data: { lmPcode: "bad" } } }), { code: "invalid-argument" });
  await assert.rejects(getFieldWorkSummary({ db: db({ ...profile, employment: { role: "FWR" } }), request: { auth: { uid: "U" }, data: { lmPcode: "ZA5241" } } }), { code: "permission-denied" });
  await assert.rejects(getFieldWorkSummary({ db: db(profile), request: { auth: { uid: "U" }, data: { lmPcode: "ZA5242" } } }), { code: "permission-denied" });
  const result = await getFieldWorkSummary({ db: db(profile), request: { auth: { uid: "U" }, data: { lmPcode: "ZA5241" } } });
  assert.equal(result.success, true); assert.equal(result.groups[0].key, "TEAM:T1"); assert.equal(result.totals.transactions, 1);
});
