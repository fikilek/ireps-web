// WHO BELONGS TO WHOM, and who may therefore be sent to a meter.
// `DR-R001` 4.
//
// WHAT THESE GUARD. Not the set arithmetic. They guard the two ways this fault
// came about and the two ways a fix for it goes wrong:
//
//   1. ONE HOP. Three places worked the hierarchy out and two of them read
//      `parentServiceProviderId` once, so a subcontractor's subcontractor was
//      lost. TEST has exactly that shape - Jolinkomo Meters under Fouriot -
//      and these tests use the real shape rather than an invented one.
//   2. ASKING THE WRONG PARTY. The first version of the ITO filter asked the
//      SIGNED-IN USER's provider instead of the meter's municipality. For the
//      owner's own account that answers "nobody": he is SPU at Smars, the
//      platform operator, which is not a service provider at all. A test below
//      pins that his account offers the full list, not an empty one.
//   3. REFUSING ON A GAP. Missing data must not read as "nobody is available".
//      Unknown and empty are different answers (`UI-R008`).
//   4. A NAME INSTEAD OF AN ID. TEST holds two providers whose SUBC client
//      carries 474 Tower's id under the name "Onke Engineering". Join on the
//      name and the chain breaks; join on the id and it holds. Pinned.
//
// The fixtures are the measured truth of 13 October 2026, recorded in
// `ireps-investigations/provider-hierarchy-20261013/census.json`.
import test from "node:test";
import assert from "node:assert/strict";

import {
  familyForMunicipality,
  familyOf,
  isMainContractor,
  mainContractorsHolding,
  mncPcodesOf,
  nameOf,
  parentIdOf,
  providerMayWorkMunicipality,
  resolveMainContractor,
} from "../src/components/serviceProviders/providerHierarchy.js";
import { buildWorkerChoices } from "../src/components/ito/itoWorkers.js";

const ENDUMENI = "ZA5241";

const mnc = (id, name, ...lmPcodes) => ({
  id,
  name,
  clients: lmPcodes.map((lm) => ({ clientType: "LM", relationshipType: "MNC", id: lm })),
});

const sub = (id, name, parentId, parentName = "whatever the copy says") => ({
  id,
  name,
  clients: [{ clientType: "SP", relationshipType: "SUBC", id: parentId, name: parentName }],
});

// TEST, as measured. Three main contractors hold ZA2157; only RSTE holds
// Endumeni. Onke Engineering and Lihle Engineering both sit under 474 Tower
// while their stored client name still says "Onke Engineering".
const TEST_PROVIDERS = [
  mnc("sLLgXeWF4vh30dh8tpNG", "RSTE", "ZA7423", "ZA2157", ENDUMENI),
  mnc("MxZi90rshvB9p7kzer9w", "Fouriot", "ZA2157"),
  mnc("yzx05ZQLciHw2daHB9w2", "474 Tower", "ZA2157"),
  sub("LjOe1cmgvkdejSSpGOed", "Katiso Molefi Meters", "sLLgXeWF4vh30dh8tpNG", "RSTE"),
  sub("RXzFourUOuI6KJWdNauS", "Cat Matlala Engineering", "sLLgXeWF4vh30dh8tpNG", "RSTE"),
  sub("VHEfKKUbOfDz2JZxGQw7", "Elsa Meters", "sLLgXeWF4vh30dh8tpNG", "RSTE"),
  sub("qezb7O09HrdyKcujsWNj", "Jolinkomo Meters", "MxZi90rshvB9p7kzer9w", "Fouriot"),
  sub("11KaRGJP0QdCXEkObJ5i", "Onke Engineering", "yzx05ZQLciHw2daHB9w2", "Onke Engineering"),
  sub("xRMytuoyh4eNIO433j2Q", "Lihle Engineering", "yzx05ZQLciHw2daHB9w2", "Onke Engineering"),
  { id: "4c86ZzA6dWxaxYiavhPg", name: "Pat Diale Engineering", clients: [] },
];

