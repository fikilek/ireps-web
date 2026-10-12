// Work nobody answers goes back to the pool. `DR-R001` 5.6, owner 11 October.
//
// The clock and the database are arguments to the module, so every one of
// these runs in milliseconds against a fake Firestore. A rule measured in
// days has to be testable in a test suite, or it is only ever tested in
// production.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  EXPIRY_ACTOR,
  EXPIRY_EVENT,
  buildExpiryHistoryEvent,
  buildExpiryPatch,
  expireSilentWork,
  findSilentWork,
} from "../meterLifecycle/expireSilentWork.js";
import { EXPIRES_AFTER_MS, TRN_STATES } from "../meterLifecycle/trnStateMachine.js";

const NOW = Date.parse("2026-10-12T12:00:00.000Z");
const ago = (ms) => new Date(NOW - ms).toISOString();

// ---------------------------------------------------------------------------
// A fake Firestore that is honest about the two things this module depends on:
// an equality filter on one field, and paging by document id. It deliberately
// does NOT support a range filter on issuedAt - because the module must not
// ask for one (see the comment at the top of expireSilentWork.js).
// ---------------------------------------------------------------------------
function fakeDb(docs) {
  const store = new Map(Object.entries(docs));
  const writes = [];

  const refFor = (collection, id) => ({
    collection: () => ({ doc: () => ({ id: `${id}::history`, path: `${collection}/${id}/history` }) }),
    id,
    path: `${collection}/${id}`,
  });

  const snapFor = (collection, id) => ({
    id,
    exists: store.has(`${collection}/${id}`),
    ref: refFor(collection, id),
    data: () => store.get(`${collection}/${id}`),
  });

  const query = (collection, filters = [], limit = null, after = null) => ({
    where(field, op, value) {
      assert.equal(op, "==", "the module must use an equality filter, never a range on the clock");
      return query(collection, [...filters, [field, value]], limit, after);
    },
    orderBy(field) {
      assert.equal(field, "__name__", "paging must be by document id");
      return query(collection, filters, limit, after);
    },
    limit(n) {
      return query(collection, filters, n, after);
    },
    startAfter(doc) {
      return query(collection, filters, limit, doc.id);
    },
    async get() {
      let ids = [...store.keys()]
        .filter((key) => key.startsWith(`${collection}/`))
        .map((key) => key.slice(collection.length + 1))
        .sort();

      if (after) ids = ids.filter((id) => id > after);

      ids = ids.filter((id) =>
        filters.every(([field, value]) => {
          const parts = field.split(".");
          let at = store.get(`${collection}/${id}`);

          for (const part of parts) at = at?.[part];

          return at === value;
        }),
      );

      const page = limit ? ids.slice(0, limit) : ids;
      const out = page.map((id) => snapFor(collection, id));

      return { empty: out.length === 0, size: out.length, docs: out };
    },
  });

  return {
    writes,
    collection: (name) => ({
      doc: (id) => refFor(name, id),
      where: (f, o, v) => query(name).where(f, o, v),
    }),
    async runTransaction(body) {
      return body({
        async get(target) {
          if (typeof target?.get === "function" && !target.path) return target.get();

          return snapFor(target.path.split("/")[0], target.id);
        },
        update(ref, patch) {
          writes.push({ op: "update", path: ref.path, patch });

          const current = store.get(ref.path) || {};
          const next = structuredClone(current);

          for (const [key, value] of Object.entries(patch)) {
            const parts = key.split(".");
            let at = next;

            while (parts.length > 1) {
              const part = parts.shift();
              at[part] = at[part] ?? {};
              at = at[part];
            }

            at[parts[0]] = value;
          }

          store.set(ref.path, next);
        },
        set(ref, value) {
          writes.push({ op: "set", path: ref.path, value });
        },
      });
    },
  };
}

