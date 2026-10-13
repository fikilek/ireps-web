// THE LIST ON THE SCREEN IS NOT A GUARD.
//
// Until 13 October 2026 `onManageLifecycleInstructionCallable` accepted any
// allocation target that was a non-empty USER, TEAM or SP. It never asked who
// the person was: not whether he was a field worker, not whether his company
// held a contract for the municipality the meter is in. The office page
// filtered its own dropdown, and `firestore.rules` is nine lines allowing any
// signed-in client through, so that dropdown was the entire mechanism.
//
// The owner found the visible half on TEST: an Endumeni meter offered Nki
// (Jolinkomo Meters, under Fouriot) and Lwazi (Onke Engineering, under 474
// Tower), neither of which holds Endumeni. The invisible half was worse - the
// server would have written such an allocation, notified the man and put the
// job on his phone.
//
// These tests pin the behaviour of the hierarchy functions and the fact that
// the callable asks them. The guard's own branch is read from the source,
// because what is being guarded is WHICH QUESTION the code asks before it
// writes, and a hand-made fixture that happens to be in the right municipality
// would pass either way.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  getServiceProvidersHoldingLm,
  isUserAllowedInLm,
  resolveServiceProviderMnc,
} from "../teams/helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, "..", p), "utf8").replaceAll("\r\n", "\n");

const ENDUMENI = "ZA5241";

const mnc = (id, name, ...lmPcodes) => ({
  id,
  name,
  clients: lmPcodes.map((lm) => ({
    clientType: "LM",
    relationshipType: "MNC",
    id: lm,
    name: lm,
  })),
});

const sub = (id, name, parentId, parentName = "a stale copy") => ({
  id,
  name,
  clients: [
    { clientType: "SP", relationshipType: "SUBC", id: parentId, name: parentName },
  ],
});

// TEST, as measured on 13 October 2026
// (ireps-investigations/provider-hierarchy-20261013/census.json).
const PROVIDERS = [
  mnc("RSTE", "RSTE", "ZA7423", "ZA2157", ENDUMENI),
  mnc("FOURIOT", "Fouriot", "ZA2157"),
  mnc("TOWER474", "474 Tower", "ZA2157"),
  sub("KATISO", "Katiso Molefi Meters", "RSTE", "RSTE"),
  sub("ELSA", "Elsa Meters", "RSTE", "RSTE"),
  sub("JOLINKOMO", "Jolinkomo Meters", "FOURIOT", "Fouriot"),
  // Its stored client name says "Onke Engineering" while the id is 474 Tower's.
  sub("ONKE", "Onke Engineering", "TOWER474", "Onke Engineering"),
  { id: "PATDIALE", name: "Pat Diale Engineering", clients: [] },
];

const fwr = (serviceProviderId) => ({
  employment: { role: "FWR", serviceProvider: { id: serviceProviderId } },
});

test("the main contractors holding a municipality are read from the LM clients", () => {
  assert.deepEqual(getServiceProvidersHoldingLm(ENDUMENI, PROVIDERS), ["RSTE"]);
  // Three hold ZA2157. Reading it as one would shut out two families.
  assert.deepEqual(getServiceProvidersHoldingLm("ZA2157", PROVIDERS).sort(), [
    "FOURIOT",
    "RSTE",
    "TOWER474",
  ]);
  assert.deepEqual(getServiceProvidersHoldingLm("ZA9999", PROVIDERS), []);
  assert.deepEqual(getServiceProvidersHoldingLm("", PROVIDERS), []);
});

test("a main contractor's own worker may work its municipality", () => {
  assert.equal(
    isUserAllowedInLm({ candidateUserDoc: fwr("RSTE"), lmPcode: ENDUMENI, allServiceProviders: PROVIDERS }),
    true,
  );
});

test("a subcontractor's worker may work the municipality his contractor holds", () => {
  assert.equal(
    isUserAllowedInLm({ candidateUserDoc: fwr("KATISO"), lmPcode: ENDUMENI, allServiceProviders: PROVIDERS }),
    true,
  );
});

test("another company's worker is refused - the fault the owner found", () => {
  for (const providerId of ["JOLINKOMO", "ONKE", "FOURIOT", "TOWER474"]) {
    assert.equal(
      isUserAllowedInLm({
        candidateUserDoc: fwr(providerId),
        lmPcode: ENDUMENI,
        allServiceProviders: PROVIDERS,
      }),
      false,
      `${providerId} holds no contract for Endumeni`,
    );
  }
});

test("the chain is followed by id, never by the stored name", () => {
  // Onke Engineering's SUBC client is named "Onke Engineering" and carries 474
  // Tower's id. Joining on the name would break the chain; joining on the id
  // holds it.
  assert.equal(resolveServiceProviderMnc("ONKE", PROVIDERS, new Set()).id, "TOWER474");
});

test("the chain is followed to any depth, not one hop", () => {
  const deep = [mnc("TOP", "Top", ENDUMENI), sub("MID", "Mid", "TOP"), sub("LOW", "Low", "MID")];

  assert.equal(
    isUserAllowedInLm({ candidateUserDoc: fwr("LOW"), lmPcode: ENDUMENI, allServiceProviders: deep }),
    true,
  );
});

