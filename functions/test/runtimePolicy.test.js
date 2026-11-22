import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const expected = read("./fixtures/runtimePolicy.expected.json");
const baseline = read("./fixtures/runtimePolicy.baseline.json");
const env = { ...process.env,
  GCLOUD_PROJECT: "demo-ireps-priority4",
  GOOGLE_CLOUD_PROJECT: "demo-ireps-priority4",
  FIREBASE_CONFIG: JSON.stringify({ projectId: "demo-ireps-priority4", storageBucket: "demo-ireps-priority4.appspot.com" }),
};
for (const key of ["GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_TOKEN", "FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"]) delete env[key];
const result = spawnSync(process.execPath, [fileURLToPath(new URL("./support/runtimeDiscovery.cjs", import.meta.url))], {
  env, encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024,
});
assert.equal(result.status, 0, result.stderr || result.error?.message);
const discovered = JSON.parse(result.stdout);
const { stack } = discovered;
const memoryMb = { "256MiB": 256, "512MiB": 512, "1GiB": 1024 };
const runtimeFields = new Set(["region", "availableMemoryMb", "cpu", "timeoutSeconds", "concurrency", "minInstances", "maxInstances"]);
const withoutRuntime = value => ({ ...value, endpoints: Object.fromEntries(Object.entries(value.endpoints).map(([name, endpoint]) => [name,
  Object.fromEntries(Object.entries(endpoint).filter(([field]) => !runtimeFields.has(field))),
])) });

test("real SDK discovery preserves exactly the approved 126 exports and excludes retained legacy", () => {
  assert.equal(Object.keys(expected).length, 126);
  assert.deepEqual(Object.keys(stack.endpoints).sort(), Object.keys(expected).sort());
  assert.equal(stack.endpoints.recordTargetedBatchNoAccessCallable, undefined);
  assert.deepEqual(discovered.deniedEffectAttempts, []);
});

test("all effective endpoint runtime descriptors match the owner-approved contract", () => {
  for (const [name, options] of Object.entries(expected)) {
    const actual = stack.endpoints[name];
    assert.equal(actual.platform, "gcfv2", name);
    assert.deepEqual(actual.region, [options.region], name + " region");
    for (const [field, value] of Object.entries({ availableMemoryMb: memoryMb[options.memory], cpu: options.cpu,
      timeoutSeconds: options.timeoutSeconds, concurrency: options.concurrency,
      minInstances: options.minInstances, maxInstances: options.maxInstances })) {
      assert.equal(actual[field], value, name + " " + field);
    }
  }
});

test("trigger, security, secret, schedule and other non-runtime descriptors remain unchanged", () => {
  assert.deepEqual(withoutRuntime(stack), withoutRuntime(baseline));
});

test("Batch Stats keeps its bounded high-memory single-request profile", () => {
  const actual = stack.endpoints.getBatchStatsCallable;
  assert.equal(actual.availableMemoryMb, 1024);
  assert.equal(actual.timeoutSeconds, 300);
  assert.equal(actual.concurrency, 1);
  assert.equal(actual.maxInstances, 5);
  assert.equal(Object.values(stack.endpoints).filter(e => e.maxInstances === 20).length, 125);
});

test("Node runtime remains the approved Node.js 22 engine", () => {
  assert.equal(read("../package.json").engines.node, "22");
});
