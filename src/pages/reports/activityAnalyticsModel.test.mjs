import test from "node:test";
import assert from "node:assert/strict";

import {
  buildActivityAnalytics,
  buildDashboardActivityModel,
  filterDashboardUserRows,
} from "./activityAnalyticsModel.js";

const USERS = [
  {
    uid: "u1",
    serviceProviderId: "sp1",
    serviceProviderName: "Embedded One",
  },
  {
    uid: "u2",
    serviceProviderId: "sp2",
    serviceProviderName: "Embedded Two",
  },
  {
    uid: "u3",
    serviceProviderId: "sp1",
    serviceProviderName: "Embedded One",
  },
];

const SERVICE_PROVIDERS = [
  { id: "sp1", name: "Provider One" },
  { id: "sp2", name: "Provider Two" },
];

const TEAMS = [
  {
    id: "team-a",
    name: "Alpha Team",
    memberUserIds: ["u1", "u3"],
  },
  {
    id: "team-b",
    name: "Beta Team",
    memberUserIds: ["u1"],
  },
  {
    id: "team-c",
    name: "Zero Team",
    memberUserIds: [],
  },
];

function trn({
  id,
  type = "METER_DISCOVERY",
  hasAccess = "YES",
  userUid = "u1",
  userName = "User One",
  createdAt = "2026-08-20T08:00:00.000Z",
  updatedAt = "2026-08-20T09:00:00.000Z",
}) {
  return {
    trnId: id,
    trnType: type,
    hasAccess,
    createdByUid: userUid,
    createdByUser: userName,
    createdAt,
    lastUpdatedAt: updatedAt,
  };
}

test("preserves current Users classification and enrichment semantics", () => {
  const result = buildActivityAnalytics({
    registryTrns: [
      trn({ id: "d1", userUid: "u1", userName: "Alice" }),
      trn({
        id: "n1",
        type: "METER_DISCOVERY",
        hasAccess: "NO",
        userUid: "u1",
        userName: "Alice",
      }),
      trn({ id: "i1", type: "METER_INSPECTION", userUid: "u2", userName: "Bob" }),
    ],
    users: USERS,
    teams: TEAMS,
    serviceProviders: SERVICE_PROVIDERS,
    dateFilter: { preset: "ALL_TIME" },
  });

  const alice = result.userRows.find((row) => row.userUid === "u1");
  const bob = result.userRows.find((row) => row.userUid === "u2");

  assert.equal(alice.meterDiscoveryTrns, 1);
  assert.equal(alice.noAccessTrns, 1);
  assert.equal(alice.totalTrns, 2);
  assert.equal(alice.serviceProviderName, "Provider One");
  assert.deepEqual(alice.teamNames, ["Alpha Team", "Beta Team"]);
  assert.equal(alice.teamName, "Alpha Team, Beta Team");
  assert.equal(alice.activityTeamName, "Multiple");
  assert.equal(alice.teamAttributionStatus, "MULTIPLE");

  assert.equal(bob.totalTrns, 1);
  assert.equal(bob.serviceProviderName, "Provider Two");
  assert.equal(bob.activityTeamName, "Unassigned");
});

test("seeds configured Teams and balances Unassigned and Multiple exactly once", () => {
  const result = buildActivityAnalytics({
    registryTrns: [
      trn({ id: "m1", userUid: "u1", userName: "Alice" }),
      trn({ id: "u1", type: "METER_INSPECTION", userUid: "u2", userName: "Bob" }),
      trn({
        id: "a1",
        type: "METER_RECONNECTION",
        userUid: "u3",
        userName: "Carol",
        updatedAt: "2026-08-21T11:30:00.000Z",
      }),
    ],
    users: USERS,
    teams: TEAMS,
    serviceProviders: SERVICE_PROVIDERS,
    dateFilter: { preset: "ALL_TIME" },
  });

  const alpha = result.teamRows.find((row) => row.teamId === "team-a");
  const zero = result.teamRows.find((row) => row.teamId === "team-c");
  const multiple = result.teamRows.find((row) => row.teamName === "Multiple");
  const unassigned = result.teamRows.find((row) => row.teamName === "Unassigned");

  assert.equal(alpha.memberCount, 2);
  assert.deepEqual(alpha.serviceProviderNames, ["Provider One"]);
  assert.equal(alpha.meterReconnectionTrns, 1);
  assert.equal(alpha.lastUpdatedAt, "2026-08-21T11:30:00.000Z");

  assert.equal(zero.memberCount, 0);
  assert.equal(zero.totalTrns, 0);

  assert.equal(multiple.memberCount, 1);
  assert.equal(multiple.totalTrns, 1);
  assert.deepEqual(multiple.serviceProviderNames, ["Provider One"]);

  assert.equal(unassigned.memberCount, 1);
  assert.equal(unassigned.totalTrns, 1);
  assert.deepEqual(unassigned.serviceProviderNames, ["Provider Two"]);

  assert.equal(result.integrity.reconciliation.matches, true);
  assert.equal(result.integrity.reconciliation.userTotalTrns, 3);
  assert.equal(result.integrity.reconciliation.teamTotalTrns, 3);
});

