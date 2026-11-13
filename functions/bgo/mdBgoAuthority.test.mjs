import test from "node:test";
import assert from "node:assert/strict";
import { resolveMdBgoCreateAuthority } from "./helpers.js";

const profile = { employment: { role: "SPV", serviceProvider: { id: "RSTE" } } };
const provider = { status: "ACTIVE", clients: [
  { id: "ZA7423", name: "Lesedi", clientType: "LM", relationshipType: "MNC" },
  { id: "ZA5241", name: "Endumeni", clientType: "LM", relationshipType: "MNC" },
] };
async function check({ user = profile, sp = provider, token = { role: "SPV" }, data = { scope: { lmPcode: "ZA5241" } } } = {}) {
  const reads = [];
  const docs = { "users/mandy": user, "serviceProviders/RSTE": sp };
  const db = { doc(path) { reads.push(path); return { async get() {
    return { exists: Boolean(docs[path]), data: () => docs[path] };
  } }; } };
  const result = await resolveMdBgoCreateAuthority({ db, request: { auth: { uid: "mandy", token }, data } });
  return { ...result, reads };
}

test("Mandy-shaped supervisor needs no denormalized MNC claims", async () => {
  const result = await check();
  assert.equal(result.ok, true);
  assert.equal(result.relationshipType, "MNC");
  assert.deepEqual(result.reads, ["users/mandy", "serviceProviders/RSTE"]);
});
for (const [label, options] of [
  ["foreign municipality", { data: { scope: { lmPcode: "FOREIGN" } } }],
  ["missing municipality", { data: {} }],
  ["missing provider", { sp: null }],
  ["disabled provider", { sp: { ...provider, status: "DISABLED" } }],
  ["subcontractor", { sp: { ...provider, clients: [...provider.clients, { id: "PARENT", clientType: "SP", relationshipType: "SUBC" }] } }],
  ["provider without MNC client", { sp: { ...provider, clients: [] } }],
  ["wrong client relationship", { sp: { ...provider, clients: [{ id: "ZA5241", name: "Endumeni", clientType: "LM", relationshipType: "SUBC" }] } }],
  ["FWR", { token: { role: "FWR", isMnc: true } }],
  ["forged MNC flags", { token: { role: "SPV", relationshipType: "MNC" }, sp: { ...provider, clients: [] } }],
  ["missing provider ID", { user: { employment: { role: "SPV" } } }],
]) test(`denies ${label}`, async () => assert.equal((await check(options)).ok, false));
test("MNG behavior remains unchanged", async () => {
  const result = await check({ token: { role: "MNG" }, sp: null, data: {} });
  assert.equal(result.ok, true);
  assert.deepEqual(result.reads, ["users/mandy"]);
});
test("existing flat municipality payload remains supported", async () => {
  assert.equal((await check({ data: { lmPcode: "ZA5241" } })).ok, true);
});