// LIVE, as measured: one provider, a main contractor, no subcontractors.
const LIVE_PROVIDERS = [mnc("n7aaMw7ZxIQWMofpR8JS", "RSTE", ENDUMENI)];

const worker = (name, serviceProviderId) => ({
  uid: `uid-${name}`,
  displayName: name,
  role: "FWR",
  serviceProviderId,
});

const TEST_FWRS = [
  worker("Magubane", "sLLgXeWF4vh30dh8tpNG"),
  worker("Peter", "sLLgXeWF4vh30dh8tpNG"),
  worker("Simo", "sLLgXeWF4vh30dh8tpNG"),
  worker("Masondo", "sLLgXeWF4vh30dh8tpNG"),
  worker("Mandy", "sLLgXeWF4vh30dh8tpNG"),
  worker("Sbonelo", "sLLgXeWF4vh30dh8tpNG"),
  worker("Siya", "LjOe1cmgvkdejSSpGOed"), // Katiso Molefi, a sub of RSTE
  worker("Nki", "qezb7O09HrdyKcujsWNj"), // Jolinkomo, under Fouriot
  worker("Lwazi", "11KaRGJP0QdCXEkObJ5i"), // Onke, under 474 Tower
];

const offered = (options) =>
  buildWorkerChoices(options).all.map((row) => row.name).sort();

/* ------------------------------------------------------------------ reading */

test("a main contractor is the provider holding municipalities", () => {
  const rste = TEST_PROVIDERS[0];

  assert.deepEqual(mncPcodesOf(rste), ["ZA7423", "ZA2157", ENDUMENI]);
  assert.equal(isMainContractor(rste), true);
  assert.equal(isMainContractor(TEST_PROVIDERS[3]), false);
  assert.equal(parentIdOf(rste), "");
});

test("the parent is read from the id, never from the stored name", () => {
  // Onke Engineering's SUBC client says the parent is named "Onke Engineering"
  // and gives 474 Tower's id. The id is the truth.
  const onke = TEST_PROVIDERS.find((p) => p.name === "Onke Engineering");

  assert.equal(parentIdOf(onke), "yzx05ZQLciHw2daHB9w2");
  assert.equal(
    resolveMainContractor(onke.id, TEST_PROVIDERS).name,
    "474 Tower",
    "the name must come from the provider the id names, not from the client's copy",
  );
});

test("`NAv` is a gap, not a provider id", () => {
  const orphan = { id: "x", name: "X", parentServiceProviderId: "NAv" };

  assert.equal(parentIdOf(orphan), "");
  assert.equal(
    resolveMainContractor("x", [orphan]).reason,
    "NO_PARENT_AND_HOLDS_NO_MUNICIPALITY",
  );
});

/* ------------------------------------------------------- walking the chain */

test("the chain is walked to any depth, not one hop", () => {
  const deep = [
    mnc("top", "Top", ENDUMENI),
    sub("mid", "Mid", "top"),
    sub("low", "Low", "mid"),
    sub("lower", "Lower", "low"),
  ];

  assert.equal(resolveMainContractor("lower", deep).id, "top");
  assert.deepEqual([...familyForMunicipality({ lmPcode: ENDUMENI, providers: deep })].sort(), [
    "low",
    "lower",
    "mid",
    "top",
  ]);
});

test("a chain that loops is refused rather than followed forever", () => {
  const loop = [sub("a", "A", "b"), sub("b", "B", "a")];

  assert.equal(resolveMainContractor("a", loop).reason, "CIRCULAR");
});

test("a provider missing from the collection is named as missing, not as having no contractor", () => {
  // Two different gaps. The owner's rule is that a gap is shown and becomes a
  // job to fix, so they must not collapse into one word.
  assert.equal(resolveMainContractor("ghost", TEST_PROVIDERS).reason, "PROVIDER_NOT_FOUND");
  assert.equal(
    resolveMainContractor("4c86ZzA6dWxaxYiavhPg", TEST_PROVIDERS).reason,
    "NO_PARENT_AND_HOLDS_NO_MUNICIPALITY",
  );
});

