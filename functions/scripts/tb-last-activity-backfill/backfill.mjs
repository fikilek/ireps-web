// Targeted Batch rules TB-R069 (1.3.87): write lastActivity once on batches that have none.
// Only batches without lastActivity are touched, and only that one field; nothing else changes.
//   node scripts/tb-last-activity-backfill/backfill.mjs plan    --project <id> --out <dir>
//   node scripts/tb-last-activity-backfill/backfill.mjs apply   --project <id> --out <dir> [--live-go <runId>]
//   node scripts/tb-last-activity-backfill/backfill.mjs verify  --project <id> --out <dir>
//   node scripts/tb-last-activity-backfill/backfill.mjs restore --project <id> --out <dir> [--live-go <runId>]  (removes what apply wrote, unless a real event replaced it)
// plan is the dry run and the archive: it lists every batch, what it holds today and what would be written.
// LIVE (ireps-5c3e9) needs the owner's go and --live-go with the plan's runId.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { planLastActivity } from "./planner.js";

const LIVE = "ireps-5c3e9";
const LIVE_KEY = "C:/dev/secrets/ireps-5c3e9-firebase-adminsdk.json";

const [mode, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 2) args[rest[i].replace(/^--/, "")] = rest[i + 1];
if (!args.project || !args.out) throw new Error("--project and --out are required");
const isLive = args.project === LIVE;
const out = path.resolve(args.out);
fs.mkdirSync(out, { recursive: true });
const db = getFirestore(initializeApp(isLive ? { credential: cert(LIVE_KEY), projectId: LIVE } : { projectId: args.project }));
const planFile = path.join(out, "plan.json");
const resultsFile = path.join(out, "apply-results.jsonl");

const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

async function plan() {
  const batches = (await db.collection("tb_uploads").get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const entries = [];
  for (const batch of batches) {
    if (batch.lastActivity) { entries.push({ tbId: batch.id, action: "SKIP_HAS_ONE" }); continue; }
    const rows = (await db.collection("tb_rows").where("tbId", "==", batch.id).get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const salesIds = [...new Set(rows.map(row => row.salesAllMeterId).filter(Boolean))];
    const salesById = {};
    for (const ids of chunks(salesIds, 100)) {
      const snaps = await db.getAll(...ids.map(id => db.collection("sales-all-meters").doc(id)));
      snaps.forEach(snap => { if (snap.exists) salesById[snap.id] = snap.data(); });
    }
    const next = planLastActivity(batch, rows, salesById);
    entries.push(next ? { tbId: batch.id, action: "WRITE", lastActivity: { ...next, at: new Date(next.atMs).toISOString() } }
      : { tbId: batch.id, action: "SKIP_NO_EVENT" });
  }
  const body = JSON.stringify(entries);
  const runId = crypto.createHash("sha256").update(body).digest("hex").slice(0, 12);
  fs.writeFileSync(planFile, JSON.stringify({ project: args.project, runId, plannedAt: new Date().toISOString(), entries }, null, 2));
  const count = action => entries.filter(e => e.action === action).length;
  console.log(`plan ${runId}: ${entries.length} batches, write ${count("WRITE")}, already have one ${count("SKIP_HAS_ONE")}, no event ${count("SKIP_NO_EVENT")}`);
  for (const e of entries.filter(x => x.action === "WRITE")) console.log(`  ${e.tbId}  ${e.lastActivity.at}  ${e.lastActivity.kind}`);
}

async function apply() {
  const planned = JSON.parse(fs.readFileSync(planFile, "utf8"));
  if (planned.project !== args.project) throw new Error(`The plan is for ${planned.project}, not ${args.project}`);
  if (isLive && args["live-go"] !== planned.runId) throw new Error(`LIVE apply needs --live-go ${planned.runId}`);
  let written = 0, skipped = 0;
  for (const entry of planned.entries.filter(e => e.action === "WRITE")) {
    const ref = db.collection("tb_uploads").doc(entry.tbId);
    const status = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      // Written since the plan (a live event) or gone: leave it.
      if (!snap.exists || snap.data().lastActivity) return "SKIPPED";
      const { atMs, kind, byUid, byUser } = entry.lastActivity;
      tx.update(ref, { lastActivity: { at: Timestamp.fromMillis(atMs), kind, byUid, byUser } });
      return "WRITTEN";
    });
    status === "WRITTEN" ? written++ : skipped++;
    fs.appendFileSync(resultsFile, JSON.stringify({ tbId: entry.tbId, status, at: new Date().toISOString() }) + "\n");
  }
  console.log(`apply ${planned.runId}: written ${written}, skipped ${skipped}`);
}

async function verify() {
  const planned = JSON.parse(fs.readFileSync(planFile, "utf8"));
  const batches = (await db.collection("tb_uploads").get()).docs;
  const missing = batches.filter(doc => !doc.data().lastActivity).map(doc => doc.id);
  const noEvent = new Set(planned.entries.filter(e => e.action === "SKIP_NO_EVENT").map(e => e.tbId));
  const unexpected = missing.filter(id => !noEvent.has(id));
  console.log(`verify: ${batches.length} batches, without lastActivity ${missing.length} (never allocated, expected: ${missing.length - unexpected.length})`);
  console.log(unexpected.length ? `VERIFY FAIL: ${unexpected.join(", ")}` : "VERIFY PASS");
}

async function restore() {
  const planned = JSON.parse(fs.readFileSync(planFile, "utf8"));
  if (planned.project !== args.project) throw new Error(`The plan is for ${planned.project}, not ${args.project}`);
  if (isLive && args["live-go"] !== planned.runId) throw new Error(`LIVE restore needs --live-go ${planned.runId}`);
  const written = new Set(fs.readFileSync(resultsFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    .filter(r => r.status === "WRITTEN").map(r => r.tbId));
  let removed = 0, kept = 0;
  for (const entry of planned.entries.filter(e => written.has(e.tbId))) {
    const ref = db.collection("tb_uploads").doc(entry.tbId);
    const done = await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data()?.lastActivity;
      // A real event since apply wrote a newer one: that one stays.
      if (!current || current.kind !== entry.lastActivity.kind || current.at?.toMillis?.() !== entry.lastActivity.atMs) return false;
      tx.update(ref, { lastActivity: FieldValue.delete() });
      return true;
    });
    done ? removed++ : kept++;
  }
  console.log(`restore: removed ${removed}, kept ${kept} with newer real activity`);
}

const modes = { plan, apply, verify, restore };
if (!modes[mode]) throw new Error(`mode must be one of ${Object.keys(modes).join(", ")}`);
await modes[mode]();
