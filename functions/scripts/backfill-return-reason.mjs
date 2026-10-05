import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import admin from "firebase-admin";
import { returnReasonPatch } from "../noAccess/returnReasonBackfill.js";
import { noAccessPremiseMetadata } from "../noAccess/premiseMetadata.js";

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
assert.equal(option("--project"), "ireps2", "This maintenance script is DEV-only.");
const out = option("--output");
assert.ok(out && path.isAbsolute(out), "Use an absolute evidence directory.");
const apply = args.includes("--apply");
if (apply) assert.ok(option("--reviewed-plan"), "Review the dry-run plan before applying.");
fs.mkdirSync(out, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const app = admin.initializeApp({ projectId: "ireps2", credential: admin.credential.applicationDefault() });
const db = admin.firestore(app); db.settings({ preferRest: true });
try {
  const names = ["trns", "report_trn_no_access", "premises", "asts"];
  const snapshots = await Promise.all(names.map(name => db.collection(name).get()));
  const docs = new Map(snapshots.flatMap(snapshot => snapshot.docs.map(doc => [doc.ref.path, doc])));
  const changes = [];
  for (const doc of snapshots[0].docs) {
    const patch = returnReasonPatch(doc.data().accessData?.access);
    if (Object.keys(patch).length) changes.push({ path: doc.ref.path, patch });
  }
  for (const doc of snapshots[1].docs) {
    // Report rows identify their kind at the root; access contains the copied reason.
    const patch = returnReasonPatch({ ...doc.data().access, hasAccess: "no" }, "access");
    if (Object.keys(patch).length) {
      assert.ok(docs.has(`trns/${doc.id}`), `Orphan report row: ${doc.id}`);
      changes.push({ path: doc.ref.path, patch });
    }
  }
  for (const premise of snapshots[2].docs) {
    const current = premise.data();
    const visits = snapshots[0].docs.filter(doc => doc.data().accessData?.access?.hasAccess === "no" && doc.data().accessData?.premise?.id === premise.id);
    let metadata = current.metadata || {}, patch = {};
    for (const visit of visits) {
      const next = noAccessPremiseMetadata(visit.data().metadata, metadata);
      if (!Object.keys(next).length) continue;
      patch = next;
      metadata = { ...metadata, updatedAt: next["metadata.updatedAt"] };
    }
    if (Object.keys(patch).length) changes.push({ path: premise.ref.path, patch });
  }
  changes.sort((a,b) => a.path.localeCompare(b.path));
  const plan = { projectId: "ireps2", changes, deletions: [], counts: Object.fromEntries(names.map((name,i) => [name, snapshots[i].size])) };
  save("plan.json", plan);
  if (apply) {
    const reviewed = JSON.parse(fs.readFileSync(option("--reviewed-plan"), "utf8"));
    assert.deepEqual(plan, reviewed, "Source data changed; review a fresh plan.");
    assert.ok(changes.length <= 450, "Use an explicit reviewed batching strategy above 450 changes.");
    save("backup.json", { projectId: "ireps2", at: new Date().toISOString(), records: [...docs.values()].map(doc => ({ path: doc.ref.path, updateTime: doc.updateTime, data: doc.data() })) });
    const batch = db.batch();
    for (const change of changes) batch.update(db.doc(change.path), change.patch, { lastUpdateTime: docs.get(change.path).updateTime });
    if (changes.length) await batch.commit();
    const reread = await Promise.all(names.map(name => db.collection(name).get()));
    const fresh = new Map(reread.flatMap(snapshot => snapshot.docs.map(doc => [doc.ref.path, doc])));
    for (const change of changes) {
      for (const [key,value] of Object.entries(change.patch)) assert.deepEqual(key.split('.').reduce((data,k) => data?.[k], fresh.get(change.path)?.data()), value, `${change.path} ${key}`);
    }
    // Source record counts and every field outside the reviewed patch must be unchanged.
    for (const name of ["trns", "premises", "asts"]) {
      const before = snapshots[names.indexOf(name)];
      const after = reread[names.indexOf(name)];
      assert.equal(after.size, before.size, name);
      for (const doc of before.docs) {
        const expected = JSON.parse(JSON.stringify(doc.data()));
        const patch = changes.find(change => change.path === doc.ref.path)?.patch || {};
        for (const [key,value] of Object.entries(patch)) {
          const parts = key.split('.'); let target = expected;
          for (const part of parts.slice(0,-1)) target = target[part] ||= {};
          target[parts.at(-1)] = value;
        }
        assert.deepEqual(JSON.parse(JSON.stringify(fresh.get(doc.ref.path).data())), expected, doc.ref.path);
      }
    }
    const result = { verifiedAt: new Date().toISOString(), changed: changes.length, byCollection: Object.fromEntries(names.map(name => [name, changes.filter(c => c.path.startsWith(name+'/')).length])), deletions: 0, idsLinksAppointmentsCaptureTimesMediaAndAssetsUnchanged: true };
    save("verification.json", result); console.log(JSON.stringify(result));
  } else console.log(JSON.stringify({ changes: changes.length, ...plan }));
} finally { await app.delete(); }
