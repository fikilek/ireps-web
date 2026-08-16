import assert from "node:assert/strict";
import test from "node:test";

import { buildRoleUpdateFields } from "../users/helpers.js";

const NOW = "2026-08-16T05:40:00.000Z";

function build(overrides = {}) {
  return buildRoleUpdateFields({
    targetUserDoc: {},
    newRole: "spv",
    actorUid: "ACTOR_UID",
    actorName: "Role Manager",
    now: NOW,
    ...overrides,
  });
}

test("role update writes only standard iREPS update metadata", () => {
  assert.deepEqual(build(), {
    "employment.role": "SPV",
    "metadata.updatedAt": NOW,
    "metadata.updatedByUid": "ACTOR_UID",
    "metadata.updatedByUser": "Role Manager",
  });
});

test("legacy role mirrors remain compatible without role-specific metadata", () => {
  const fields = build({
    targetUserDoc: {
      role: "FWR",
      profile: { employment: { role: "FWR" } },
    },
    newRole: "MNG",
  });

  assert.equal(fields.role, "MNG");
  assert.equal(fields["profile.employment.role"], "MNG");
  assert.equal(fields["employment.role"], "MNG");
  assert.equal(fields["metadata.updatedAt"], NOW);
  assert.equal(fields["metadata.updatedByUid"], "ACTOR_UID");
  assert.equal(fields["metadata.updatedByUser"], "Role Manager");
  assert.equal(
    Object.keys(fields).some((key) => key.startsWith("metadata.roleUpdated")),
    false,
  );
});

test("role update metadata fallbacks stay inside the standard updated fields", () => {
  const fields = build({ actorUid: "", actorName: "" });

  assert.equal(fields["metadata.updatedByUid"], "NAv");
  assert.equal(fields["metadata.updatedByUser"], "NAv");
  assert.deepEqual(
    Object.keys(fields)
      .filter((key) => key.startsWith("metadata."))
      .sort(),
    [
      "metadata.updatedAt",
      "metadata.updatedByUid",
      "metadata.updatedByUser",
    ],
  );
});
