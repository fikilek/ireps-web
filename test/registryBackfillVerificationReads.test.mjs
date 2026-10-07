import test from "node:test";
import assert from "node:assert/strict";
import { readRegistryVerificationSnapshots } from "../functions/maintenance/registryBackfillVerificationReads.js";

test("verification reads every unique path across batches and tolerates response reordering", async () => {
  const calls = [];
  const db = {
    doc: path => ({ path }),
    getAll: async (...refs) => {
      calls.push(refs.map(ref => ref.path));
      return refs.map(ref => ({ ref, exists: ref.path !== "trns/0" })).reverse();
    },
  };
  const paths = Array.from({ length: 205 }, (_, i) => `trns/${i}`);
  const result = await readRegistryVerificationSnapshots(db, [...paths, ...paths.slice(0, 5)]);
  assert.deepEqual(calls.map(batch => batch.length), [100, 100, 5]);
  assert.equal(result.size, 205);
  for (const path of paths) assert.equal(result.get(path).ref.path, path);
  assert.equal(result.get("trns/0").exists, false);
});

test("empty verification makes no reads and incomplete responses fail closed", async () => {
  const db = { doc: path => ({ path }), getAll: async () => [] };
  assert.equal((await readRegistryVerificationSnapshots(db, [])).size, 0);
  await assert.rejects(readRegistryVerificationSnapshots(db, ["asts/one"]), /Verification read missing/);
});