test("keeps missing creator and unclassified TRNs outside attributable reconciliation", () => {
  const result = buildActivityAnalytics({
    registryTrns: [
      trn({ id: "ok", userUid: "u3", userName: "Carol" }),
      trn({ id: "missing", userUid: "NAv", userName: "Unknown" }),
      trn({ id: "other", type: "SOMETHING_ELSE", userUid: "u3", userName: "Carol" }),
    ],
    users: USERS,
    teams: TEAMS,
    serviceProviders: SERVICE_PROVIDERS,
    dateFilter: { preset: "ALL_TIME" },
  });

  assert.equal(result.integrity.attributableTotalTrns, 1);
  assert.equal(result.integrity.classifiedTotalTrns, 2);
  assert.equal(result.integrity.missingCreatedByUid, 1);
  assert.equal(result.integrity.unclassifiedTrns, 1);
  assert.equal(result.integrity.reconciliation.matches, true);
});

test("applies Created At filtering before aggregation", () => {
  const result = buildActivityAnalytics({
    registryTrns: [
      trn({ id: "today", userUid: "u3", createdAt: "2026-08-22T08:00:00.000Z" }),
      trn({ id: "old", userUid: "u3", createdAt: "2026-08-01T08:00:00.000Z" }),
      trn({ id: "missing-date", userUid: "u3", createdAt: null }),
    ],
    users: USERS,
    teams: TEAMS,
    serviceProviders: SERVICE_PROVIDERS,
    dateFilter: { preset: "TODAY" },
    now: new Date("2026-08-22T12:00:00.000Z"),
  });

  assert.equal(result.userRows[0].totalTrns, 1);
  assert.equal(result.integrity.missingCreatedAt, 1);
});

test("Dashboard uses the same user rows and excludes synthetic rows from Top Team", () => {
  const analytics = buildActivityAnalytics({
    registryTrns: [
      trn({ id: "m1", userUid: "u1", userName: "Alice" }),
      trn({ id: "m2", userUid: "u1", userName: "Alice", type: "METER_INSPECTION" }),
      trn({ id: "a1", userUid: "u3", userName: "Carol" }),
    ],
    users: USERS,
    teams: TEAMS,
    serviceProviders: SERVICE_PROVIDERS,
    dateFilter: { preset: "ALL_TIME" },
  });

  const filtered = filterDashboardUserRows(analytics.userRows, {});
  const dashboard = buildDashboardActivityModel(filtered, [
    { key: "meterDiscoveryTrns", label: "Discovery" },
    { key: "meterInspectionTrns", label: "Inspection" },
  ]);

  assert.equal(dashboard.totalActivity, 3);
  assert.equal(dashboard.topUser.userName, "Alice");
  assert.equal(dashboard.topTeam.name, "Alpha Team");
  assert.equal(dashboard.teamCount, 1);
  assert.equal(dashboard.latestRow.lastUpdatedAt, "2026-08-20T09:00:00.000Z");
});

test("configured Team Service Providers are derived from all current members", () => {
  const result = buildActivityAnalytics({
    registryTrns: [],
    users: [
      { uid: "m1", serviceProviderId: "sp1", serviceProviderName: "Embedded One" },
      { uid: "m2", serviceProviderId: "sp2", serviceProviderName: "Embedded Two" },
    ],
    teams: [
      { id: "mixed", name: "Mixed Team", memberUserIds: ["m1", "m2"] },
    ],
    serviceProviders: SERVICE_PROVIDERS,
    dateFilter: { preset: "ALL_TIME" },
  });

  const mixed = result.teamRows.find((row) => row.teamId === "mixed");
  assert.equal(mixed.memberCount, 2);
  assert.deepEqual(mixed.serviceProviderNames, ["Provider One", "Provider Two"]);
  assert.equal(mixed.serviceProviderName, "Provider One, Provider Two");
});