const issuedJob = (id, issuedAt, extra = {}) => ({
  [`trns/${id}`]: {
    workflow: { state: "ISSUED", issuedAt },
    accessData: { trnType: "METER_DISCONNECTION" },
    ast: { astData: { astId: `AST_${id}` } },
    assignment: { targets: [{ type: "USER", id: "fwr-1", name: "Kaiser" }] },
    ...extra,
  },
  [`asts/AST_${id}`]: {
    trnActiveLifecycle: {
      trnId: id,
      trnType: "METER_DISCONNECTION",
      workflowState: "ISSUED",
      assignedTo: { type: "USER", id: "fwr-1", name: "Kaiser" },
    },
  },
});

// ---------------------------------------------------------------------------

test("three days of silence sends the work back to the pool", async () => {
  const db = fakeDb(issuedJob("OLD", ago(EXPIRES_AFTER_MS + 60_000)));

  const result = await expireSilentWork({ db, nowMs: NOW });

  assert.deepEqual(result.expired, ["OLD"]);

  const trn = db.writes.find((w) => w.path === "trns/OLD");

  assert.equal(trn.patch["workflow.state"], TRN_STATES.CREATED);
  assert.deepEqual(trn.patch["assignment.targets"], [], "it is nobody's again");
});

test("a job one minute short of three days is left alone", async () => {
  const db = fakeDb(issuedJob("YOUNG", ago(EXPIRES_AFTER_MS - 60_000)));

  const result = await expireSilentWork({ db, nowMs: NOW });

  assert.deepEqual(result.expired, []);
  assert.equal(db.writes.length, 0, "nothing is written at all");
});

test("A JOB WITH NO ISSUE TIME NEVER EXPIRES, however old the record", async () => {
  // The rule's own words. All of TEST's and LIVE's issued work has no stamp,
  // and an unknown age is not a long one (UI-R008).
  for (const issuedAt of [null, undefined, "", "not a date"]) {
    const db = fakeDb(issuedJob("NOSTAMP", issuedAt));
    const result = await expireSilentWork({ db, nowMs: NOW });

    assert.deepEqual(result.expired, [], String(issuedAt));
    assert.equal(db.writes.length, 0, String(issuedAt));
  }
});

test("the clock is never put in the query", async () => {
  // THE BUG THIS PREVENTS. `where("workflow.issuedAt","<",cutoff)` matches an
  // explicit null, because null sorts before a string in Firestore's type
  // ordering - so it would expire exactly the records the rule protects, and
  // it would look right doing it. The fake Firestore refuses any filter that
  // is not an equality, so this test fails loudly if the query ever grows one.
  const db = fakeDb({
    ...issuedJob("A", ago(EXPIRES_AFTER_MS + 1000)),
    ...issuedJob("B", null),
  });

  const found = await findSilentWork({ db, nowMs: NOW });

  assert.deepEqual(
    found.expired.map((job) => job.trnId),
    ["A"],
  );
  assert.deepEqual(found.neverExpire, ["B"]);
  assert.deepEqual(found.unreadable, [], "B's stamp is absent, not broken");
});

test("only issued work expires - never work a man has taken", async () => {
  // DR-R001 5.6, the owner's own reasoning: the clock cannot see that he is
  // standing at the meter.
  const db = fakeDb({
    "trns/ACCEPTED_OLD": {
      workflow: { state: "ACCEPTED", issuedAt: ago(30 * 24 * 60 * 60 * 1000) },
      accessData: { trnType: "METER_DISCONNECTION" },
      ast: { astData: { astId: "AST_X" } },
    },
    "trns/CREATED_OLD": {
      workflow: { state: "CREATED", issuedAt: ago(30 * 24 * 60 * 60 * 1000) },
      accessData: { trnType: "METER_DISCONNECTION" },
      ast: { astData: { astId: "AST_Y" } },
    },
  });

  const result = await expireSilentWork({ db, nowMs: NOW });

  assert.deepEqual(result.expired, []);
  assert.equal(result.scanned, 0, "the query asked for ISSUED and found none");
});