test("a municipality can have more than one main contractor", () => {
  // TEST records three for ZA2157. Reading that as a single value would
  // silently exclude two families of workers entitled to the work.
  assert.equal(mainContractorsHolding("ZA2157", TEST_PROVIDERS).size, 3);
  assert.deepEqual([...mainContractorsHolding(ENDUMENI, TEST_PROVIDERS)], [
    "sLLgXeWF4vh30dh8tpNG",
  ]);
});

test("a municipality nobody holds is unknown, not empty", () => {
  assert.equal(familyForMunicipality({ lmPcode: "ZA9999", providers: TEST_PROVIDERS }), null);
  assert.equal(
    providerMayWorkMunicipality({
      providerId: "sLLgXeWF4vh30dh8tpNG",
      lmPcode: "ZA9999",
      providers: TEST_PROVIDERS,
    }),
    null,
  );
});

test("familyOf with no main contractor is empty, which is a different answer from unknown", () => {
  assert.equal(familyOf([], TEST_PROVIDERS).size, 0);
});

/* ------------------------------------------- who is offered an Endumeni job */

test("TEST: an Endumeni meter offers RSTE's men and RSTE's subs' men, and nobody else", () => {
  assert.deepEqual(
    offered({ users: TEST_FWRS, lmPcode: ENDUMENI, serviceProviders: TEST_PROVIDERS }),
    ["Magubane", "Mandy", "Masondo", "Peter", "Sbonelo", "Simo", "Siya"],
    "Nki (Fouriot) and Lwazi (474 Tower) hold no contract for Endumeni",
  );
});

test("TEST: a ZA2157 meter offers all three families, because all three hold it", () => {
  assert.equal(
    offered({ users: TEST_FWRS, lmPcode: "ZA2157", serviceProviders: TEST_PROVIDERS }).length,
    9,
  );
});

test("LIVE: the main contractor has no subcontractors, and its own men are still offered", () => {
  // An early version of this filter seeded the allowed set from the signed-in
  // user's provider. On LIVE that list is one provider deep, and a stream that
  // returned subcontractors only returned NOTHING - so the filter had to work
  // from a main contractor that was not in the list it was given.
  const liveFwrs = ["BOOM MZOLO", "Mfundo Masondo", "Sfiso", "Sthembiso Magubane", "Thando Mgaga"]
    .map((name) => worker(name, "n7aaMw7ZxIQWMofpR8JS"));

  assert.equal(
    offered({ users: liveFwrs, lmPcode: ENDUMENI, serviceProviders: LIVE_PROVIDERS }).length,
    5,
  );
});

test("a worker is never dropped because iREPS does not know who holds the municipality", () => {
  // Hiding him would read as "he is not available", which is not what the data
  // says. The gap shows and becomes a job to fix (`UI-R008`).
  assert.equal(
    offered({ users: TEST_FWRS, lmPcode: null, serviceProviders: TEST_PROVIDERS }).length,
    9,
  );
  assert.equal(
    offered({ users: TEST_FWRS, lmPcode: ENDUMENI, serviceProviders: [] }).length,
    9,
    "no providers loaded yet is not the same as nobody being allowed",
  );
});

test("a worker whose provider is not recorded stays visible", () => {
  const rows = offered({
    users: [...TEST_FWRS, worker("Nobody's man", "")],
    lmPcode: ENDUMENI,
    serviceProviders: TEST_PROVIDERS,
  });

  assert.ok(rows.includes("Nobody's man"));
});

