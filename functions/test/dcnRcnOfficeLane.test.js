// DR-R001 1.3.0, the office channel's individual lane:
//   section 4 — a Manager and a supervisor issue work; one job goes to exactly
//   one field worker; only the worker it was sent to may report it.
//   section 5 — the job can be opened (IN_PROGRESS) and then submitted.
import test from "node:test";
import assert from "node:assert/strict";

import { validateIndividualLaneTargets } from "../meterLifecycle/instructionCallable.js";
import {
  actorIsAssignee,
  assignmentTargetsOf,
  readActorRole,
  readActorServiceProviderId,
} from "../meterLifecycle/assignee.js";

const user = (id, name = "Sthembiso Magubane") => ({ type: "USER", id, name });

// A database stub: only teams are read, and only through .get().
function dbWithTeam(teamId, memberUserIds) {
  return {
    collection() {
      return {
        doc(id) {
          return {
            async get() {
              return {
                exists: id === teamId,
                data: () =>
                  id === teamId ? { scope: { memberUserIds } } : undefined,
              };
            },
          };
        },
      };
    },
  };
}

test("an individual job goes to exactly one field worker", () => {
  assert.equal(validateIndividualLaneTargets({ targets: [user("uid1")] }).ok, true);
});

test("an individual job with no target is refused", () => {
  const result = validateIndividualLaneTargets({ targets: [] });

  assert.equal(result.ok, false);
  assert.equal(result.code, "INDIVIDUAL_LANE_ONE_TARGET");
});

test("an individual job cannot go to two workers", () => {
  const result = validateIndividualLaneTargets({
    targets: [user("uid1"), user("uid2", "Kaiser Sithole")],
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "INDIVIDUAL_LANE_ONE_TARGET");
});

test("an individual job cannot go to a team: that is the bulk lane", () => {
  const result = validateIndividualLaneTargets({
    targets: [{ type: "TEAM", id: "team1", name: "Lefu Metering" }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "INDIVIDUAL_LANE_USER_ONLY");
});

test("a service provider is not an individual target either", () => {
  const result = validateIndividualLaneTargets({
    targets: [{ type: "SP", id: "sp1", name: "Lefu Metering" }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "INDIVIDUAL_LANE_USER_ONLY");
});

test("the worker the job was sent to may report it", async () => {
  const assigned = await actorIsAssignee({
    db: dbWithTeam("team1", []),
    trnData: { assignment: { targets: [user("uid1")] } },
    actorUid: "uid1",
  });

  assert.equal(assigned, true);
});

test("another worker may not report it", async () => {
  const assigned = await actorIsAssignee({
    db: dbWithTeam("team1", []),
    trnData: { assignment: { targets: [user("uid1")] } },
    actorUid: "uid2",
  });

  assert.equal(assigned, false);
});

test("a member of the team the job went to may report it", async () => {
  const assigned = await actorIsAssignee({
    db: dbWithTeam("team1", ["uid7", "uid8"]),
    trnData: {
      assignment: {
        targets: [{ type: "TEAM", id: "team1", name: "Lefu Metering" }],
      },
    },
    actorUid: "uid8",
  });

  assert.equal(assigned, true);
});

test("somebody outside that team may not", async () => {
  const assigned = await actorIsAssignee({
    db: dbWithTeam("team1", ["uid7"]),
    trnData: {
      assignment: {
        targets: [{ type: "TEAM", id: "team1", name: "Lefu Metering" }],
      },
    },
    actorUid: "uid9",
  });

  assert.equal(assigned, false);
});

test("work sent to a service provider may be reported by its own people", async () => {
  const trnData = {
    assignment: { targets: [{ type: "SP", id: "sp1", name: "Lefu Metering" }] },
  };

  assert.equal(
    await actorIsAssignee({
      db: dbWithTeam("team1", []),
      trnData,
      actorUid: "uid1",
      actorSpId: "sp1",
    }),
    true,
  );

  assert.equal(
    await actorIsAssignee({
      db: dbWithTeam("team1", []),
      trnData,
      actorUid: "uid1",
      actorSpId: "sp2",
    }),
    false,
  );
});

test("a job with no target is nobody's", async () => {
  const assigned = await actorIsAssignee({
    db: dbWithTeam("team1", []),
    trnData: { assignment: { targets: [] } },
    actorUid: "uid1",
  });

  assert.equal(assigned, false);
});

test("targets are read only in the three shapes iREPS uses", () => {
  const targets = assignmentTargetsOf({
    assignment: {
      targets: [
        user("uid1"),
        { type: "team", id: "team1", name: "Lefu" },
        { type: "SP", id: "", name: "No id" },
        { type: "WARD", id: "ward1", name: "Not a target" },
      ],
    },
  });

  assert.deepEqual(targets, [
    { type: "USER", id: "uid1" },
    { type: "TEAM", id: "team1" },
  ]);
});

test("the role is read from the sign-in token first, then the profile", () => {
  assert.equal(readActorRole({ token: { role: "spv" }, profile: {} }), "SPV");
  assert.equal(
    readActorRole({ token: {}, profile: { employment: { role: "MNG" } } }),
    "MNG",
  );
  assert.equal(readActorRole({ token: {}, profile: {} }), "");
});

test("the service provider is read the same way", () => {
  assert.equal(
    readActorServiceProviderId({
      token: {},
      profile: { employment: { serviceProvider: { id: "sp1" } } },
    }),
    "sp1",
  );
  assert.equal(readActorServiceProviderId({ token: { spId: "sp9" } }), "sp9");
});
