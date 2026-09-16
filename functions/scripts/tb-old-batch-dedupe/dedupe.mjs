// Targeted Batch rules 1.3.34, TB-R049 and TB-R050: one-off de-duplication of old (0.2.0) batches.
//
//   node scripts/tb-old-batch-dedupe/dedupe.mjs plan    --project <id> --out <dir>
//   node scripts/tb-old-batch-dedupe/dedupe.mjs archive --project <id> --out <dir>             (reads <dir>/plan.json)
//   node scripts/tb-old-batch-dedupe/dedupe.mjs seed    --project demo-... --archive <file>     (emulator only)
//   node scripts/tb-old-batch-dedupe/dedupe.mjs apply   --project <id> --out <dir> --actor-uid <uid> [--meters a,b] [--live-go <runId>]
//   node scripts/tb-old-batch-dedupe/dedupe.mjs verify  --project <id> --out <dir>
//   node scripts/tb-old-batch-dedupe/dedupe.mjs restore --project demo-... --out <dir> --meters a  (emulator rehearsal of a rollback; never LIVE)
//
// LIVE (ireps-5c3e9) uses the service-account key; any other project must be the Firestore emulator.
// Apply on LIVE needs --live-go equal to the plan's runId. Nothing is deployed.
import fs from "node:fs";
import path from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Timestamp, GeoPoint, DocumentReference, FieldValue } from "firebase-admin/firestore";
import { planMeter, fingerprint, planSignature, countRows, completionTarget, removalCompletesBatch, holderOf, COUNT_KEYS, LEGACY_SCHEMA } from "./planner.js";
import { resolveSalesTargetedBatchMembership, assertSalesBatchExecutionMembership, classifySalesWorkStatus, readTbRefBatchId, nonblank } from "../../salesAllMeters/sales-batch-policy.js";
import { buildSalesAllMetersOperationalMetadataPatch } from "../../salesAllMeters/helpers.js";

const LIVE = "ireps-5c3e9";
const LIVE_KEY = "C:/dev/secrets/ireps-5c3e9-firebase-adminsdk.json";
const LM = "ZA5241";
const RULES_VERSION = "1.3.34";

const [mode, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 2) args[rest[i].replace(/^--/, "")] = rest[i + 1];
if (!args.project) throw new Error("--project is required");
const isLive = args.project === LIVE;
if (!isLive && !/^(127\.0\.0\.1|localhost):[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) throw new Error("A project other than LIVE must run against the Firestore emulator");
if (isLive && process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST is set while --project is LIVE");
if (mode === "seed" && isLive) throw new Error("seed never runs on LIVE");
const db = getFirestore(initializeApp(isLive ? { credential: cert(LIVE_KEY), projectId: LIVE } : { projectId: args.project }));
const out = args.out && path.resolve(args.out);
if (out) fs.mkdirSync(out, { recursive: true });
const writeJson = (file, value) => fs.writeFileSync(path.join(out, file), JSON.stringify(value, null, 1));
const readJson = file => JSON.parse(fs.readFileSync(path.join(out, file), "utf8"));

// ---------------------------------------------------------------- Firestore values <-> JSON, losslessly
export function encode(value) {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Timestamp) return { __t: "ts", s: value.seconds, n: value.nanoseconds };
  if (value instanceof GeoPoint) return { __t: "geo", lat: value.latitude, lng: value.longitude };
  if (value instanceof DocumentReference) return { __t: "ref", path: value.path };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { __t: "bytes", b64: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map(encode);
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`Cannot archive a value of type ${value.constructor?.name}`);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
}
export function decode(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decode);
  if (value.__t === "ts") return new Timestamp(value.s, value.n);
  if (value.__t === "geo") return new GeoPoint(value.lat, value.lng);
  if (value.__t === "ref") return db.doc(value.path);
  if (value.__t === "bytes") return Buffer.from(value.b64, "base64");
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]));
}

