// DEV only. Read-only by default; --apply-links repairs only derived premise links.
import { readFileSync, writeFileSync } from "node:fs";
import { initializeApp, cert, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { reconcilePremiseNoAccess } from "../noAccess/reconcile.js";

const keyPath = process.argv[process.argv.indexOf("--credential") + 1];
if (!process.argv.includes("--credential") || !keyPath) throw new Error("An explicit DEV credential path is required.");
const key = JSON.parse(readFileSync(keyPath, "utf8"));
if (key.project_id !== "ireps2") throw new Error("This audit is restricted to DEV ireps2.");
const app = initializeApp({ credential: cert(key), projectId: "ireps2" });
try {
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  const [premises, visits] = await Promise.all([
    db.collection("premises").select("noAccessTrnIds").get(),
    db.collection("trns").where("accessData.access.hasAccess", "==", "no").get(),
  ]);
  const expected = new Map();
  const defects = { visits: visits.size, missingPremise: 0, missingCaptureTime: 0, missingAstReferenceOnLifecycle: 0, contradictoryOutcome: 0, workBlockPresent: 0 };
  for (const doc of visits.docs) {
    const trn = doc.data();
    const premiseId = trn.accessData?.premise?.id;
    if (!premiseId || premiseId === "NAv") defects.missingPremise++;
    else { if (!expected.has(premiseId)) expected.set(premiseId, []); expected.get(premiseId).push(doc.id); }
    if (!trn.metadata?.createdOnDevice) defects.missingCaptureTime++;
    if (!["METER_DISCOVERY", "METER_INSTALLATION"].includes(trn.accessData?.trnType) && !trn.ast?.astData?.astId) defects.missingAstReferenceOnLifecycle++;
    if (trn.executionOutcome?.success === true) defects.contradictoryOutcome++;
    if (["inspection", "disconnection", "reconnection", "removal", "meterReading", "discovery", "installation"].some((key) => key in trn)) defects.workBlockPresent++;
  }
  const drift = premises.docs.filter((doc) => JSON.stringify([...(doc.data().noAccessTrnIds || [])].sort()) !== JSON.stringify([...(expected.get(doc.id) || [])].sort()));
  const apply = process.argv.includes("--apply-links");
  if (apply && drift.length) {
    writeFileSync(`no-access-links-backup-${Date.now()}.local`, JSON.stringify(drift.map((doc) => ({ id: doc.id, ...doc.data() })), null, 2));
    for (const doc of drift) await reconcilePremiseNoAccess(db, doc.id);
  }
  console.log(JSON.stringify({ project: "ireps2", mode: apply ? "REPAIR_DERIVED_LINKS" : "READ_ONLY", ...defects, premiseLinkDrift: drift.length, repaired: apply ? drift.length : 0,
    note: "Historical visit records were not changed. Missing capture times, appointments and references are not invented." }, null, 2));
} finally { await deleteApp(app); }
