import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { deleteMdBgoBatchAtomically } from "../functions/bgo/mdBgoDelete.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readPath(value, path) {
  return String(path).split(".").reduce((cursor, part) => cursor?.[part], value);
}

function makeDb(seed = {}) {
  const docs = new Map(
    Object.entries(seed).map(([path, value]) => [path, structuredClone(value)]),
  );
  const makeDocRef = (path) => {
    const segments = path.split("/");
    const id = segments.at(-1);
    return {
      id,
      path,
      collection(name) {
        return makeCollectionRef(`${path}/${name}`);
      },
    };
  };
  const makeCollectionRef = (path) => ({
    path,
    doc(id) {
      return makeDocRef(`${path}/${id}`);
    },
    where(field, operator, value) {
      return {
        path,
        field,
        operator,
        value,
        limit() {
          return this;
        },
      };
    },
  });
  const snapshot = (path, value) => ({
    id: path.split("/").at(-1),
    ref: makeDocRef(path),
    exists: value !== undefined,
    data: () => structuredClone(value || {}),
  });

  return {
    docs,
    collection: (name) => makeCollectionRef(name),
    async runTransaction(callback) {
      const writes = [];
      const transaction = {
        async get(target) {
          if (target.field) {
            const matches = [...docs.entries()]
              .filter(([path, data]) =>
                path.startsWith(`${target.path}/`) &&
                path.slice(target.path.length + 1).split("/").length === 1 &&
                readPath(data, target.field) === target.value,
              )
              .map(([path, data]) => snapshot(path, data));
            return { docs: matches, size: matches.length };
          }
          if (target.path && !target.id) {
            const matches = [...docs.entries()]
              .filter(([path]) =>
                path.startsWith(`${target.path}/`) &&
                path.slice(target.path.length + 1).split("/").length === 1,
              )
              .map(([path, data]) => snapshot(path, data));
            return { docs: matches, size: matches.length };
          }
          return snapshot(target.path, docs.get(target.path));
        },
        delete(ref) {
          writes.push(["delete", ref]);
        },
        update(ref, patch) {
          writes.push(["update", ref, structuredClone(patch)]);
        },
      };

      const result = await callback(transaction);
      for (const [kind, ref, patch] of writes) {
        if (kind === "delete") {
          docs.delete(ref.path);
          continue;
        }
        const next = structuredClone(docs.get(ref.path) || {});
        for (const [field, value] of Object.entries(patch)) {
          const parts = field.split(".");
          let cursor = next;
          for (const part of parts.slice(0, -1)) cursor = cursor[part] ||= {};
          cursor[parts.at(-1)] = value;
        }
        docs.set(ref.path, next);
      }
      return result;
    },
  };
}

function seedBatch({ state = "READY_FOR_ALLOCATION", linkedBatchId = "BATCH-1" } = {}) {
  return {
    "bgo_batches/BATCH-1": {
      id: "BATCH-1",
      batchMode: "BMD",
      operationType: "METER_DISCOVERY",
      workflow: { state },
      summary: { erfCount: 1, totalRows: 1 },
      geofenceRef: { id: "FENCE-1" },
    },
    "bgo_rows/BATCH-1_ROW_1": {
      id: "BATCH-1_ROW_1",
      batchId: "BATCH-1",
      bgoBatchId: "BATCH-1",
      workflow: { state },
    },
    "bgo_batches/BATCH-1/history/created": { event: "CREATED" },
    "notifications/notification-1": { bgo: { batchId: "BATCH-1" } },
    "geo_fences/FENCE-1": {
      bgo: {
        batchId: linkedBatchId,
        linkState: "LINKED",
        batchedAt: "old",
        batchedByUid: "user-1",
      },
    },
  };
}