test("the meter's marker stops naming the worker, and still holds the meter", async () => {
  // A job back in Created HOLDS its meter (5.2), so the marker is rewritten
  // rather than removed - it is the delete that removes it.
  const db = fakeDb(issuedJob("OLD", ago(EXPIRES_AFTER_MS + 1000)));

  await expireSilentWork({ db, nowMs: NOW });

  const ast = db.writes.find((w) => w.path === "asts/AST_OLD");

  assert.ok(ast, "the meter is written");
  assert.equal(ast.patch.trnActiveLifecycle.workflowState, TRN_STATES.CREATED);
  assert.equal(ast.patch.trnActiveLifecycle.assignedTo.id, "NAv", "nobody holds it");
  assert.equal(ast.patch.trnActiveLifecycle.trnId, "OLD", "the job still holds the meter");
  assert.ok(ast.patch["metadata.updatedAt"], "the stamp the registry rebuild keys off");
});

test("a marker naming somebody else's job is not touched", async () => {
  // The marker is a single field. An inspection may hold it while a
  // disconnection expires, and releasing the inspection would be a fault.
  const docs = issuedJob("OLD", ago(EXPIRES_AFTER_MS + 1000));

  docs["asts/AST_OLD"].trnActiveLifecycle.trnId = "SOMEBODY_ELSE";

  const db = fakeDb(docs);

  await expireSilentWork({ db, nowMs: NOW });

  assert.equal(
    db.writes.find((w) => w.path === "asts/AST_OLD"),
    undefined,
    "the meter is left exactly as it was",
  );
});

test("the history records an expiry as its own event, not as a cancellation", async () => {
  // DR-R001 9.1 counts expiries separately from cancellations. They land in
  // the same state, so only the history can tell them apart.
  const db = fakeDb(issuedJob("OLD", ago(EXPIRES_AFTER_MS + 1000)));

  await expireSilentWork({ db, nowMs: NOW });

  const event = db.writes.find((w) => w.op === "set");

  assert.equal(event.value.event, EXPIRY_EVENT);
  assert.equal(event.value.event, "EXPIRED");
  assert.equal(event.value.workflowState, TRN_STATES.CREATED);
  assert.equal(event.value.actor.uid, "SYSTEM");
  assert.match(event.value.note, /No answer in 3 days/);
});

test("an expiry does not wear a supervisor's clothes", () => {
  // Reusing workflow.cancelledAt would make a clock-driven return
  // indistinguishable from an office cancellation on the fast read.
  const patch = buildExpiryPatch({ now: "2026-10-12T12:00:00.000Z" });

  assert.ok(patch["workflow.expiredAt"]);
  assert.equal(patch["workflow.cancelledAt"], undefined);
  assert.equal(patch["assignment.cancelReason"], undefined);
  assert.equal(patch["metadata.updatedByUid"], EXPIRY_ACTOR.uid);
  assert.equal(patch["metadata.updatedByUser"], "iREPS");
});

test("a person who acts between the scan and the write wins", async () => {
  // The office cancels it, or the worker accepts it, in the seconds the sweep
  // takes. A timer that overrode a person would be worse than one that missed
  // a tick - the next tick simply does not find it.
  const docs = issuedJob("RACED", ago(EXPIRES_AFTER_MS + 1000));
  const db = fakeDb(docs);

  const found = await findSilentWork({ db, nowMs: NOW });

  assert.equal(found.expired.length, 1);

  // He accepts it after the scan.
  docs["trns/RACED"].workflow.state = "ACCEPTED";

  const result = await expireSilentWork({ db, nowMs: NOW });

  assert.deepEqual(result.expired, []);
  assert.equal(result.leftAlone.length, 0, "it is no longer even found");
});

