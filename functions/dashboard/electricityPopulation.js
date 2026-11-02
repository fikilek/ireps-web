import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

import { coordinateNumber, hasUsableSalesGps, pipelineCandidates } from "../salesAllMeters/sales-batch-policy.js";
import { buildElectricityPopulation, listPopulationMonths } from "./electricityPopulationModel.js";

// Electricity Meter Population rules EMP-R001 1.2.0: the counts are worked out here, from only
// the fields they need, so the page receives the monthly figures and never the records.
const MANAGEMENT_ROLES = new Set(["SPU", "ADM", "MNG", "SPV"]);
const AST_FIELDS = ["master.id", "meterType", "metadata.createdAt", "status.state"];
const SALES_FIELDS = [
  "monthlyCategories", "hasUsableGps", "HasUsableGps", "erfCandidates", "ErfCandidates",
  "metadata.updatedAt", "metadata.createdAt",
];
const OUT_OF_SERVICE_STATES = new Set(["REMOVED", "DECOMMISSIONED"]);
const MONTH_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Johannesburg",
  year: "numeric",
  month: "2-digit",
});
const workbaseId = (value) =>
  (typeof value === "string" ? value : value?.id || value?.pcode || value?.lmPcode || "");

export function monthInJohannesburg(value) {
  const date = value && typeof value.toDate === "function"
    ? value.toDate()
    : value instanceof Date
      ? value
      : typeof value === "string" && value.trim()
        ? new Date(value)
        : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(MONTH_FORMAT.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}`;
}

// One entry per meter number, with the earliest month it was found. Water meters, meters that
// are removed or decommissioned, and records without a meter number or a found date are left
// out and counted.
export function buildFieldMeterList(astRecords = []) {
  const earliest = new Map();
  const skipped = { notElectricity: 0, removed: 0, noMeterNumber: 0, noFoundDate: 0 };

  for (const record of astRecords) {
    if (String(record?.meterType || "").trim().toLowerCase() !== "electricity") {
      skipped.notElectricity += 1;
      continue;
    }
    if (OUT_OF_SERVICE_STATES.has(String(record?.status?.state || "").trim().toUpperCase())) {
      skipped.removed += 1;
      continue;
    }
    const meterNo = String(record?.master?.id || "").trim();
    if (!/^[A-Z0-9]+$/.test(meterNo)) {
      skipped.noMeterNumber += 1;
      continue;
    }
    const foundMonth = monthInJohannesburg(record?.metadata?.createdAt);
    if (!foundMonth) {
      skipped.noFoundDate += 1;
      continue;
    }
    const current = earliest.get(meterNo);
    if (!current || foundMonth < current) earliest.set(meterNo, foundMonth);
  }

  const meters = [...earliest.entries()]
    .map(([meterNo, foundMonth]) => ({ meterNo, foundMonth }))
    .sort((a, b) => a.meterNo.localeCompare(b.meterNo));
  return { meters, skipped };
}

const timeMs = (value) => {
  const date = value && typeof value.toDate === "function" ? value.toDate() : typeof value === "string" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
};

// The same GPS reading as the web Sales tables (src/redux/salesApi.js).
export function buildSalesPopulationRow(id, data = {}) {
  const candidates = pipelineCandidates(data) || [];
  const gpsAvailable = typeof data.hasUsableGps === "boolean" || typeof data.HasUsableGps === "boolean" ||
    candidates.some((candidate) =>
      coordinateNumber(candidate?.Latitude ?? candidate?.latitude, 90) !== null &&
      coordinateNumber(candidate?.Longitude ?? candidate?.longitude, 180) !== null);
  return {
    id,
    monthlyCategories: data.monthlyCategories || {},
    hasUsableGps: hasUsableSalesGps(data),
    gpsAvailable,
    updatedAtMs: Math.max(timeMs(data?.metadata?.updatedAt), timeMs(data?.metadata?.createdAt)),
  };
}

export async function getElectricityPopulation({ db, request }) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const lmPcode = String(request.data?.lmPcode || "").trim();
  if (!/^ZA[0-9]+$/.test(lmPcode)) throw new HttpsError("invalid-argument", "A valid LM is required.");

  const profileSnapshot = await db.doc(`users/${uid}`).get();
  const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
  const role = profile?.employment?.role || profile?.profile?.employment?.role || profile?.role;
  if (!MANAGEMENT_ROLES.has(role)) {
    throw new HttpsError("permission-denied", "Only management users can see the Electricity Meter Population.");
  }
  const workbases = [
    profile?.access?.activeWorkbase,
    ...(Array.isArray(profile?.access?.workbases) ? profile.access.workbases : []),
  ].map(workbaseId);
  if (!workbases.includes(lmPcode)) {
    throw new HttpsError("permission-denied", "The LM must be one of your workbases.");
  }

  const [salesSnapshot, astSnapshot] = await Promise.all([
    db.collection("sales-all-meters").where("lmPcode", "==", lmPcode).select(...SALES_FIELDS).get(),
    db.collection("asts").where("accessData.parents.lmPcode", "==", lmPcode).select(...AST_FIELDS).get(),
  ]);
  const salesRows = salesSnapshot.docs.map((doc) => buildSalesPopulationRow(doc.id, doc.data()));
  const { meters, skipped } = buildFieldMeterList(astSnapshot.docs.map((doc) => doc.data()));
  const months = listPopulationMonths(salesRows).map((month) =>
    buildElectricityPopulation({ salesRows, fieldMeters: meters, month }));
  const latestMs = salesRows.reduce((latest, row) => Math.max(latest, row.updatedAtMs), 0);
  const nowIso = new Date().toISOString();
  const salesUpdatedIso = latestMs ? new Date(latestMs).toISOString() : null;

  try {
    const batch = db.batch();
    for (const m of months) {
      const docRef = db.collection("report_electricity_population").doc(`${lmPcode}_${m.month}`);
      batch.set(
        docRef,
        {
          id: `${lmPcode}_${m.month}`,
          lmPcode,
          month: m.month,
          totalMeters: m.total || 0,
          sources: {
            onList: m.onList || 0,
            foundInField: m.foundInField || 0,
            onListShare: m.onListShare || 0,
            foundInFieldShare: m.foundInFieldShare || 0,
          },
          categories: {
            normal: m.normal || 0,
            targeted: m.targeted || 0,
            normalShare: m.normalShare || 0,
            targetedShare: m.targetedShare || 0,
          },
          targetedGps: {
            withGps: m.withGps || 0,
            withoutGps: m.withoutGps || 0,
            withGpsShare: m.withGpsShare || 0,
            withoutGpsShare: m.withoutGpsShare || 0,
          },
          metadata: {
            generatedAt: nowIso,
            updatedAt: nowIso,
            salesUpdatedAt: salesUpdatedIso,
          },
        },
        { merge: true },
      );
    }
    await batch.commit();
  } catch (error) {
    console.error("[electricityPopulation] Failed to persist rollup batch:", error);
  }

  return {
    success: true,
    lmPcode,
    generatedAt: nowIso,
    salesUpdatedAt: salesUpdatedIso,
    salesRecords: salesRows.length,
    fieldMeters: meters.length,
    months,
    skipped,
  };
}

export const getElectricityPopulationCallable = onCall(
  { timeoutSeconds: 300, memory: "1GiB" },
  (request) => getElectricityPopulation({ db: getFirestore(), request }),
);
