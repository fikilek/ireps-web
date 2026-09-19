import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";

// Web Data Copy rules WD-R001: one saved copy shared by all tabs, deleted at sign-out.
// While another tab still has the copy open, the browser's delete waits (it never
// fails), so the fake delete either finishes or never settles.
async function fixture({ deleteFinishes = true } = {}) {
  const state = { calls: [], errors: [], timers: [], settings: null, authCallback: null };
  const context = createContext({
    console: { log() {}, error: (...parts) => state.errors.push(parts) },
    setTimeout: (run, ms) => { state.timers.push({ run, ms, cleared: false }); return state.timers.length; },
    clearTimeout: id => { if (state.timers[id - 1]) state.timers[id - 1].cleared = true; },
    window: { location: { reload: () => state.calls.push("reload") } },
  });
  const mocks = {
    "firebase/app": { initializeApp: config => ({ config }) },
    "firebase/auth": { getAuth: () => ({}), onAuthStateChanged: (_auth, callback) => { state.authCallback = callback; } },
    "firebase/firestore": {
      initializeFirestore: (_app, settings) => { state.settings = settings; return { name: "db" }; },
      persistentLocalCache: options => ({ kind: "persistent", ...options }),
      persistentMultipleTabManager: () => ({ kind: "multi-tab" }),
      terminate: async () => { state.calls.push("terminate"); },
      clearIndexedDbPersistence: () => {
        state.calls.push("clear");
        return deleteFinishes ? Promise.resolve() : new Promise(() => {});
      },
    },
    "firebase/functions": { getFunctions: () => ({}) },
    "firebase/storage": { getStorage: () => ({}) },
  };
  const env = { MODE: "test", VITE_FIREBASE_API_KEY: "k", VITE_FIREBASE_AUTH_DOMAIN: "d", VITE_FIREBASE_PROJECT_ID: "p", VITE_FIREBASE_STORAGE_BUCKET: "b", VITE_FIREBASE_MESSAGING_SENDER_ID: "m", VITE_FIREBASE_APP_ID: "a" };
  const module = new SourceTextModule(await readFile(new URL("./index.js", import.meta.url), "utf8"), {
    context,
    initializeImportMeta: meta => { meta.env = env; },
  });
  await module.link(name => {
    assert.ok(mocks[name], `Unexpected dependency ${name}`);
    const exports = mocks[name];
    return new SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  return { api: module.namespace, state };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test("one saved copy, shared by all tabs, big enough for the Sales", async () => {
  const { api, state } = await fixture();
  assert.equal(api.SAVED_COPY_MAX_BYTES, 200 * 1024 * 1024);
  assert.equal(state.settings.localCache.kind, "persistent");
  assert.equal(state.settings.localCache.tabManager.kind, "multi-tab");
  assert.equal(state.settings.localCache.cacheSizeBytes, api.SAVED_COPY_MAX_BYTES);
});

test("opening the sign-in page while signed out deletes nothing", async () => {
  const { state } = await fixture();
  state.authCallback(null);
  await settle();
  assert.deepEqual(state.calls, []);
});

test("signing out deletes the saved copy, then returns to the sign-in page", async () => {
  const { api, state } = await fixture();
  state.authCallback({ uid: "A" });
  state.authCallback(null);
  await settle();
  assert.deepEqual(state.calls, ["terminate", "clear", "reload"]);
  assert.equal(api.SAVED_COPY_DELETE_LIMIT_MS, 10_000);
  assert.ok(state.timers.every(timer => timer.cleared), "the 10-second limit is cleared once the copy is deleted");
  assert.equal(state.errors.length, 0);
  state.authCallback(null);
  await settle();
  assert.equal(state.calls.length, 3, "a second signed-out event does nothing");
});

test("while another tab still holds the copy, the tab goes to sign-in after 10 seconds", async () => {
  const { state } = await fixture({ deleteFinishes: false });
  state.authCallback({ uid: "A" });
  state.authCallback(null);
  await settle();
  assert.deepEqual(state.calls, ["terminate", "clear"], "waiting for the other tab");
  const limit = state.timers.find(timer => timer.ms === 10_000 && !timer.cleared);
  assert.ok(limit, "a 10-second limit is running");
  limit.run();
  await settle();
  assert.deepEqual(state.calls, ["terminate", "clear", "reload"]);
  assert.equal(state.errors.length, 1, "the failure is logged");
});

test("every first-load reader shows only the server's answer", async () => {
  for (const file of ["teamsApi", "usersApi", "serviceProvidersApi", "registryWardsApi", "registryMetersApi", "trnsApi"]) {
    const source = await readFile(new URL(`../redux/${file}.js`, import.meta.url), "utf8");
    assert.match(source, /const streamUnsubscribe = onSnapshot\(\s*\w+,\s*(?:\/\/[^\n]*\n\s*)*\{ includeMetadataChanges: true \},/, `${file} hears the server's confirmation`);
    assert.match(source, /const fromCache = snapshot\.metadata\?\.fromCache === true;\s*(?:\/\/[^\n]*\n\s*)*if \(fromCache\) return;/, `${file} never finishes on the saved copy`);
  }
});

test("where a person is sent after sign-in is decided on the server's profile", async () => {
  const source = await readFile(new URL("../auth/AuthProvider.jsx", import.meta.url), "utf8");
  assert.match(source, /onSnapshot\(\s*userProfileRef,\s*(?:\/\/[^\n]*\n\s*)*\{ includeMetadataChanges: true \},/);
  assert.match(source, /if \(!profileConfirmed && snapshot\.metadata\.fromCache\) return;\s*profileConfirmed = true;/);
});