test("a run that stops early says so", async () => {
  // A run that hit its cap and printed a tidy number is how a backlog hides.
  const docs = {};

  for (const n of [1, 2, 3, 4, 5]) {
    Object.assign(docs, issuedJob(`OLD${n}`, ago(EXPIRES_AFTER_MS + 1000)));
  }

  const db = fakeDb(docs);
  const result = await expireSilentWork({ db, nowMs: NOW, maxPerRun: 2 });

  assert.equal(result.found, 5);
  assert.equal(result.expired.length, 2);
  assert.equal(result.stoppedOnCap, true);
  assert.equal(result.remaining, 3);
});

test("it pages, and a page boundary skips nothing", async () => {
  const docs = {};

  for (let n = 0; n < 7; n += 1) {
    Object.assign(docs, issuedJob(`J${n}`, ago(EXPIRES_AFTER_MS + 1000)));
  }

  const db = fakeDb(docs);
  const found = await findSilentWork({ db, nowMs: NOW, pageSize: 2 });

  assert.equal(found.expired.length, 7);
  assert.ok(found.pages >= 4, `paged: ${found.pages}`);
});

test("the three days are the machine's, never restated here", async () => {
  const source = await readFile(
    new URL("../meterLifecycle/expireSilentWork.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /import \{[^}]*hasExpired[^}]*\} from "\.\/trnStateMachine\.js"/s);
  assert.doesNotMatch(source, /3 \* 24 \* 60 \* 60 \* 1000/, "no second copy of the clock");
  assert.doesNotMatch(source, /72/, "nor the hours");
});

test("the schedule runs hourly, in South African time, and logs every run", async () => {
  const source = await readFile(
    new URL("../meterLifecycle/expireSilentWorkSchedule.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /schedule: "every 60 minutes"/);
  assert.match(source, /timeZone: "Africa\/Johannesburg"/);
  assert.match(source, /timeoutSeconds: 540/);
  assert.match(source, /logger\.info\("onIssuedWorkExpires -- RUN"/);
  assert.match(source, /stoppedOnCap \|\| result\.stoppedOnDeadline/);
});

test("the history event names the days it waited, in words", () => {
  const event = buildExpiryHistoryEvent({
    trnId: "T",
    trnType: "METER_DISCONNECTION",
    astId: "A",
    now: "2026-10-12T12:00:00.000Z",
    ageMs: 5.5 * 24 * 60 * 60 * 1000,
  });

  assert.match(event.note, /No answer in 5 days/);
});

test("a stamp that is there and cannot be read is counted, not dropped", async () => {
  // Found by an adversarial read of this very module, 12 October. A Firestore
  // Timestamp stringifies to "[object Object]", so `Date.parse` gives NaN and
  // the job never expires - correctly, since we cannot know its age. But the
  // first version of this sweep counted only a FALSY stamp as "never
  // expires", so an unreadable one landed in neither bucket: scanned,
  // dropped, and reported as a clean run.
  //
  // Absent is the rule protecting a record. Unreadable is a fault in it.
  const db = fakeDb({
    ...issuedJob("TIMESTAMP", { _seconds: 1760000000, _nanoseconds: 0 }),
    ...issuedJob("WORDS", "whenever"),
    ...issuedJob("NOTHING", null),
  });

  const found = await findSilentWork({ db, nowMs: NOW });

  assert.deepEqual(found.expired, []);
  assert.deepEqual(found.neverExpire, ["NOTHING"]);
  assert.deepEqual(found.unreadable.sort(), ["TIMESTAMP", "WORDS"]);

  const result = await expireSilentWork({ db, nowMs: NOW });

  assert.equal(result.neverExpire, 1);
  assert.deepEqual(result.unreadableIssuedAt.sort(), ["TIMESTAMP", "WORDS"]);
  assert.equal(result.scanned, 3, "every candidate is accounted for");
});

test("an old word is placed before the clock is read", async () => {
  // `hasExpired` used to test the raw stored state, so a record carrying
  // REASSIGNED - which the machine places in Issued, and which holds its
  // meter - could never expire, though those are the records 5.6 exists to
  // clear. Nothing writes that word any more; this pins the principle.
  const { hasExpired } = await import("../meterLifecycle/trnStateMachine.js");

  const old = { workflow: { state: "REASSIGNED", issuedAt: ago(EXPIRES_AFTER_MS + 1000) } };

  assert.equal(hasExpired(old, NOW), true);

  // And the one the owner settled: a man who took the work is never timed out.
  const taken = { workflow: { state: "IN_PROGRESS", issuedAt: ago(EXPIRES_AFTER_MS + 1000) } };

  assert.equal(hasExpired(taken, NOW), false, "IN_PROGRESS places in ACCEPTED");
});

test("the clock has no role, and that is deliberate", async () => {
  // `expire` is NOT in OFFICE_ONLY_ACTIONS, because nobody does it. Pinned
  // from both sides: if a later tidy-up adds it, the sweep starts refusing
  // every job and reports zero while looking healthy.
  const { OFFICE_ONLY_ACTIONS, canMoveAs } = await import(
    "../meterLifecycle/trnStateMachine.js"
  );

  assert.equal(OFFICE_ONLY_ACTIONS.includes("expire"), false);
  assert.equal(canMoveAs("ISSUED", "expire", "SYSTEM").ok, true);
  assert.equal(canMoveAs("ISSUED", "expire", null).ok, true);

  // Which is safe only because no caller is a person: the sweep is the only
  // writer and it is a scheduled function with no request behind it.
  const schedule = await readFile(
    new URL("../meterLifecycle/expireSilentWorkSchedule.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(schedule, /onCall/, "it is never exposed as a callable");
});

test("a job that comes back says when it came back", async () => {
  // DR-R001 9.2: the Waiting view says how long each has waited, and that is
  // from when it returned - not from when it was issued three days ago.
  const db = fakeDb(issuedJob("OLD", ago(EXPIRES_AFTER_MS + 1000)));

  await expireSilentWork({ db, nowMs: NOW });

  const trn = db.writes.find((w) => w.path === "trns/OLD");

  assert.ok(trn.patch["workflow.returnedToCreatedAt"], "the stamp the pool reads");
  assert.equal(trn.patch["workflow.returnedToCreatedAt"], trn.patch["workflow.expiredAt"]);
});

test("ONE CLOCK, AND IT IS THREE DAYS", async () => {
  // Owner, 12 October 2026: "lets standardize on 3 days for everything".
  //
  // It settled a clash found the day before: `DR-R001` section 8's reminder
  // ladder unallocated after the fifth reminder - about five and a half hours
  // - while 5.6 said three days. Two mechanisms that both return the same job
  // race each other, and the winner depends on which happened to be deployed.
  //
  // So the window is declared once, in the machine, and this refuses a second
  // declaration anywhere in the lifecycle code. `expireSilentWork.js` divides
  // by a day to say "No answer in 3 days" in words, which is not a window.
  const { readdir } = await import("node:fs/promises");
  const dir = new URL("../meterLifecycle/", import.meta.url);
  const files = await readdir(dir);

  const offenders = [];

  for (const file of files.filter((name) => name.endsWith(".js"))) {
    if (file === "trnStateMachine.js") continue;

    const source = await readFile(new URL(file, dir), "utf8");

    // A multiple of a day, or seventy-two hours, spelled out.
    if (/\b[0-9]+\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(source)) {
      offenders.push(file);
    }

    if (/\b72\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(source)) offenders.push(file);
  }

  assert.deepEqual(offenders, [], "the three days are declared in the machine alone");

  // And the machine says it once.
  const machine = await readFile(
    new URL("../meterLifecycle/trnStateMachine.js", import.meta.url),
    "utf8",
  );

  assert.equal(
    machine.match(/24 \* 60 \* 60 \* 1000/g).length,
    1,
    "one declaration in the machine too",
  );
  assert.equal(EXPIRES_AFTER_MS, 3 * 24 * 60 * 60 * 1000);
});