test("a subcontractor's worker is named as one, from the chain and not from the office", () => {
  const rows = buildWorkerChoices({
    users: TEST_FWRS,
    lmPcode: ENDUMENI,
    serviceProviders: TEST_PROVIDERS,
  }).all;

  assert.equal(rows.find((r) => r.name === "Siya").subcontractor, true);
  assert.equal(rows.find((r) => r.name === "Peter").subcontractor, false);
});

test("the office user's own provider decides nothing", () => {
  // The owner is SPU at Smars, which is not a service provider at all. The
  // question is about the meter, so his account must offer the full list.
  const asked = buildWorkerChoices({
    users: TEST_FWRS,
    lmPcode: ENDUMENI,
    serviceProviders: TEST_PROVIDERS,
  });

  assert.equal(asked.all.length, 7);
  assert.ok(
    !Object.keys(buildWorkerChoices({})).includes("mainContractorId"),
    "no actor-shaped input survives in the result",
  );
});

test("only field workers are offered, whatever the hierarchy says", () => {
  // `WORK_MAY_GO_TO` is the owner's decision of 10 October: supervisors and
  // managers do not go to the field. On LIVE, Peter, Simo and Kaiser are SPVs,
  // which is the whole reason they are not in the list - not a missing account.
  const rows = offered({
    users: [
      worker("Field man", "n7aaMw7ZxIQWMofpR8JS"),
      { ...worker("Supervisor", "n7aaMw7ZxIQWMofpR8JS"), role: "SPV" },
      { ...worker("Manager", "n7aaMw7ZxIQWMofpR8JS"), role: "MNG" },
    ],
    lmPcode: ENDUMENI,
    serviceProviders: LIVE_PROVIDERS,
  });

  assert.deepEqual(rows, ["Field man"]);
});

/* ------------------------------------------------ one well, not three copies */

test("the hierarchy is worked out in one place only", async () => {
  const { readFile } = await import("node:fs/promises");
  const files = [
    "src/pages/operations/OperationalTeamsPage.jsx",
    "src/pages/admin/FwrMonitoringPage.jsx",
    "src/components/ito/itoWorkers.js",
  ];

  for (const file of files) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");

    assert.ok(
      source.includes("serviceProviders/providerHierarchy"),
      `${file} must read the shared well`,
    );
    assert.ok(
      !/\.parentServiceProviderId\s*\)?\s*===/.test(source),
      `${file} must not compare parentServiceProviderId itself - that is the one-hop copy`,
    );
  }
});

test("the normalised provider carries the municipalities it holds", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../src/redux/serviceProvidersApi.js", import.meta.url),
    "utf8",
  );

  assert.ok(source.includes("mncPcodes"), "the stream must expose the MNC municipalities");
  assert.ok(
    !source.includes(".filter((serviceProvider) => serviceProvider.isSubcontractor)"),
    "the stream must not hide main contractors - no hierarchy survives that",
  );
});

test("nameOf reads the provider, and says NAv when there is no name", () => {
  assert.equal(nameOf({ name: "RSTE" }), "RSTE");
  assert.equal(nameOf({ profile: { tradingName: "RSTE" } }), "RSTE");
  assert.equal(nameOf({}), "NAv");
});

/* --------------------------------------- what the adversarial review found */

// Five faults, four of them introduced by this very change and found by an
// adversarial review before the owner saw them. Each test is the finding.

