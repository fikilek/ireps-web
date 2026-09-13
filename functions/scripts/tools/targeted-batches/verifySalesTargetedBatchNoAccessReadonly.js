import fs from "node:fs";
import admin from "firebase-admin";
import { exactSalesTbRef, inspectSavedErfDecision, resolveSalesTargetedBatchMembership, isTimestamp, nonblank } from "../../../salesAllMeters/sales-batch-policy.js";
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
export function assessNoAccessEvidence({ parent, row, sales, visits, history, fence, expectedVisits, baseline, premise = null, historical = false }) {
  if (historical && parent.schemaVersion === "0.3.0") throw new Error("Historical demo mode cannot approve canonical batches");
  const exact = exactSalesTbRef(sales, parent.id), membership = resolveSalesTargetedBatchMembership(sales);
  const checks = {
    requestedCount: Number.isInteger(expectedVisits) && expectedVisits > 0,
    rowIdentity: row.tbId === parent.id && row.salesAllMeterId && row.refs?.erfId,
    linkedPremise: !row.refs?.premiseId || premise?.id === row.refs.premiseId,
    matchingMembership: membership.state === "MEMBER" && membership.tbId === parent.id,
    exactReference: exact.ok && exact.reference.rowId === row.id,
    count: exact.ok && exact.reference.fieldWork?.noAccess?.length === expectedVisits && visits.length === expectedVisits,
    execution: row.execution?.status === "IN_PROGRESS" && parent.execution?.status === "IN_PROGRESS",
    finalErfPairValid: inspectSavedErfDecision(sales).valid,
    historyRetained: historical || history?.eventType === "BATCHED" && history.tbId === parent.id && history.salesId === row.salesAllMeterId, fenceConsumed: historical || fence?.status === "ACTIVE" && fence?.targetedBatch?.linkState === "LINKED" && fence.targetedBatch.tbId === parent.id,
    evidence: visits.every(visit => visit.targetedBatchContext?.tbId === parent.id && visit.targetedBatchContext?.rowId === row.id && visit.targetedBatchContext?.salesDocId === row.salesAllMeterId && visit.targetedBatchContext?.erfId === row.refs?.erfId && visit.accessData?.access?.hasAccess === "no" && nonblank(visit.accessData.access.reason) && typeof visit.location?.gps?.lat === "number" && Number.isFinite(visit.location.gps.lat) && Math.abs(visit.location.gps.lat) <= 90 && typeof visit.location?.gps?.lng === "number" && Number.isFinite(visit.location.gps.lng) && Math.abs(visit.location.gps.lng) <= 180 && isTimestamp(visit.capturedAt) && visit.media?.some(media => media.tag === "noAccessPhoto" && /^(gs|https):\/\//.test(media.url || media.uri || ""))),
  };
  if (baseline) for (const key of ["targetedBatchId", "erfId", "erfResolution", "erfCandidates", "monthlyCategories"]) checks[`preserved:${key}`] = JSON.stringify(baseline[key]) === JSON.stringify(sales[key]);
  return { mode: historical ? "HISTORICAL_DEMO_READ_ONLY" : "CANONICAL_READ_ONLY", canonicalApproval: !historical, executableApproval: false, firestoreWrites: 0, checks, passed: Object.values(checks).every(Boolean), preservation: baseline ? "Compared against supplied before snapshot" : "No before snapshot supplied; preservation not independently established" };
}
async function main() {
  if (option("--project-id") !== "ireps2") throw new Error("Explicit DEV project ireps2 required");
  const count = Number(option("--expected-visits"));
  if (!Number.isInteger(count) || count < 1) throw new Error("--expected-visits must be a positive integer");
  const tbId = option("--tb-id"), rowId = option("--row-id"), salesId = option("--sales-doc-id"), keyFile = option("--service-account");
  if (![tbId,rowId,salesId,keyFile].every(Boolean)) throw new Error("Batch, row, Sales identity and explicit service account required");
  const credential = JSON.parse(fs.readFileSync(keyFile,"utf8"));
  if (credential.project_id !== "ireps2") throw new Error("Service account scope mismatch");
  const app = admin.initializeApp({ credential: admin.credential.cert(credential), projectId: "ireps2" },"tb-no-access-readonly");
  try {
    const db = admin.firestore(app), historical = process.argv.includes("--historical-demo");
    const salesCollection = historical ? "demo_sales_meters" : "sales-all-meters";
    const [p,w,s,h] = await Promise.all([db.doc(`tb_uploads/${tbId}`).get(),db.doc(`tb_rows/${rowId}`).get(),db.doc(`${salesCollection}/${salesId}`).get(),historical ? Promise.resolve({data:()=>null}) : db.doc(`sales-all-meters/${salesId}/batchHistory/${tbId}__BATCHED`).get()]);
    if (![p,w,s].every(doc => doc.exists)) throw new Error("Canonical parent, row or Sales document missing");
    const parent={...p.data(),id:p.id},row={...w.data(),id:w.id},sales=s.data();
    const [f,v]=await Promise.all([parent.geofenceId ? db.doc(`geo_fences/${parent.geofenceId}`).get() : Promise.resolve({data:()=>null}),db.collection("trns").where("targetedBatchContext.rowId","==",rowId).get()]);
    const premise = row.refs?.premiseId ? await db.doc(`premises/${row.refs.premiseId}`).get() : null;
    const baseline = option("--before-sales-json") ? JSON.parse(fs.readFileSync(option("--before-sales-json"),"utf8")) : null;
    const result=assessNoAccessEvidence({parent,row,sales,history:h.data(),fence:f.data(),visits:v.docs.map(doc=>doc.data()),expectedVisits:count,baseline,premise:premise?.exists ? {...premise.data(),id:premise.id} : null,historical});
    console.log(JSON.stringify(result,null,2)); if(!result.passed) process.exitCode=1;
  } finally { await app.delete(); }
}
if (process.argv[1]?.replaceAll("\\","/").endsWith("/verifySalesTargetedBatchNoAccessReadonly.js")) main().catch(error => { console.error(error.message); process.exitCode=1; });
