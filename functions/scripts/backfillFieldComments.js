import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { initializeApp, cert, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { planFieldCommentBackfill, assertFieldCommentBackfillProject } from "../maintenance/fieldCommentBackfillPlan.js";

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
if (!args.includes("--key") || !args.includes("--output")) throw new Error("Required: --key <matching credential> --output <new evidence directory> [--project ireps2|ireps-test] [--apply]");
const key = JSON.parse(fs.readFileSync(option("--key"), "utf8"));
const project = assertFieldCommentBackfillProject(args.includes("--project") ? option("--project") : "ireps2", key.project_id);
const output = path.resolve(option("--output"));
fs.mkdirSync(output, { recursive: true });
const write = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2), { flag: "wx" });
const stamp = snap => snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null;
const json = value => JSON.parse(JSON.stringify(value));
const app = initializeApp({ projectId: project, credential: cert(key) });
const db = getFirestore(app);
db.settings({ preferRest: true });
try {
  if (!args.includes("--apply")) {
    const snapshot = await db.collection("trns").get();
    const records = snapshot.docs.map(snap => ({ path: snap.ref.path, updateTime: stamp(snap), ...planFieldCommentBackfill(snap.data()) }));
    const counts = {};
    for (const row of records) counts[row.status] = (counts[row.status] || 0) + 1;
    const summary = { project, mode: "dry-run", at: new Date().toISOString(), scanned: snapshot.size, counts };
    // Full inventory also proves excluded and unchanged transactions were preserved.
    write("before-images.json", snapshot.docs.map(snap => ({ path: snap.ref.path, updateTime: stamp(snap), fields: snap._fieldsProto, data: snap.data() })));
    write("plan.json", { ...summary, records });
    write("summary.json", summary);
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const plan = JSON.parse(fs.readFileSync(path.join(output, "plan.json"), "utf8"));
    const before = new Map(JSON.parse(fs.readFileSync(path.join(output, "before-images.json"), "utf8")).map(row => [row.path, row]));
    if (plan.project !== project) throw new Error("Plan project mismatch");
    const candidates = plan.records.filter(row => row.status === "UPDATE");
    for (const row of candidates) {
      const saved = before.get(row.path);
      if (!/^trns\/[^/]+$/.test(row.path) || !saved || saved.updateTime !== row.updateTime || !isDeepStrictEqual(planFieldCommentBackfill(saved.data).patch, row.patch)) throw new Error("Invalid plan or incomplete backup");
    }
    // Exclusive journal prevents accidental duplicate/restarted applies.
    fs.writeFileSync(path.join(output, "applied.jsonl"), "", { flag: "wx" });
    const results = [];
    let next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < candidates.length) {
        const row = candidates[next++];
        let result;
        try {
          result = await db.runTransaction(async tx => {
            const snap = await tx.get(db.doc(row.path));
            if (!snap.exists || stamp(snap) !== row.updateTime) return { path: row.path, status: "SKIPPED_CONCURRENT_CHANGE" };
            if (!isDeepStrictEqual(planFieldCommentBackfill(snap.data()).patch, row.patch)) return { path: row.path, status: "SKIPPED_PLAN_CHANGED" };
            tx.update(snap.ref, row.patch);
            return { path: row.path, status: "APPLIED" };
          });
        } catch (error) { result = { path: row.path, status: "FAILED", error: error.message }; }
        results.push(result);
        fs.appendFileSync(path.join(output, "applied.jsonl"), JSON.stringify(result) + "\n");
      }
    }));
    const after = await db.collection("trns").get();
    const applied = new Set(results.filter(row => row.status === "APPLIED").map(row => row.path));
    const verification = [];
    for (const snap of after.docs) {
      const saved = before.get(snap.ref.path);
      if (!saved) { verification.push({ path: snap.ref.path, status: "NEW_DURING_RUN" }); continue; }
      const expected = structuredClone(saved.data);
      if (applied.has(snap.ref.path)) expected.fieldComment = { ...expected.fieldComment, text: "NAv" };
      verification.push({ path: snap.ref.path, status: isDeepStrictEqual(json(snap.data()), expected) ? "VERIFIED" : "CHANGED_DURING_RUN_OR_MISMATCH" });
      before.delete(snap.ref.path);
    }
    for (const missing of before.keys()) verification.push({ path: missing, status: "MISSING_AFTER_RUN" });
    const counts = {};
    for (const result of results) counts[result.status] = (counts[result.status] || 0) + 1;
    const summary = { project, mode: "apply", at: new Date().toISOString(), counts, verified: verification.filter(row => row.status === "VERIFIED").length, verificationExceptions: verification.filter(row => row.status !== "VERIFIED") };
    write("verification.json", verification);
    write("apply-summary.json", summary);
    console.log(JSON.stringify(summary, null, 2));
    if (results.some(row => row.status !== "APPLIED") || summary.verificationExceptions.length) process.exitCode = 1;
  }
} finally { await deleteApp(app); }