test("a gap answers null, which is not a refusal", () => {
  // Three different gaps, one answer: unknown. A caller that read these as
  // `false` would refuse every allocation on a municipality nobody has been
  // assigned yet, and tell the office the worker is not allowed (`UI-R008`).
  assert.equal(
    isUserAllowedInLm({ candidateUserDoc: fwr("RSTE"), lmPcode: "ZA9999", allServiceProviders: PROVIDERS }),
    null,
    "no main contractor recorded for the municipality",
  );
  assert.equal(
    isUserAllowedInLm({ candidateUserDoc: { employment: { role: "FWR" } }, lmPcode: ENDUMENI, allServiceProviders: PROVIDERS }),
    null,
    "the person carries no provider",
  );
  assert.equal(
    isUserAllowedInLm({ candidateUserDoc: fwr("RSTE"), lmPcode: "", allServiceProviders: PROVIDERS }),
    null,
    "no municipality on the record",
  );
});

test("a provider belonging to nobody is refused, not crashed on", () => {
  // Pat Diale Engineering holds no municipality and has no parent.
  assert.equal(
    isUserAllowedInLm({ candidateUserDoc: fwr("PATDIALE"), lmPcode: ENDUMENI, allServiceProviders: PROVIDERS }),
    false,
  );
});

test("a provider missing from the collection is refused, not assumed", () => {
  assert.equal(
    isUserAllowedInLm({ candidateUserDoc: fwr("GHOST"), lmPcode: ENDUMENI, allServiceProviders: PROVIDERS }),
    false,
  );
});

test("a chain that loops is refused rather than followed forever", () => {
  const loop = [mnc("TOP", "Top", ENDUMENI), sub("A", "A", "B"), sub("B", "B", "A")];

  assert.equal(
    isUserAllowedInLm({ candidateUserDoc: fwr("A"), lmPcode: ENDUMENI, allServiceProviders: loop }),
    false,
  );
});

/* ------------------------------------------- the callable asks the question */

test("the allocate path checks the target before it writes", () => {
  const src = read("meterLifecycle/manageInstructionCallable.js");

  // To the closing brace at column 0, not the first inner one.
  const guard = src.match(/async function checkTargetsMayWork\([\s\S]*?\n\}\n/);
  assert.ok(guard, "checkTargetsMayWork exists");

  assert.ok(guard[0].includes("isUserAllowedInLm"), "it asks the shared hierarchy well");
  assert.ok(
    guard[0].includes("getServiceProvidersHoldingLm"),
    "it asks whether the municipality is held at all before refusing anybody",
  );
  assert.ok(
    guard[0].includes("TARGET_NOT_A_FIELD_WORKER"),
    "it refuses a supervisor or manager - the owner's decision of 10 October",
  );
  assert.ok(
    guard[0].includes("TARGET_OUTSIDE_MUNICIPALITY_CONTRACT"),
    "it refuses another company's worker",
  );
  assert.ok(
    guard[0].includes('allowed === false'),
    "it refuses only on a definite no, never on an unknown",
  );
  assert.ok(
    /target\.type === "USER"/.test(guard[0]),
    "only a person is checked; TEAM and SP belong to the batch lanes",
  );

  // And the allocate branch actually calls it, before the transaction writes.
  const called = src.indexOf("const mayWork = await checkTargetsMayWork(");
  const transaction = src.indexOf("await db.runTransaction(");

  assert.ok(called > 0, "the allocate branch calls the guard");
  assert.ok(called < transaction, "and it is answered before anything is written");
});

test("the guard does not keep its own copy of the hierarchy", () => {
  const src = read("meterLifecycle/manageInstructionCallable.js");
  const guard = src.match(/async function checkTargetsMayWork\([\s\S]*?\n\}\n/)[0];

  assert.ok(
    !/relationshipType|clientType|parentServiceProviderId/.test(guard),
    "the relationship is interpreted in functions/teams/helpers.js alone",
  );
});

/* --------------------------------------- what the adversarial review found */

test("the field-worker rule is NOT switched off by a missing municipality", () => {
  // The role check sat INSIDE the loop below two municipality gates that
  // return early. So a job carrying no municipality, or one in a municipality
  // iREPS records no contractor for, let a supervisor be given individual
  // work. The two rules are independent: who may do field work is DR-R001 4
  // and has nothing to do with which municipality the meter is in.
  const src = read("meterLifecycle/manageInstructionCallable.js");
  const guard = src.match(/async function checkTargetsMayWork\([\s\S]*?\n\}\n/)[0];

  const roleAt = guard.indexOf("TARGET_NOT_A_FIELD_WORKER");
  const municipalityGate = guard.indexOf("if (!municipalities.length) return { ok: true };");
  const holderGate = guard.indexOf("if (!anyHolder) return { ok: true };");

  assert.ok(roleAt > 0 && municipalityGate > 0 && holderGate > 0, "all three are present");
  assert.ok(roleAt < municipalityGate, "the role is asked before the municipality gate");
  assert.ok(roleAt < holderGate, "and before the holder gate");

  // The target-exists check must be on the same side of the gates, for the
  // same reason: a target who is not an iREPS user at all is refused whatever
  // the municipality says.
  const existsAt = guard.indexOf("TARGET_USER_NOT_FOUND");

  assert.ok(existsAt > 0 && existsAt < municipalityGate, "and so is the target-exists check");
});

test("each target's record is read once, not twice", () => {
  // Moving the role check out must not leave the municipality loop fetching
  // the same user document again.
  const src = read("meterLifecycle/manageInstructionCallable.js");
  const guard = src.match(/async function checkTargetsMayWork\([\s\S]*?\n\}\n/)[0];
  const reads = guard.match(/collection\("users"\)\.doc\(/g) || [];

  assert.equal(reads.length, 1, "one users read, reused through userDocs");
  assert.ok(guard.includes("userDocs.get(target.id)"));
});
