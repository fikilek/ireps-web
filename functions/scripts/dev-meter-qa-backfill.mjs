import admin from "firebase-admin";
import { calculateTbQaStatus } from "../qa/premiseQaReview.js";

const projectId = process.env.FIREBASE_PROJECT_ID || "ireps2";
admin.initializeApp({ projectId });
const db = admin.firestore();

async function backfillMeterQa() {
  console.log(`Starting Meter QA backfill on ${projectId}...`);
  const snap = await db.collection("tb_rows").where("execution.status", "==", "COMPLETED").get();
  console.log(`Found ${snap.size} completed tb_rows.`);

  let updated = 0;
  for (const doc of snap.docs) {
    const row = doc.data();
    const meterId = row.refs?.meterId || row.refs?.trnId;
    if (!meterId) continue;

    // Check TRN for actual QA status
    let effectiveMeterStatus = "QA_PENDING";
    try {
      const trnSnap = await db.collection("trns").doc(meterId).get();
      if (trnSnap.exists) {
        const trn = trnSnap.data();
        if (trn.qa?.state) {
          effectiveMeterStatus = trn.qa.state === "PASS" ? "QA_PASS" : trn.qa.state === "FAIL" ? "QA_FAIL" : "QA_PENDING";
        }
      }
    } catch (e) {
      console.warn(`Could not fetch TRN ${meterId}:`, e.message);
    }

    const effectiveTbStatus = calculateTbQaStatus(row.qa?.premiseStatus, effectiveMeterStatus, "COMPLETED");

    if (row.qa?.meterStatus !== effectiveMeterStatus || row.qa?.tbStatus !== effectiveTbStatus) {
      console.log(`Updating row ${doc.id}: meterStatus=${effectiveMeterStatus}, tbStatus=${effectiveTbStatus}`);
      await doc.ref.update({
        "qa.meterStatus": effectiveMeterStatus,
        "qa.tbStatus": effectiveTbStatus,
        "metadata.updatedAt": new Date().toISOString(),
      });
      updated++;
    }
  }

  console.log(`Finished! Updated ${updated} tb_rows.`);
}

backfillMeterQa().catch(console.error);