test("`NAv` on a person's record is a gap, not a company", async () => {
  // usersApi writes the literal word when employment.serviceProvider.id is
  // absent. A bare String().trim() keeps it as a truthy id, so it is in no
  // main contractor's set and the row was labelled "Subcontractor" - the
  // office told which company a man belongs to on the strength of nothing.
  const { readId } = await import("../src/components/serviceProviders/providerHierarchy.js");

  assert.equal(readId("NAv"), "");
  assert.equal(readId("  NAv  "), "");
  assert.equal(readId(" RSTE "), "RSTE");

  const rows = buildWorkerChoices({
    users: [
      { uid: "a", displayName: "Peter", role: "FWR", serviceProviderId: "sLLgXeWF4vh30dh8tpNG" },
      { uid: "b", displayName: "Siya", role: "FWR", serviceProviderId: "LjOe1cmgvkdejSSpGOed" },
      // exactly what the stream emits for a person with no company recorded
      { uid: "c", displayName: "Nobody's man", role: "FWR", serviceProviderId: "NAv" },
    ],
    lmPcode: ENDUMENI,
    serviceProviders: TEST_PROVIDERS,
  }).all;

  const flag = Object.fromEntries(rows.map((r) => [r.name, r.subcontractor]));

  assert.equal(flag["Peter"], false, "the main contractor's own man");
  assert.equal(flag["Siya"], true, "a subcontractor's man");
  assert.equal(flag["Nobody's man"], false, "a gap is never reported as an employer");
  assert.ok(rows.some((r) => r.name === "Nobody's man"), "and he is still offered");
});

test("a provider with no parent is never read as having one", () => {
  // serviceProvidersApi writes "NAv" into parentServiceProviderId.
  const asTheStreamEmitsIt = [
    { id: "RSTE", name: "RSTE", parentServiceProviderId: "NAv",
      clients: [{ clientType: "LM", relationshipType: "MNC", id: ENDUMENI }] },
    { id: "SUB", name: "Sub", parentServiceProviderId: "RSTE", clients: [] },
  ];

  assert.equal(parentIdOf(asTheStreamEmitsIt[0]), "");
  assert.equal(resolveMainContractor("SUB", asTheStreamEmitsIt).id, "RSTE");
});

test("familyOf admits a provider whose chain PASSES a root, not only one that ends at it", () => {
  // FwrMonitoringPage passes the VIEWER'S OWN provider. For a manager at a
  // subcontractor his children's chains run past him to the main contractor
  // above, so asking for the TOP of the chain returned an empty family and he
  // lost sight of his own people - worse than the one-hop code it replaced.
  const graph = [
    mnc("TOP", "Top", ENDUMENI),
    sub("MID", "Mid", "TOP"),
    sub("LOW", "Low", "MID"),
    sub("LOWER", "Lower", "LOW"),
    mnc("OTHER", "Other", "ZA9999"),
    sub("OTHERSUB", "Other sub", "OTHER"),
  ];

  // a manager at MID sees MID and everything beneath it, and nothing else
  assert.deepEqual([...familyOf(["MID"], graph)].sort(), ["LOW", "LOWER", "MID"]);

  // a main contractor still sees its whole tree
  assert.deepEqual([...familyOf(["TOP"], graph)].sort(), ["LOW", "LOWER", "MID", "TOP"]);

  // and nobody else's
  assert.ok(!familyOf(["MID"], graph).has("OTHERSUB"));

  // the municipality's question is unchanged by the widening, because its
  // roots ARE main contractors
  assert.deepEqual(
    [...familyForMunicipality({ lmPcode: ENDUMENI, providers: graph })].sort(),
    ["LOW", "LOWER", "MID", "TOP"],
  );
});

test("a loop in the chain does not hang familyOf", () => {
  const loop = [mnc("TOP", "Top", ENDUMENI), sub("A", "A", "B"), sub("B", "B", "A")];

  assert.equal(familyOf(["TOP"], loop).size, 1);
});

test("the SUBC label is read from the provider, not from being in the list", async () => {
  // The list held subcontractors only, so being in it meant being one. Since
  // the stream returns every active provider, that read labelled the MAIN
  // CONTRACTOR'S OWN STAFF [SUBC].
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(
    new URL("../src/pages/operations/OperationalTeamsPage.jsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    page,
    /serviceProviders\.some\(\s*\(item\) => item\.id === group\.serviceProviderId,?\s*\)\s*\?\s*"SUBC"/,
    "being in the list is not what makes a provider a subcontractor",
  );
  assert.match(page, /\?\.isSubcontractor\s*\n?\s*\?\s*"SUBC"/);
});