// ---------------------------------------------------------------- Everything that decides one meter (TB-R049)
const withId = snap => ({ ...snap.data(), id: snap.id, ...(snap.data().id !== undefined && snap.data().id !== snap.id ? { idConflict: true } : {}) });
const byId = list => [...new Map(list.map(x => [x.id, x])).values()];
async function gatherFacts(get, salesId) {
  const salesSnap = await get(db.doc(`sales-all-meters/${salesId}`));
  const mmSnap = await get(db.doc(`meter_master/${salesId}`));
  const rows = (await get(db.collection("tb_rows").where("salesAllMeterId", "==", salesId))).docs.map(withId);
  const sales = salesSnap.exists ? salesSnap.data() : null;
  const meterMaster = mmSnap.exists ? mmSnap.data() : null;
  const tbIds = [...new Set([...rows.map(r => r.tbId), ...(Array.isArray(sales?.tbRefs) ? sales.tbRefs.map(readTbRefBatchId).filter(Boolean) : [])])].sort();
  const parents = {};
  for (const tbId of tbIds) { const snap = await get(db.doc(`tb_uploads/${tbId}`)); parents[tbId] = snap.exists ? snap.data() : null; }
  let asts = (await get(db.collection("asts").where("ast.astData.astNo", "==", salesId))).docs.map(withId);
  const linkedAstId = meterMaster?.refs?.asts?.id;
  let discoveringAst = null;
  if (nonblank(linkedAstId)) {
    discoveringAst = asts.find(a => a.id === linkedAstId) || null;
    if (!discoveringAst) { const snap = await get(db.doc(`asts/${linkedAstId}`)); if (snap.exists) { discoveringAst = withId(snap); asts = byId([...asts, discoveringAst]); } }
  } else if (asts.length === 1) discoveringAst = asts[0];
  let discoveringTrn = null;
  if (nonblank(discoveringAst?.trnId)) { const snap = await get(db.doc(`trns/${discoveringAst.trnId}`)); discoveringTrn = snap.exists ? withId(snap) : null; }
  const rowIds = rows.map(r => r.id);
  let trns = (await get(db.collection("trns").where("targetedBatchContext.salesDocId", "==", salesId))).docs.map(withId);
  let premises = (await get(db.collection("premises").where("targetedBatchContext.salesDocId", "==", salesId))).docs.map(withId);
  for (let i = 0; i < rowIds.length; i += 30) {
    trns = byId([...trns, ...(await get(db.collection("trns").where("targetedBatchContext.rowId", "in", rowIds.slice(i, i + 30)))).docs.map(withId)]);
    premises = byId([...premises, ...(await get(db.collection("premises").where("targetedBatchContext.rowId", "in", rowIds.slice(i, i + 30)))).docs.map(withId)]);
  }
  const teams = (await get(db.collection("teams"))).docs.map(d => ({ id: d.id, name: d.data().team?.name || d.id, memberUserIds: d.data().scope?.memberUserIds || [] }));
  return { salesId, sales, meterMaster, rows, parents, asts, discoveringAst, discoveringTrn, trns, premises, teams };
}
async function pool(items, size, worker) {
  const results = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (next < items.length) { const i = next++; results[i] = await worker(items[i], i); } }));
  return results;
}
const iso = ts => (ts?.toDate ? ts.toDate().toISOString() : typeof ts === "string" ? ts : null);

