import admin from "firebase-admin";

const projectId = process.env.FIREBASE_PROJECT_ID || "ireps2";
admin.initializeApp({ projectId });
const db = admin.firestore();

const LM_PCODE = "ZA5241";
const MONTHS = ["2026-06", "2026-07", "2026-08"];
const COLLECTION_NAME = "report_electricity_population";

async function materializeRollups() {
  console.log(`Starting Electricity Meter Population materialization on ${projectId} for ${LM_PCODE}...`);

  const [salesSnap, astSnap] = await Promise.all([
    db.collection("sales-all-meters")
      .where("lmPcode", "==", LM_PCODE)
      .select("monthlyCategories", "hasUsableGps", "HasUsableGps")
      .get(),
    db.collection("asts")
      .where("accessData.parents.lmPcode", "==", LM_PCODE)
      .get(),
  ]);

  console.log(`Loaded ${salesSnap.size} sales records and ${astSnap.size} field assets.`);

  // Field meters map: meterNo -> earliest foundMonth
  const fieldMeters = new Map();
  for (const doc of astSnap.docs) {
    const d = doc.data();
    if (String(d.meterType || "").toLowerCase() !== "electricity") continue;
    const mid = String(d.master?.id || "").trim();
    if (!mid) continue;
    let foundMonth = "2026-06";
    if (d.metadata?.createdAt) {
      const dt = d.metadata.createdAt.toDate ? d.metadata.createdAt.toDate() : new Date(d.metadata.createdAt);
      foundMonth = dt.toISOString().slice(0, 7);
    }
    const cur = fieldMeters.get(mid);
    if (!cur || foundMonth < cur) fieldMeters.set(mid, foundMonth);
  }

  const monthMeters = { "2026-06": new Set(), "2026-07": new Set(), "2026-08": new Set() };
  const monthData = {};

  for (const m of MONTHS) {
    monthData[m] = {
      onList: 0,
      normal: 0,
      targeted: 0,
      targetedWithGps: 0,
      targetedWithoutGps: 0,
      foundInField: 0,
    };
  }

  for (const doc of salesSnap.docs) {
    const mid = doc.id;
    const d = doc.data();
    const monthlyCats = d.monthlyCategories || {};
    const hasGps = d.hasUsableGps === true || d.HasUsableGps === true;

    for (const m of MONTHS) {
      const catEntry = monthlyCats[m];
      if (!catEntry) continue;
      monthMeters[m].add(mid);
      monthData[m].onList++;

      const cat = String(catEntry.leakageCategory || "").trim();
      const isNorm = cat.toUpperCase().startsWith("NORMAL");
      const isTarg = /^CAT\s*[1-8]/i.test(cat);

      if (isNorm) {
        monthData[m].normal++;
      } else if (isTarg) {
        monthData[m].targeted++;
        if (hasGps) monthData[m].targetedWithGps++;
        else monthData[m].targetedWithoutGps++;
      }
    }
  }

  // Calculate unlisted field meters
  for (const m of MONTHS) {
    const list = monthMeters[m];
    let found = 0;
    for (const [fMid, fMonth] of fieldMeters.entries()) {
      if (fMonth <= m && !list.has(fMid)) {
        found++;
      }
    }
    monthData[m].foundInField = found;
  }

  // Movements
  const m06 = monthMeters["2026-06"];
  const m07 = monthMeters["2026-07"];
  const m08 = monthMeters["2026-08"];

  const movements = {
    "2026-06": { unchanged: monthData["2026-06"].onList, new: 0, replacements: 0, removed: 0 },
    "2026-07": {
      unchanged: [...m07].filter((x) => m06.has(x)).length,
      new: [...m07].filter((x) => !m06.has(x)).length,
      replacements: 0,
      removed: [...m06].filter((x) => !m07.has(x)).length,
    },
    "2026-08": {
      unchanged: [...m08].filter((x) => m07.has(x)).length,
      new: [...m08].filter((x) => !m07.has(x)).length,
      replacements: 0,
      removed: [...m07].filter((x) => !m08.has(x)).length,
    },
  };

  const nowIso = new Date().toISOString();
  const batch = db.batch();

  for (const m of MONTHS) {
    const stats = monthData[m];
    const onList = stats.onList;
    const foundInField = stats.foundInField;
    const totalMeters = onList + foundInField;
    const normal = stats.normal;
    const targeted = stats.targeted;
    const targetedWithGps = stats.targetedWithGps;
    const targetedWithoutGps = stats.targetedWithoutGps;

    const onListShare = totalMeters > 0 ? Number(((onList / totalMeters) * 100).toFixed(1)) : 0;
    const foundInFieldShare = totalMeters > 0 ? Number(((foundInField / totalMeters) * 100).toFixed(1)) : 0;
    const normalShare = onList > 0 ? Number(((normal / onList) * 100).toFixed(1)) : 0;
    const targetedShare = onList > 0 ? Number(((targeted / onList) * 100).toFixed(1)) : 0;
    const withGpsShare = targeted > 0 ? Number(((targetedWithGps / targeted) * 100).toFixed(1)) : 0;
    const withoutGpsShare = targeted > 0 ? Number(((targetedWithoutGps / targeted) * 100).toFixed(1)) : 0;

    const docId = `${LM_PCODE}_${m}`;
    const docRef = db.collection(COLLECTION_NAME).doc(docId);

    const docPayload = {
      id: docId,
      lmPcode: LM_PCODE,
      month: m,
      totalMeters,
      sources: {
        onList,
        foundInField,
        onListShare,
        foundInFieldShare,
      },
      categories: {
        normal,
        targeted,
        normalShare,
        targetedShare,
      },
      targetedGps: {
        withGps: targetedWithGps,
        withoutGps: targetedWithoutGps,
        withGpsShare,
        withoutGpsShare,
      },
      movements: movements[m],
      metadata: {
        generatedAt: nowIso,
        updatedAt: nowIso,
        salesUpdatedAt: nowIso,
        source: "sales-all-meters + asts canonical materializer",
      },
    };

    console.log(`Setting document ${docId}:`, JSON.stringify(docPayload, null, 2));
    batch.set(docRef, docPayload, { merge: true });
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
