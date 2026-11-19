import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMemberLookups,
  formatIssuedToText,
  formatTargetLabel,
  resolveTargetMembers,
} from "./trnIssuedTo.js";

test("formatTargetLabel keeps USER plain and prefixes TEAM / SP", () => {
  assert.equal(formatTargetLabel({ type: "USER", id: "u1", name: "Peter Peter" }), "Peter Peter");
  assert.equal(formatTargetLabel({ type: "TEAM", id: "t1", name: "Cat Matlala Meters 24" }), "TEAM: Cat Matlala Meters 24");
  assert.equal(formatTargetLabel({ type: "SP", id: "sp1", name: "Elsa Meters" }), "SP: Elsa Meters");
});

test("formatIssuedToText returns NAv when empty and joins multiple targets", () => {
  assert.equal(formatIssuedToText([]), "NAv");
  assert.equal(
    formatIssuedToText([
      { type: "USER", id: "u1", name: "Peter Peter" },
      { type: "TEAM", id: "t1", name: "Alpha Team" },
    ]),
    "Peter Peter, TEAM: Alpha Team",
  );
});

test("resolveTargetMembers resolves TEAM and SP members sorted by name", () => {
  const lookups = buildMemberLookups({
    users: [
      { id: "u2", displayName: "Zanele M", role: "FWR", serviceProviderId: "sp1" },
      { id: "u1", displayName: "Bongani K", role: "SPV", serviceProviderId: "sp1" },
      { id: "u3", displayName: "Thabo N", role: "FWR", serviceProviderId: "sp2" },
    ],
    teams: [{ id: "t1", name: "Alpha Team", memberUserIds: ["u2", "u1"] }],
  });

  const teamMembers = resolveTargetMembers({
    target: { type: "TEAM", id: "t1", name: "Alpha Team" },
    ...lookups,
  });
  assert.deepEqual(
    teamMembers.map((m) => m.name),
    ["Bongani K", "Zanele M"],
  );

  const spMembers = resolveTargetMembers({
    target: { type: "SP", id: "sp1", name: "Elsa Meters" },
    ...lookups,
  });
  assert.deepEqual(
    spMembers.map((m) => m.name),
    ["Bongani K", "Zanele M"],
  );
});