// ---------------------------------------------------------------- plan (read-only)
async function plan() {
  const runId = `DEDUPE_${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}`;
  const [rowsSnap, salesSnap] = await Promise.all([
    db.collection("tb_rows").where("scope.lmPcode", "==", LM).get(),
    db.collection("sales-all-meters").where("lmPcode", "==", LM).select("tbRefs").get(),
  ]);
  const tbIdsByMeter = new Map();
  rowsSnap.docs.forEach(d => { const r = d.data(); (tbIdsByMeter.get(r.salesAllMeterId) || tbIdsByMeter.set(r.salesAllMeterId, new Set()).get(r.salesAllMeterId)).add(r.tbId); });
  const candidates = new Set([...tbIdsByMeter].filter(([, set]) => set.size > 1).map(([id]) => id));
  salesSnap.docs.forEach(d => { const refs = d.data().tbRefs; if (Array.isArray(refs) && new Set(refs.map(r => readTbRefBatchId(r) || JSON.stringify(r))).size > 1) candidates.add(d.id); });
  const ids = [...candidates].sort();
  const meters = await pool(ids, 8, async salesId => {
    const facts = await gatherFacts(ref => ref.get(), salesId);
    const p = planMeter(facts);
    p.fingerprint = fingerprint(facts);
    p.address = [facts.sales?.addressLine1, facts.sales?.town].filter(Boolean).join(", ") || null;
    if (p.decision === "RELEASE") p.sameErfOrAddress = await sameErfEvidence(facts);
    return p;
  });

  // Every batch that loses a row: counts and status before and after, from its rows today.
  const removalsByTb = new Map();
  meters.forEach(m => (m.removals || []).forEach(r => (removalsByTb.get(r.tbId) || removalsByTb.set(r.tbId, []).get(r.tbId)).push(r.rowId)));
  const parents = {};
  for (const [tbId, removed] of [...removalsByTb].sort()) {
    const [parentSnap, parentRows] = await Promise.all([db.doc(`tb_uploads/${tbId}`).get(), db.collection("tb_rows").where("tbId", "==", tbId).get()]);
    const parent = parentSnap.data(), rows = parentRows.docs.map(withId);
    const remaining = rows.filter(r => !removed.includes(r.id));
    const after = countRows(remaining);
    parents[tbId] = { tbId, schemaVersion: parent.schemaVersion, holder: holderOf(parent), status: parent.status, executionStatus: parent.execution?.status,
      storedCounts: Object.fromEntries(COUNT_KEYS.map(k => [k, parent.counts?.[k]])), storedCountsMatchRows: COUNT_KEYS.every(k => parent.counts?.[k] === countRows(rows)[k]),
      removedRows: removed.length, countsAfter: after, notStartedBefore: rows.filter(r => (r.execution?.status || "NOT_STARTED") === "NOT_STARTED").length, notStartedAfter: remaining.filter(r => (r.execution?.status || "NOT_STARTED") === "NOT_STARTED").length,
      wouldEmpty: remaining.length === 0, becomesCompleted: removalCompletesBatch(rows, remaining) };
  }
  const result = { runId, project: args.project, lmPcode: LM, rulesVersion: RULES_VERSION, plannedAt: new Date().toISOString(), meters, parents };
  writeJson("plan.json", result);
  fs.writeFileSync(path.join(out, "plan-report.txt"), report(result));
  console.log(report(result));
}
async function sameErfEvidence(facts) {
  const erfIds = [...new Set(facts.rows.map(r => r.refs?.erfId).filter(Boolean))];
  const found = [];
  for (const erfId of erfIds) {
    const [asts, premises] = await Promise.all([db.collection("asts").where("accessData.erfId", "==", erfId).get(), db.collection("premises").where("erfId", "==", erfId).get()]);
    asts.docs.forEach(d => found.push(`AST ${d.data().ast?.astData?.astNo || d.id} on ERF ${erfId} (${iso(d.data().metadata?.createdAt)?.slice(0, 10)}, ${d.data().metadata?.createdByUser || "?"})`));
    premises.docs.forEach(d => found.push(`premise ${d.id} on ERF ${erfId} (${iso(d.data().metadata?.createdAt)?.slice(0, 10)})`));
  }
  return found;
}
function report({ runId, project, meters, parents }) {
  const count = (list, key) => list.reduce((o, x) => ((o[key(x)] = (o[key(x)] || 0) + 1), o), {});
  const act = meters.filter(m => ["DEDUPE", "RELEASE"].includes(m.decision));
  const removals = act.flatMap(m => m.removals.map(r => ({ ...r, salesId: m.salesId, holder: m.rows.find(x => x.rowId === r.rowId)?.holder })));
  const lines = [`Run ${runId} on ${project} (${LM}), rules ${RULES_VERSION}`, "",
    `Meters in more than one batch: ${meters.filter(m => m.decision !== "NONE").length}`,
    `  decisions: ${JSON.stringify(count(meters, m => m.decision))}`,
    `  owner rules: ${JSON.stringify(count(act.filter(m => m.decision === "DEDUPE"), m => m.ownerRule))}`,
    `Rows removed: ${removals.length} (not released ${removals.filter(r => !r.released).length}, released ${removals.filter(r => r.released).length}, approved started row ${removals.filter(r => r.startedException).length})`,
    `  by team list: ${JSON.stringify(count(removals, r => r.holder))}`,
    `targetedBatchId set to the owner: ${act.filter(m => m.decision === "DEDUPE").length}; set to null (released): ${act.filter(m => m.decision === "RELEASE").length}`, "",
    "HELD (no change):", ...meters.filter(m => m.decision === "HOLD").map(m => `  ${m.salesId} ${m.reason} ${m.address || ""} :: ${m.rows.map(r => `${r.rowId.slice(-11)} ${r.status} ${r.holder}`).join(" | ")}`), "",
    "RELEASED FROM ALL BATCHES:", ...act.filter(m => m.decision === "RELEASE").map(m => `  ${m.salesId} ${m.address || ""} :: ${m.rows.map(r => `${r.rowId.slice(-11)} ${r.holder}`).join(" | ")}${m.sameErfOrAddress?.length ? `\n      same ERF: ${m.sameErfOrAddress.join("; ")}` : ""}`), "",
    "OWNER CHOSEN (owner row kept, other rows removed):", ...act.filter(m => m.decision === "DEDUPE").map(m => `  ${m.salesId} ${m.visible ? "VISIBLE" : m.salesStatusBefore} -> ${m.ownerTbId.slice(-4)} (${m.rows.find(r => r.tbId === m.ownerTbId)?.holder}, ${m.rows.find(r => r.tbId === m.ownerTbId)?.status}) ${m.ownerRule}; removes ${m.removals.map(r => `${r.rowId.slice(-11)}${r.startedException ? " [approved started row]" : ""} (${m.rows.find(x => x.rowId === r.rowId)?.holder})`).join(", ")}`), "",
    "BATCHES THAT LOSE ROWS:", ...Object.values(parents).map(p => `  ${p.tbId.slice(4)} ${p.holder} ${p.status}/${p.executionStatus} rows ${p.storedCounts.totalRows}->${p.countsAfter.totalRows} not started ${p.notStartedBefore}->${p.notStartedAfter} started ${p.storedCounts.executionStartedRows}->${p.countsAfter.executionStartedRows} completed ${p.storedCounts.completedRows}->${p.countsAfter.completedRows}${p.storedCountsMatchRows ? "" : " [stored counts differ from rows]"}${p.becomesCompleted ? " -> COMPLETED" : ""}${p.wouldEmpty ? " [WOULD BE EMPTY: meters held]" : ""}`)];
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------- archive (read-only)
async function archive() {
  const planned = readJson("plan.json");
  const docs = new Map();
  const add = snap => { if (snap.exists) docs.set(snap.ref.path, encode(snap.data())); };
  const addQuery = async query => (await query.get()).docs.forEach(add);
  const tbIds = new Set();
  await pool(planned.meters.filter(x => x.decision !== "NONE"), 8, async m => {
    const facts = await gatherFacts(async ref => { const snap = await ref.get(); if (snap.docs) snap.docs.forEach(add); else add(snap); return snap; }, m.salesId);
    Object.keys(facts.parents).forEach(id => tbIds.add(id));
    await addQuery(db.collection(`sales-all-meters/${m.salesId}/batchHistory`));
  });
  for (const tbId of [...tbIds].sort()) {
    add(await db.doc(`tb_uploads/${tbId}`).get());
    await addQuery(db.collection("tb_rows").where("tbId", "==", tbId));
    await addQuery(db.collection(`tb_uploads/${tbId}/history`));
  }
  await addQuery(db.collection("teams"));
  if (args["actor-uid"]) add(await db.doc(`users/${args["actor-uid"]}`).get());
  const body = JSON.stringify({ runId: planned.runId, project: args.project, archivedAt: new Date().toISOString(), documents: Object.fromEntries([...docs].sort()) });
  fs.writeFileSync(path.join(out, "archive.json"), body);
  const sha = (await import("node:crypto")).createHash("sha256").update(body).digest("hex");
  fs.writeFileSync(path.join(out, "archive.sha256"), `${sha}  archive.json\n`);
  console.log(`archived ${docs.size} documents (${tbIds.size} batches) to ${path.join(out, "archive.json")} sha256 ${sha}`);
}

// ---------------------------------------------------------------- seed (emulator only)
async function seed() {
  const { documents } = JSON.parse(fs.readFileSync(args.archive, "utf8"));
  const entries = Object.entries(documents);
  for (let i = 0; i < entries.length; i += 400) {
    const batch = db.batch();
    entries.slice(i, i + 400).forEach(([docPath, data]) => batch.set(db.doc(docPath), decode(data)));
    await batch.commit();
  }
  console.log(`seeded ${entries.length} documents into ${args.project}`);
}

// ---------------------------------------------------------------- apply (TB-R049, TB-R050)
async function apply() {
  const planned = readJson("plan.json");
  if (isLive && args["live-go"] !== planned.runId) throw new Error(`LIVE apply needs --live-go ${planned.runId}`);
  const actorSnap = await db.doc(`users/${args["actor-uid"]}`).get();
  const profile = actorSnap.data() || {};
  const actor = { uid: actorSnap.id, user: profile.profile?.displayName || profile.displayName || profile.name, role: profile.employment?.role || profile.profile?.employment?.role || profile.role };
  if (!actorSnap.exists || ![actor.uid, actor.user, actor.role].every(nonblank)) throw new Error("Actor user is missing a name or role");
  const only = args.meters ? new Set(args.meters.split(",")) : null;
  const selected = planned.meters.filter(m => ["DEDUPE", "RELEASE"].includes(m.decision) && (!only || only.has(m.salesId)));
  if (only && selected.length !== only.size) throw new Error(`Not every requested meter is an approved DEDUPE or RELEASE: ${[...only].filter(id => !selected.some(m => m.salesId === id)).join(", ")}`);
  fs.mkdirSync(path.join(out, "before"), { recursive: true });
  const resultsFile = path.join(out, "apply-results.jsonl");
  const latest = new Map((fs.existsSync(resultsFile) ? fs.readFileSync(resultsFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : []).map(r => [r.salesId, r.status]));
  const alreadyApplied = new Set([...latest].filter(([, status]) => status === "APPLIED").map(([id]) => id));
  const summary = {};
  for (const approved of selected) {
    if (alreadyApplied.has(approved.salesId)) { console.log(`SKIP    ${approved.salesId} already applied from this run folder`); continue; }
    let before = null;
    let result;
    try {
      result = await db.runTransaction(async tx => {
        const get = ref => tx.get(ref);
        // A retried commit that had in fact landed, or a run cut off after its commit: this run's history is already there.
        const first = approved.removals[0];
        const marker = await get(db.doc(`sales-all-meters/${approved.salesId}/batchHistory/${first.tbId}__${first.released ? "REMOVED_FROM_BATCH" : "ROW_REMOVED_NOT_RELEASED"}`));
        if (marker.exists && marker.data().removalAudit?.cleanupRunId === planned.runId) return { status: "APPLIED", appliedEarlier: true, decision: approved.decision, ownerTbId: approved.ownerTbId ?? null, removed: approved.removals.map(r => r.rowId), completedBatches: [] };
        const facts = await gatherFacts(get, approved.salesId);
        const p = planMeter(facts);
        // A skipped meter returns without writing, so its transaction commits empty and releases its read locks at once.
        const stale = detail => ({ status: "STALE", detail });
        if (fingerprint(facts) !== approved.fingerprint) return stale("The meter's records changed since the approved dry run");
        if (planSignature(p) !== planSignature(approved)) return stale(`The plan changed since the approved dry run: ${p.decision} ${p.reason || p.ownerTbId || ""}`);
        const removedIds = new Set(p.removals.map(r => r.rowId));
        const affected = [...new Set(p.removals.map(r => r.tbId))].sort();
        const parentRows = {};
        for (const tbId of affected) parentRows[tbId] = (await get(db.collection("tb_rows").where("tbId", "==", tbId))).docs.map(withId);
        const salesHistory = p.removals.map(r => ({ removal: r, ref: db.doc(`sales-all-meters/${p.salesId}/batchHistory/${r.tbId}__${r.released ? "REMOVED_FROM_BATCH" : "ROW_REMOVED_NOT_RELEASED"}`) }));
        const resolvedRef = p.decision === "DEDUPE" ? db.doc(`sales-all-meters/${p.salesId}/batchHistory/${p.ownerTbId}__MEMBERSHIP_RESOLVED`) : null;
        const parentHistoryRefs = p.removals.map(r => db.doc(`tb_uploads/${r.tbId}/history/ROW_REMOVED__${r.rowId}`));
        for (const ref of [...salesHistory.map(h => h.ref), resolvedRef, ...parentHistoryRefs].filter(Boolean)) if ((await get(ref)).exists) return stale(`History already exists: ${ref.path}`);
        const emptied = affected.find(tbId => !parentRows[tbId].some(r => !removedIds.has(r.id)));
        if (emptied) return stale(`Batch ${emptied} would be left with no rows`);
        before = { facts, parentCounts: Object.fromEntries(affected.map(tbId => [tbId, { counts: facts.parents[tbId].counts, status: facts.parents[tbId].status, execution: facts.parents[tbId].execution }])) };

        const at = FieldValue.serverTimestamp();
        const runId = planned.runId;
        const { sales } = facts;
        const refsBefore = sales.tbRefs;
        const removedTbIds = new Set(p.removals.map(r => r.tbId));
        const refsAfter = refsBefore.filter(ref => !removedTbIds.has(readTbRefBatchId(ref)));
        if (refsAfter.length !== refsBefore.length - removedTbIds.size) throw new Error("tbRefs removal mismatch");
        // The helper validates the Sales metadata contract; the time written is the server's.
        const metadataPatch = { ...buildSalesAllMetersOperationalMetadataPatch({ existing: sales, operationTimestamp: Timestamp.now(), actorUid: actor.uid, actorUser: actor.user }), "metadata.updatedAt": at };
        const parentPlans = affected.map(tbId => {
          const parent = facts.parents[tbId];
          const remaining = parentRows[tbId].filter(r => !removedIds.has(r.id));
          const countsAfter = countRows(remaining);
          const completes = removalCompletesBatch(parentRows[tbId], remaining);
          const patch = { ...Object.fromEntries(COUNT_KEYS.map(k => [`counts.${k}`, countsAfter[k]])), "metadata.updatedAt": at, "metadata.updatedByUid": actor.uid, "metadata.updatedByUser": actor.user };
          if (completes) Object.assign(patch, { status: "COMPLETED", "execution.status": "COMPLETED", "execution.completedAt": at });
          return { tbId, parent, patch, countsAfter, completes };
        });

        // Writes: nothing above this line has written.
        const ownerParent = p.ownerTbId ? facts.parents[p.ownerTbId] : null;
        const ownerRow = p.ownerRowId ? facts.rows.find(r => r.id === p.ownerRowId) : null;
        const eventBase = { schemaVersion: 1, salesId: p.salesId, membershipBefore: null, membershipSource: "LEGACY_TBREFS", actor: { uid: actor.uid, user: actor.user, role: actor.role }, occurredAt: at, salesMeterStatus: p.salesStatusBefore, erfResolutionRevision: sales.erfResolution?.revision ?? null };
        for (const { removal, ref } of salesHistory) {
          const row = facts.rows.find(r => r.id === removal.rowId), parent = facts.parents[removal.tbId];
          const removedTbRef = refsBefore.find(x => readTbRefBatchId(x) === removal.tbId);
          tx.create(ref, { ...eventBase, id: ref.id, idempotencyKey: ref.id, eventType: removal.released ? "REMOVED_FROM_BATCH" : "ROW_REMOVED_NOT_RELEASED", tbId: removal.tbId, rowId: removal.rowId,
            geofenceId: parent.geofenceId ?? null, erfId: row.refs?.erfId ?? null, membershipAfter: removal.released ? null : p.ownerTbId,
            reason: removal.released ? "UNTOUCHED_IN_SEVERAL_BATCHES" : "DUPLICATE_OF_OWNER_BATCH",
            removalAudit: { parentStatus: parent.status, rowExecutionStatus: row.execution?.status || "NOT_STARTED", salesMeterStatus: p.salesStatusBefore, parentAllocation: parent.allocation, parentAcceptance: parent.acceptance ?? null, rowAllocation: row.allocation, removedTbRef, cleanupRunId: runId, ownerTbId: p.ownerTbId, ownerRule: p.ownerRule } });
        }
        if (resolvedRef) tx.create(resolvedRef, { ...eventBase, id: resolvedRef.id, idempotencyKey: resolvedRef.id, eventType: "MEMBERSHIP_RESOLVED", tbId: p.ownerTbId, rowId: p.ownerRowId,
          geofenceId: ownerParent.geofenceId ?? null, erfId: ownerRow.refs?.erfId ?? null, membershipAfter: p.ownerTbId, reason: p.ownerRule,
          resolutionAudit: { cleanupRunId: runId, ownerRule: p.ownerRule, tbRefIdsBefore: refsBefore.map(readTbRefBatchId), removedRowIds: p.removals.map(r => r.rowId) } });
        tx.update(db.doc(`sales-all-meters/${p.salesId}`), { tbRefs: refsAfter, targetedBatchId: p.targetedBatchIdAfter, ...metadataPatch });
        for (const removal of p.removals) tx.delete(db.doc(`tb_rows/${removal.rowId}`));
        for (const pp of parentPlans) tx.update(db.doc(`tb_uploads/${pp.tbId}`), pp.patch);
        p.removals.forEach((removal, i) => {
          const pp = parentPlans.find(x => x.tbId === removal.tbId);
          const row = facts.rows.find(r => r.id === removal.rowId);
          tx.create(parentHistoryRefs[i], { event: "TARGETED_BATCH_ROW_REMOVED", tbId: removal.tbId, rowId: removal.rowId, rowNo: removal.rowNo, salesId: p.salesId, released: removal.released,
            ownerTbId: p.ownerTbId, ownerRule: p.ownerRule, reason: removal.released ? "UNTOUCHED_IN_SEVERAL_BATCHES" : "DUPLICATE_OF_OWNER_BATCH", approvedStartedRow: removal.startedException,
            countsBefore: Object.fromEntries(COUNT_KEYS.map(k => [k, pp.parent.counts?.[k] ?? null])), countsAfter: pp.countsAfter,
            statusBefore: { status: pp.parent.status, execution: pp.parent.execution?.status ?? null }, statusAfter: pp.completes ? { status: "COMPLETED", execution: "COMPLETED" } : { status: pp.parent.status, execution: pp.parent.execution?.status ?? null },
            removedRow: (({ id, idConflict, ...data }) => ({ ...data, id }))(row), runId, rulesVersion: RULES_VERSION,
            note: removal.released ? `Meter ${p.salesId} was untouched in several batches and is released from all of them (rules ${RULES_VERSION}, TB-R049/TB-R050)` : `Meter ${p.salesId} belongs to ${p.ownerTbId} (${p.ownerRule}); this duplicate row is removed and the meter is not released (rules ${RULES_VERSION}, TB-R049/TB-R050)`,
            actor: { uid: actor.uid, name: actor.user, role: actor.role },
            metadata: { createdAt: at, createdByUid: actor.uid, createdByUser: actor.user, updatedAt: at, updatedByUid: actor.uid, updatedByUser: actor.user } });
        });
        return { status: "APPLIED", decision: p.decision, ownerTbId: p.ownerTbId, removed: p.removals.map(r => r.rowId), completedBatches: parentPlans.filter(x => x.completes).map(x => x.tbId) };
      });
    } catch (error) {
      // Anything unexpected stops the run: the meter's transaction wrote nothing, and nothing after it runs.
      fs.appendFileSync(resultsFile, JSON.stringify({ salesId: approved.salesId, status: "ERROR", error: error.message, at: new Date().toISOString() }) + "\n");
      console.error(`ERROR ${approved.salesId}: ${error.stack}`);
      summary.ERROR = (summary.ERROR || 0) + 1;
      break;
    }
    fs.appendFileSync(resultsFile, JSON.stringify({ salesId: approved.salesId, ...result, at: new Date().toISOString() }) + "\n");
    if (before && result.status === "APPLIED" && !result.appliedEarlier) fs.writeFileSync(path.join(out, "before", `${approved.salesId}.json`), JSON.stringify(encode(before)));
    summary[result.status] = (summary[result.status] || 0) + 1;
    console.log(`${result.status.padEnd(7)} ${approved.salesId} ${result.decision || ""} ${result.ownerTbId || ""} ${result.detail || (result.removed || []).join(",")}${result.completedBatches?.length ? ` completed ${result.completedBatches.join(",")}` : ""}`);
  }
  console.log(`apply summary: ${JSON.stringify(summary)}`);
}

// ---------------------------------------------------------------- verify (read-only)
async function verify() {
  const planned = readJson("plan.json");
  const results = fs.existsSync(path.join(out, "apply-results.jsonl")) ? fs.readFileSync(path.join(out, "apply-results.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  const latest = new Map(results.map(r => [r.salesId, r]));
  const applied = [...latest.values()].filter(r => r.status === "APPLIED");
  const appliedIds = new Set(applied.map(r => r.salesId));
  const problems = [];
  // The archive is the before state: what the correction must not have changed is compared with it.
  const archived = fs.existsSync(path.join(out, "archive.json")) ? JSON.parse(fs.readFileSync(path.join(out, "archive.json"), "utf8")).documents : null;
  const was = docPath => (archived?.[docPath] ? decode(archived[docPath]) : null);
  const sortKeys = v => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v);
  const same = (a, b) => JSON.stringify(sortKeys(encode(a ?? null))) === JSON.stringify(sortKeys(encode(b ?? null)));
  const historyOk = async (docPath, expect) => {
    const snap = await db.doc(docPath).get();
    if (!snap.exists) return `${docPath} missing`;
    const h = snap.data();
    const bad = Object.entries(expect).filter(([k, v]) => k.split(".").reduce((o, key) => o?.[key], h) !== v).map(([k, v]) => `${k}=${JSON.stringify(k.split(".").reduce((o, key) => o?.[key], h))} expected ${JSON.stringify(v)}`);
    return bad.length ? `${docPath}: ${bad.join(", ")}` : null;
  };
  const [rowsSnap, parentsSnap, salesSnap] = await Promise.all([db.collection("tb_rows").where("scope.lmPcode", "==", LM).get(), db.collection("tb_uploads").where("scope.lmPcode", "==", LM).get(), db.collection("sales-all-meters").where("lmPcode", "==", LM).select("tbRefs").get()]);
  const rows = rowsSnap.docs.map(withId);
  const rowIds = new Set(rows.map(r => r.id));
  const byMeter = new Map(); rows.forEach(r => (byMeter.get(r.salesAllMeterId) || byMeter.set(r.salesAllMeterId, []).get(r.salesAllMeterId)).push(r));
  const multiRows = [...byMeter].filter(([, list]) => new Set(list.map(r => r.tbId)).size > 1).map(([id]) => id).sort();
  const multiRefs = salesSnap.docs.filter(d => Array.isArray(d.data().tbRefs) && new Set(d.data().tbRefs.map(readTbRefBatchId)).size > 1).map(d => d.id).sort();

  // 1. Every applied meter now has exactly what the plan said, and passes the production membership check.
  for (const m of planned.meters.filter(x => appliedIds.has(x.salesId))) {
    const sales = (await db.doc(`sales-all-meters/${m.salesId}`).get()).data();
    const mine = byMeter.get(m.salesId) || [];
    const membership = resolveSalesTargetedBatchMembership(sales);
    const leftover = (sales.tbRefs || []).map(readTbRefBatchId).filter(tbId => m.removals.some(r => r.tbId === tbId));
    if (leftover.length) problems.push(`${m.salesId}: tbRefs still name removed batches ${leftover.join(",")}`);
    for (const r of m.removals) {
      const event = r.released ? "REMOVED_FROM_BATCH" : "ROW_REMOVED_NOT_RELEASED";
      for (const issue of [
        await historyOk(`sales-all-meters/${m.salesId}/batchHistory/${r.tbId}__${event}`, { eventType: event, tbId: r.tbId, rowId: r.rowId, membershipBefore: null, membershipAfter: r.released ? null : m.ownerTbId, membershipSource: "LEGACY_TBREFS", "removalAudit.cleanupRunId": planned.runId }),
        await historyOk(`tb_uploads/${r.tbId}/history/ROW_REMOVED__${r.rowId}`, { event: "TARGETED_BATCH_ROW_REMOVED", salesId: m.salesId, released: r.released, runId: planned.runId, "removedRow.id": r.rowId }),
      ]) if (issue) problems.push(issue);
    }
    if (m.decision === "DEDUPE") {
      const issue = await historyOk(`sales-all-meters/${m.salesId}/batchHistory/${m.ownerTbId}__MEMBERSHIP_RESOLVED`, { eventType: "MEMBERSHIP_RESOLVED", tbId: m.ownerTbId, rowId: m.ownerRowId, membershipBefore: null, membershipAfter: m.ownerTbId, reason: m.ownerRule, "resolutionAudit.cleanupRunId": planned.runId });
      if (issue) problems.push(issue);
      if (archived) {
        const ownerRowNow = mine.find(r => r.id === m.ownerRowId), ownerRowWas = was(`tb_rows/${m.ownerRowId}`);
        if (!ownerRowNow || !same({ ...ownerRowNow, id: undefined, idConflict: undefined }, { ...ownerRowWas, id: undefined })) problems.push(`${m.salesId}: owner row ${m.ownerRowId} differs from the archive (field work since, or a wrong write)`);
        const refNow = (sales.tbRefs || []).find(x => readTbRefBatchId(x) === m.ownerTbId), refWas = (was(`sales-all-meters/${m.salesId}`)?.tbRefs || []).find(x => readTbRefBatchId(x) === m.ownerTbId);
        if (!same(refNow, refWas)) problems.push(`${m.salesId}: owner tbRef differs from the archive (field work since, or a wrong write)`);
      }
      if (mine.length !== 1 || mine[0].id !== m.ownerRowId) problems.push(`${m.salesId}: rows ${mine.map(r => r.id).join(",")} instead of only ${m.ownerRowId}`);
      if (membership.state !== "MEMBER" || membership.tbId !== m.ownerTbId || membership.source !== "SCALAR") problems.push(`${m.salesId}: membership ${JSON.stringify(membership)}`);
      try { assertSalesBatchExecutionMembership(sales, m.ownerTbId); } catch (e) { problems.push(`${m.salesId}: production membership check refuses ${m.ownerTbId}: ${e.code}`); }
      for (const tbId of m.removals.map(r => r.tbId)) if (m.salesId && !(await db.doc(`sales-all-meters/${m.salesId}/batchHistory/${tbId}__ROW_REMOVED_NOT_RELEASED`).get()).exists) problems.push(`${m.salesId}: history missing for ${tbId}`);
      if (!(await db.doc(`sales-all-meters/${m.salesId}/batchHistory/${m.ownerTbId}__MEMBERSHIP_RESOLVED`).get()).exists) problems.push(`${m.salesId}: MEMBERSHIP_RESOLVED missing`);
    } else {
      if (mine.length) problems.push(`${m.salesId}: released but still has rows ${mine.map(r => r.id).join(",")}`);
      if (sales.targetedBatchId !== null || membership.state !== "NONE" || classifySalesWorkStatus(sales) !== "NOT_STARTED") problems.push(`${m.salesId}: release state ${JSON.stringify({ targetedBatchId: sales.targetedBatchId, membership, status: classifySalesWorkStatus(sales) })}`);
      for (const tbId of m.removals.map(r => r.tbId)) if (!(await db.doc(`sales-all-meters/${m.salesId}/batchHistory/${tbId}__REMOVED_FROM_BATCH`).get()).exists) problems.push(`${m.salesId}: history missing for ${tbId}`);
    }
  }
  // 2. Every parent's counts equal its rows.
  const removed = new Set(applied.flatMap(a => a.removed));
  const touchedTbIds = [...new Set(planned.meters.filter(m => appliedIds.has(m.salesId)).flatMap(m => m.removals.map(r => r.tbId)))].sort();
  const drift = [];
  for (const parent of parentsSnap.docs.map(withId)) {
    const counts = countRows(rows.filter(r => r.tbId === parent.id));
    const bad = COUNT_KEYS.filter(k => parent.counts?.[k] !== counts[k]);
    if (bad.length) drift.push(`${parent.id}: ${bad.map(k => `${k} ${parent.counts?.[k]}!=${counts[k]}`).join(" ")}`);
    if (!touchedTbIds.includes(parent.id)) continue;
    const target = completionTarget(counts);
    if (target > 0 && counts.completedRows >= target && parent.status !== "COMPLETED") drift.push(`${parent.id}: every row completed but status ${parent.status}`);
    if (parent.schemaVersion !== LEGACY_SCHEMA) drift.push(`${parent.id}: not an old batch`);
    const parentWas = was(`tb_uploads/${parent.id}`);
    if (archived && parentWas) {
      const completedByRun = planned.parents?.[parent.id]?.becomesCompleted === true;
      for (const key of ["allocation", "acceptance", "creation", "selection", "schemaVersion", "scope"]) if (!same(parent[key], parentWas[key])) drift.push(`${parent.id}: ${key} differs from the archive`);
      if (!completedByRun && (!same(parent.status, parentWas.status) || !same(parent.execution, parentWas.execution))) drift.push(`${parent.id}: status/execution differ from the archive (${parentWas.status}/${parentWas.execution?.status} -> ${parent.status}/${parent.execution?.status})`);
    }
  }
  // 3. Nothing points at a removed row, except the approved No Access visit of J68S_000055.
  const dangling = [];
  for (let i = 0; i < touchedTbIds.length; i += 30) {
    for (const collection of ["trns", "premises"]) {
      const snap = await db.collection(collection).where("targetedBatchContext.tbId", "in", touchedTbIds.slice(i, i + 30)).get();
      snap.docs.forEach(d => { const rowId = d.data().targetedBatchContext?.rowId; if (rowId && !rowIds.has(rowId)) dangling.push(`${collection}/${d.id} -> ${rowId}`); });
    }
  }
  for (const s of salesSnap.docs) for (const ref of s.data().tbRefs || []) if (ref?.rowId && removed.has(ref.rowId)) dangling.push(`sales-all-meters/${s.id} tbRef rowId -> ${ref.rowId}`);
  const allowedDangling = new Set(["trns/TRN_MDIS_1789122272479_NA_2HGJP -> TBR_20260814_105246_J68S_000055"]);
  const held = planned.meters.filter(m => m.decision === "HOLD").map(m => m.salesId);
  const notApplied = planned.meters.filter(m => ["DEDUPE", "RELEASE"].includes(m.decision) && !appliedIds.has(m.salesId)).map(m => m.salesId);
  const unexpectedMulti = [...new Set([...multiRows, ...multiRefs])].filter(id => !held.includes(id) && !notApplied.includes(id));
  const lines = [
    `verify ${planned.runId} on ${args.project}: applied meters ${appliedIds.size}, held ${held.length}, planned but not applied ${notApplied.length}${notApplied.length ? ` (${notApplied.join(",")})` : ""}; archive ${archived ? "compared" : "NOT FOUND (owner rows and parents not compared)"}`,
    `meters with rows in 2+ batches now: ${multiRows.length} ${multiRows.join(",")}`,
    `meters whose tbRefs name 2+ batches now: ${multiRefs.length} ${multiRefs.join(",")}`,
    `unexpected multi-batch meters (not held, not pending): ${unexpectedMulti.length} ${unexpectedMulti.join(",")}`,
    `applied-meter problems: ${problems.length}`, ...problems.map(p => `  ${p}`),
    `parents checked ${parentsSnap.size}; count or completion drift: ${drift.length}`, ...drift.map(d => `  ${d}`),
    `references to removed rows: ${dangling.length} (allowed ${dangling.filter(d => allowedDangling.has(d)).length})`, ...dangling.map(d => `  ${d}${allowedDangling.has(d) ? " [approved]" : ""}`),
  ];
  const ok = !unexpectedMulti.length && !problems.length && !drift.length && dangling.every(d => allowedDangling.has(d));
  lines.push(ok ? "VERIFY PASS" : "VERIFY FAIL");
  fs.writeFileSync(path.join(out, `verify-${Date.now()}.txt`), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  if (!ok) process.exitCode = 1;
}

// ---------------------------------------------------------------- restore one meter from its before-image (rollback)
async function restore() {
  // A LIVE rollback would need its own reviewed step (re-read in the transaction, compensating history), with the owner's go.
  if (isLive) throw new Error("restore is an emulator rehearsal only");
  const planned = readJson("plan.json");
  for (const salesId of args.meters.split(",")) {
    const before = decode(JSON.parse(fs.readFileSync(path.join(out, "before", `${salesId}.json`), "utf8")));
    const m = planned.meters.find(x => x.salesId === salesId);
    await db.runTransaction(async tx => {
      const affected = [...new Set(m.removals.map(r => r.tbId))];
      const parentRows = {};
      for (const tbId of affected) parentRows[tbId] = (await tx.get(db.collection("tb_rows").where("tbId", "==", tbId))).docs.map(withId);
      const restoredRows = before.facts.rows.filter(r => m.removals.some(x => x.rowId === r.id));
      for (const row of restoredRows) { const { idConflict, ...data } = row; tx.set(db.doc(`tb_rows/${row.id}`), data); }
      const sales = before.facts.sales;
      tx.update(db.doc(`sales-all-meters/${salesId}`), { tbRefs: sales.tbRefs, targetedBatchId: FieldValue.delete(), "metadata.updatedAt": sales.metadata.updatedAt, "metadata.updatedByUid": sales.metadata.updatedByUid, "metadata.updatedByUser": sales.metadata.updatedByUser });
      for (const tbId of affected) {
        const counts = countRows([...parentRows[tbId], ...restoredRows.filter(r => r.tbId === tbId)]);
        const was = before.parentCounts[tbId];
        tx.update(db.doc(`tb_uploads/${tbId}`), { ...Object.fromEntries(COUNT_KEYS.map(k => [`counts.${k}`, counts[k]])), status: was.status, execution: was.execution });
      }
    });
    fs.appendFileSync(path.join(out, "apply-results.jsonl"), JSON.stringify({ salesId, status: "RESTORED", at: new Date().toISOString() }) + "\n");
    console.log(`restored ${salesId}`);
  }
}

const modes = { plan, archive, seed, apply, verify, restore };
if (!modes[mode]) throw new Error(`Unknown mode ${mode}`);
await modes[mode]();
process.exit(process.exitCode || 0);
