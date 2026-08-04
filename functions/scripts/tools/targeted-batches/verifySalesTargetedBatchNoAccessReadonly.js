import fs from "fs";
import path from "path";
import admin from "firebase-admin";

function argsOf(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`Expected --name value arguments; invalid token: ${key || "<missing>"}`);
    }
    result[key.slice(2)] = value;
  }
  return result;
}

function required(options, name) {
  const value = String(options[name] || "").trim();
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

function iso(value) {
  if (value?.toDate instanceof Function) return value.toDate().toISOString();
  return value ?? null;
}

function same(left, right) {
  return String(left || "").trim() === right;
}

function check(results, label, condition, evidence) {
  results.push({status: condition ? "PASS" : "FAIL", label, evidence});
}

async function main() {
  const options = argsOf(process.argv.slice(2));
  const projectId = required(options, "project-id");
  const serviceAccountPath = path.resolve(required(options, "service-account"));
  const ids = {
    tbId: required(options, "tb-id"),
    rowId: required(options, "row-id"),
    salesDocId: required(options, "sales-doc-id"),
    premiseId: required(options, "premise-id"),
    erfId: required(options, "erf-id"),
  };
  if (projectId !== "ireps2") throw new Error("DEV guard: --project-id must be ireps2.");
  const credential = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
  if (credential.project_id !== projectId) throw new Error("Service-account project mismatch.");

  console.log("Sales Targeted Batch No Access verification");
  console.log("Mode: READ ONLY; Firestore writes: 0");
  console.log(`Project: ${projectId}`);
  console.log(`Targets: ${JSON.stringify(ids)}`);
  const app = admin.initializeApp({credential: admin.credential.cert(credential), projectId},
    `tb-na-readonly-${Date.now()}`);
  const db = admin.firestore(app);
  const refs = {
    parent: db.collection("tb_uploads").doc(ids.tbId),
    row: db.collection("tb_rows").doc(ids.rowId),
    sales: db.collection("demo_sales_meters").doc(ids.salesDocId),
    premise: db.collection("premises").doc(ids.premiseId),
    erf: db.collection("ireps_erfs").doc(ids.erfId),
    registryErf: db.collection("registry_erfs").doc(ids.erfId),
  };
  const [parentSnap, rowSnap, salesSnap, premiseSnap, erfSnap, registryErfSnap, trnSnap] =
    await Promise.all([
      refs.parent.get(), refs.row.get(), refs.sales.get(), refs.premise.get(), refs.erf.get(),
      refs.registryErf.get(), db.collection("trns")
        .where("targetedBatchContext.rowId", "==", ids.rowId).get(),
    ]);
  const parent = parentSnap.data() || {};
  const row = rowSnap.data() || {};
  const sales = salesSnap.data() || {};
  const premise = premiseSnap.data() || {};
  const erf = erfSnap.data() || {};
  const registryErf = registryErfSnap.data() || {};
  const trns = trnSnap.docs.map((doc) => ({id: doc.id, ...doc.data()})).filter((trn) =>
    trn.sourceModule === "SALES_TARGETED_BATCH" &&
    same(trn.targetedBatchContext?.tbId, ids.tbId) &&
    same(trn.targetedBatchContext?.salesDocId, ids.salesDocId) &&
    same(trn.targetedBatchContext?.erfId, ids.erfId));
  const tbRefs = Array.isArray(sales.tbRefs) ? sales.tbRefs : [];
  const matchingTbRefs = tbRefs.filter((ref) => same(ref?.id, ids.tbId) &&
    same(ref?.rowId, ids.rowId));
  const noAccess = matchingTbRefs[0]?.fieldWork?.noAccess;
  const premiseTrnIds = Array.isArray(premise.noAccessTrnIds) ? premise.noAccessTrnIds : [];
  const results = [];

  check(results, "all six direct documents exist", [parentSnap, rowSnap, salesSnap, premiseSnap,
    erfSnap, registryErfSnap].every((snap) => snap.exists), {
    parent: parentSnap.exists, row: rowSnap.exists, sales: salesSnap.exists,
    premise: premiseSnap.exists, erf: erfSnap.exists, registryErf: registryErfSnap.exists,
  });
  check(results, "exactly three canonical matching TRNs", trns.length === 3 &&
    new Set(trns.map((trn) => trn.id)).size === 3 &&
    trns.every((trn) => trn.id.startsWith("TRN_MDIS_")), trns.map((trn) => trn.id));
  for (const trn of trns) {
    const gps = trn.location?.gps || {};
    check(results, `${trn.id} canonical evidence`,
      trn.accessData?.access?.hasAccess === "no" && same(trn.accessData?.erfId, ids.erfId) &&
      same(trn.accessData?.premise?.id, ids.premiseId) && trn.ast === null &&
      Boolean(trn.accessData?.access?.reason) &&
      Array.isArray(trn.media) && trn.media.some((item) => item?.tag === "noAccessPhoto" &&
        Boolean(item?.url || item?.uri)) && Number.isFinite(Number(gps.lat)) &&
      Number.isFinite(Number(gps.lng)) && Boolean(trn.capturedAt) &&
      Boolean(trn.metadata?.createdAt) && Boolean(trn.metadata?.createdByUid) &&
      Boolean(trn.metadata?.createdByUser), {
        outcome: trn.accessData?.access?.hasAccess, premiseId: trn.accessData?.premise?.id,
        ast: trn.ast, meterType: trn.meterType, capturedAt: iso(trn.capturedAt),
        recordedAt: iso(trn.metadata?.createdAt), actorUid: trn.metadata?.createdByUid,
        actorUser: trn.metadata?.createdByUser, reason: trn.accessData?.access?.reason,
        media: trn.media, location: trn.location,
      });
  }
  check(results, "one exact Sales tbRef with three ordered NA summaries",
    matchingTbRefs.length === 1 && matchingTbRefs[0]?.fieldWork?.status === "IN_PROGRESS" &&
    Array.isArray(noAccess) && noAccess.length === 3 &&
    noAccess.every((entry) => entry?.date && entry?.time && entry?.user) &&
    same(matchingTbRefs[0]?.fieldWork?.premiseId, ids.premiseId) &&
    matchingTbRefs[0]?.fieldWork?.meterId == null &&
    matchingTbRefs[0]?.fieldWork?.trnId == null &&
    matchingTbRefs[0]?.fieldWork?.discoveredMeterNo == null &&
    matchingTbRefs[0]?.fieldWork?.submittedAt == null, {matchingCount: matchingTbRefs.length,
      noAccess, geofenceRefs: sales.geofenceRefs ?? null});
  const expectedTrnIds = new Set(trns.map((trn) => trn.id));
  check(results, "premise contains each verified TRN exactly once", trns.length === 3 &&
    [...expectedTrnIds].every((id) => premiseTrnIds.filter((item) => item === id).length === 1),
  {noAccessTrnIds: premiseTrnIds, metadata: premise.metadata ?? null});
  check(results, "parent and row remain correctly in progress",
    parent.execution?.status === "IN_PROGRESS" && parent.counts?.executionStartedRows === 1 &&
    parent.counts?.completedRows === 0 && row.execution?.status === "IN_PROGRESS" &&
    same(row.refs?.premiseId, ids.premiseId) && row.refs?.meterId == null &&
    row.refs?.trnId == null, {parentExecution: parent.execution, parentCounts: parent.counts,
      parentMetadata: parent.metadata, rowExecution: row.execution, rowRefs: row.refs,
      rowMetadata: row.metadata});
  check(results, "ERF trigger-managed evidence is present",
    Boolean(erf.metadata?.updatedAt) && registryErf.counts?.trnsNa >= 3 &&
    registryErf.counts?.trnsTotal >= registryErf.counts?.trnsNa, {
      irepsErfMetadata: erf.metadata ?? null, registryErfCounts: registryErf.counts ?? null,
      registryErfMetadata: registryErf.metadata ?? null,
    });
  check(results, "no AST or meter linkage in targeted records",
    trns.every((trn) => trn.ast === null) && row.refs?.meterId == null && row.refs?.trnId == null,
  {trnAstValues: trns.map((trn) => ({id: trn.id, ast: trn.ast})), rowRefs: row.refs});

  console.log(`Documents read: ${6 + trnSnap.size} (6 direct + ${trnSnap.size} row TRNs)`);
  for (const result of results) console.log(`${result.status}: ${result.label}\n${JSON.stringify(result.evidence)}`);
  const failures = results.filter((result) => result.status === "FAIL");
  console.log(`FINAL ${failures.length ? "FAIL" : "PASS"}: ${results.length - failures.length}/${results.length} checks passed`);
  console.log("Firestore writes performed: 0");
  await app.delete();
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`FINAL FAIL: ${error?.stack || error}`);
  console.error("Firestore writes performed: 0");
  process.exitCode = 1;
});