test("deleting an unstarted MD BGO batch removes its rows and releases its geofence", async () => {
  const db = makeDb(seedBatch());
  const result = await deleteMdBgoBatchAtomically({
    db,
    bgoBatchId: "BATCH-1",
    now: "now",
    actorUid: "supervisor-1",
    actorName: "Supervisor",
  });

  assert.equal(result.success, true);
  assert.equal(result.deletedBgoRows, 1);
  assert.equal(result.deletedHistoryDocs, 1);
  assert.equal(result.deletedNotifications, 1);
  assert.equal(result.geofenceUnlinked, true);
  assert.equal(db.docs.has("bgo_batches/BATCH-1"), false);
  assert.equal(db.docs.has("bgo_rows/BATCH-1_ROW_1"), false);
  assert.equal(db.docs.has("bgo_batches/BATCH-1/history/created"), false);
  assert.equal(db.docs.has("notifications/notification-1"), false);
  assert.equal(db.docs.get("geo_fences/FENCE-1").bgo.batchId, null);
  assert.equal(db.docs.get("geo_fences/FENCE-1").bgo.linkState, "UNLINKED");
});

test("deletion never clears a geofence claim owned by a different batch", async () => {
  const db = makeDb(seedBatch({ linkedBatchId: "BATCH-OTHER" }));
  const result = await deleteMdBgoBatchAtomically({
    db,
    bgoBatchId: "BATCH-1",
    now: "now",
    actorUid: "supervisor-1",
    actorName: "Supervisor",
  });

  assert.equal(result.success, true);
  assert.equal(result.geofenceUnlinked, false);
  assert.equal(db.docs.get("geo_fences/FENCE-1").bgo.batchId, "BATCH-OTHER");
});

test("field execution state blocks deletion without changing any documents", async () => {
  const seed = seedBatch({ state: "IN_PROGRESS" });
  const db = makeDb(seed);
  const result = await deleteMdBgoBatchAtomically({
    db,
    bgoBatchId: "BATCH-1",
    now: "now",
    actorUid: "supervisor-1",
    actorName: "Supervisor",
  });

  assert.equal(result.success, false);
  assert.equal(result.code, "BGO_BATCH_NOT_DELETABLE");
  assert.deepEqual(Object.fromEntries(db.docs), seed);
});

test("a linked premise blocks deletion and preserves the batch, rows, and geofence", async () => {
  const seed = {
    ...seedBatch(),
    "premises/PREMISE-1": {
      id: "PREMISE-1",
      bgo: { batchId: "BATCH-1" },
    },
  };
  const db = makeDb(seed);
  const result = await deleteMdBgoBatchAtomically({
    db,
    bgoBatchId: "BATCH-1",
    now: "now",
    actorUid: "supervisor-1",
    actorName: "Supervisor",
  });

  assert.equal(result.success, false);
  assert.equal(result.code, "BMD_BGO_HAS_CREATED_WORK");
  assert.deepEqual(Object.fromEntries(db.docs), seed);
});

test("the callable routes MD BGO through atomic deletion before the TRN delete guard", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "functions/bgo/deleteCallable.js"),
    "utf8",
  );
  const mdBgoBranch = source.indexOf("if (isBmdBgoBatch(bgoBatch))");
  const legacyGuard = source.indexOf("if (hasAcceptedOrReleasedBatch(bgoBatch))");

  assert.match(source, /import \{ deleteMdBgoBatchAtomically \} from "\.\/mdBgoDelete\.js"/);
  assert.ok(mdBgoBranch >= 0 && legacyGuard > mdBgoBranch);
  assert.match(source, /deleteMdBgoBatchAtomically\(\{[\s\S]*?bgoBatchId,[\s\S]*?actorName/);
});

test("MD BGO origination claims the geofence with its batch in one transaction", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "functions/bgo/callables.js"),
    "utf8",
  );
  const createStart = source.indexOf("async function createBmdBgoBatch");
  const createEnd = source.indexOf("export const onCreateBgoCallable", createStart);
  const createSource = source.slice(createStart, createEnd);

  assert.match(createSource, /db\.runTransaction\(async \(transaction\)/);
  assert.match(createSource, /transaction\.create\(batchRef, batchDoc\)/);
  assert.match(createSource, /transaction\.update\(fenceRef,[\s\S]*?"bgo\.batchId": bgoBatchId/);
  assert.match(createSource, /GEOFENCE_ALREADY_BATCHED/);
});
