import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID || "ireps2";
initializeApp({ projectId });
const db = getFirestore();

const LM_PCODE = "ZA5241";
const MONTHS = ["2026-06", "2026-07", "2026-08"];
const COLLECTION_NAME = "report_electricity_population";
const PIPELINE_MILESTONE_DIR =
  "C:\\dev\\ireps-pipeline-sales\\output\\logs\\three_month_milestone__20260905";

function formatMonthLabel(monthKey) {
  const [yearStr, monthStr] = String(monthKey || "").split("-");
  const year = Number(yearStr);
  const monthNumber = Number(monthStr);
  if (!year || !monthNumber) return monthKey;
  return new Intl.DateTimeFormat("en-ZA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function loadSupplierMembersByMonth() {
  const result = {};
  for (const m of MONTHS) {
    const filePath = path.join(PIPELINE_MILESTONE_DIR, `membership_evidence__${m}.json`);
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      result[m] = new Set(parsed.members || []);
    }
  }
  return result;
}

async function materializeRollups() {
  console.log(
    `Starting Electricity Meter Population (Original Vending v1.1.0) materialization on ${projectId} for ${LM_PCODE}...`,
  );

  const supplierMembersByMonth = loadSupplierMembersByMonth();

  const salesSnap = await db
    .collection("sales-all-meters")
    .where("lmPcode", "==", LM_PCODE)
    .select("monthlyCategories", "monthlySalesC", "monthlyUnits", "previousMeterNumber")
    .get();

  console.log(`Loaded ${salesSnap.size} sales-all-meters records.`);

  const docsById = new Map();
  for (const doc of salesSnap.docs) {
    docsById.set(doc.id, doc.data());
  }

  // Fallback if membership_evidence file is absent for any month: use classified meters
  for (const m of MONTHS) {
    if (!supplierMembersByMonth[m] || supplierMembersByMonth[m].size === 0) {
      const fallbackSet = new Set();
      for (const [mid, d] of docsById.entries()) {
        if (d.monthlyCategories?.[m]) fallbackSet.add(mid);
      }
      supplierMembersByMonth[m] = fallbackSet;
    }
  }

  // Compute month-to-month movements on the supplier vending list using PreviousMeterNumber for replacements
  const movementsByMonth = {};
  for (let i = 0; i < MONTHS.length; i++) {
    const m = MONTHS[i];
    const currentSet = supplierMembersByMonth[m];
    if (i === 0) {
      movementsByMonth[m] = {
        unchanged: currentSet.size,
        new: 0,
        replacements: 0,
        removed: 0,
      };
      continue;
    }
    const prevSet = supplierMembersByMonth[MONTHS[i - 1]];
    let unchanged = 0;
    const entered = [];
    for (const mid of currentSet) {
      if (prevSet.has(mid)) {
        unchanged++;
      } else {
        entered.push(mid);
      }
    }
    const exitedSet = new Set();
    for (const mid of prevSet) {
      if (!currentSet.has(mid)) exitedSet.add(mid);
    }

    // A newly entered supplier meter is a replacement if its previousMeterNumber is in the prior baseline
    let replacements = 0;
    const matchedPredecessors = new Set();
    for (const mid of entered) {
      const d = docsById.get(mid) || {};
      const prevNo = String(d.previousMeterNumber || "").trim();
      const prevNorm = prevNo.replace(/^0+/, "");
      let matched = null;
      if (prevNo && exitedSet.has(prevNo) && !matchedPredecessors.has(prevNo)) {
        matched = prevNo;
      } else if (prevNorm) {
        for (const exId of exitedSet) {
          if (exId.replace(/^0+/, "") === prevNorm && !matchedPredecessors.has(exId)) {
            matched = exId;
            break;
          }
        }
      }
      if (matched) {
        replacements++;
        matchedPredecessors.add(matched);
      }
    }

    const newCount = entered.length - replacements;
    const removedCount = exitedSet.size - replacements;

    movementsByMonth[m] = {
      unchanged,
      new: newCount,
      replacements,
      removed: removedCount,
    };
  }

  const nowIso = new Date().toISOString();
  const batch = db.batch();

  for (const m of MONTHS) {
    const activeMembers = supplierMembersByMonth[m];
    const totalMeters = activeMembers.size;

    let buying = 0;
    let notBuying = 0;
    let salesTotalC = 0;
    let unitsTotalNum = 0;

    for (const mid of activeMembers) {
      const d = docsById.get(mid) || {};
      const amountC = Number(d.monthlySalesC?.[m] || 0);
      const units = Number(d.monthlyUnits?.[m] || 0);
      if (amountC > 0) {
        buying++;
        salesTotalC += amountC;
      } else {
        notBuying++;
      }
      if (Number.isFinite(units) && units > 0) {
        unitsTotalNum += units;
      }
    }

    const unitsTotal = Number(unitsTotalNum.toFixed(1));
    const buyingShare = totalMeters > 0 ? Number(((buying / totalMeters) * 100).toFixed(1)) : 0;
    const notBuyingShare =
      totalMeters > 0 ? Number(((notBuying / totalMeters) * 100).toFixed(1)) : 0;
    const avgSalesPerBuyingMeterC = buying > 0 ? Math.round(salesTotalC / buying) : 0;
    const avgUnitsPerBuyingMeter =
      buying > 0 ? Number((unitsTotal / buying).toFixed(1)) : 0;

    let normal = 0;
    let targeted = 0;
    for (const d of docsById.values()) {
      const catEntry = d.monthlyCategories?.[m];
      if (!catEntry) continue;
      const cat = String(catEntry.leakageCategory || "").trim();
      if (cat.toUpperCase().startsWith("NORMAL")) {
        normal++;
      } else if (/^CAT\s*[1-8]/i.test(cat)) {
        targeted++;
      }
    }
    const classifiedTotal = normal + targeted;
    const normalShare =
      classifiedTotal > 0 ? Number(((normal / classifiedTotal) * 100).toFixed(1)) : 0;
    const targetedShare =
      classifiedTotal > 0 ? Number(((targeted / classifiedTotal) * 100).toFixed(1)) : 0;

    const docId = `${LM_PCODE}_${m}`;
    const docRef = db.collection(COLLECTION_NAME).doc(docId);

    const docPayload = {
      id: docId,
      lmPcode: LM_PCODE,
      month: m,
      monthLabel: formatMonthLabel(m),
      totalMeters,
      movements: movementsByMonth[m],
      purchases: {
        buying,
        notBuying,
        buyingShare,
        notBuyingShare,
        salesTotalC,
        unitsTotal,
        avgSalesPerBuyingMeterC,
        avgUnitsPerBuyingMeter,
      },
      categories: {
        classifiedTotal,
        normal,
        targeted,
        normalShare,
        targetedShare,
      },
      metadata: {
        generatedAt: nowIso,
        updatedAt: nowIso,
        salesUpdatedAt: nowIso,
        schemaVersion: "1.1.0",
        source: "sales-all-meters + governed supplier vending snapshots",
      },
    };

    console.log(`Setting document ${docId}:`, JSON.stringify(docPayload, null, 2));
    batch.set(docRef, docPayload);
  }

  await batch.commit();
  console.log(`Successfully materialized ${MONTHS.length} monthly rollups into ${COLLECTION_NAME}!`);
}

materializeRollups()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Materialization failed:", err);
    process.exit(1);
  });
