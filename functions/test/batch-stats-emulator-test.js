// Targeted Batch rules TB-R057 (1.3.55): Batch Stats against the Firestore emulator. Emulator only.
// A small LM with 33 batches (more than one group of 30 batch IDs), their rows, Sales meters,
// geofences and ERFs; one batch, Sales meter and geofence of another LM that must not count.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { composeSalesGeocodingAddress } from "../salesAllMeters/sales-batch-policy.js";
import { getBatchStats, getBatchStatsCallable } from "../targetedBatches/batchStatsCallable.js";

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host || "")) throw new Error("Firestore emulator unavailable: explicitly set a localhost FIRESTORE_EMULATOR_HOST; real projects are prohibited");
const projectId = "demo-ireps-batchstats";
const app = initializeApp({ projectId });
const db = getFirestore(app);

const LM = "ZA5241", OTHER_LM = "ZA5242", WARD = "ZA5241006";
const stamp = Timestamp.fromMillis(1789257600000);
const CAT = { "2026-08": { leakageCategory: "CAT4 - Long Gap (4+ months)", riskTier: "High", riskScore: 9 } };
const tb = n => `TGB_20260919_120000_B${String(n).padStart(3, "0")}`;
const nonGps = (id, extra = {}) => ({ master: { id, visibility: "INVISIBLE" }, meterNo: id, meterNoNormalized: id, lmPcode: LM, town: "DUNDEE",
  adr: { strNo: "01A", strName: "Smith", strType: "Street" }, tbRefs: [], hasUsableGps: false, monthlyCategories: CAT, ...extra });
const gps = (id, erfId, [longitude, latitude] = [30.05, -28.55], extra = {}) => ({ ...nonGps(id), hasUsableGps: true, adr: { strNo: "1", strName: "Ayob" },
  erfCandidates: [{ ErfId: erfId, Latitude: latitude, Longitude: longitude }], erfNumbers: [erfId], ...extra });
const manual = row => ({ ...row, erfLookup: { version: 1, outcome: "NO_ERF", address: composeSalesGeocodingAddress(row), provider: "Google Geocoding API", attemptedAt: stamp, attemptedByUid: "U1", attemptedByUser: "Supervisor" } });
const erf = ([longitude, latitude], lm = LM) => ({ admin: { ward: { pcode: WARD }, localMunicipality: { pcode: lm } }, centroid: { latitude, longitude } });
const square = ([west, south, east, north]) => ({ type: "Polygon", points: [[west, south], [east, south], [east, north], [west, north]].map(([longitude, latitude]) => ({ latitude, longitude })) });
const upload = (id, source, allocation = null, lm = LM) => ({ id, scope: { lmPcode: lm }, source: { type: source }, counts: { totalRows: 999 },
  ...(allocation ? { status: "ALLOCATED", allocation: { status: "ALLOCATED", ...allocation } } : { status: "READY_FOR_ALLOCATION" }) });
const tbRow = (tbId, n, salesAllMeterId, status) => ({ id: `${tbId}_${n}`, tbId, rowNo: n, salesAllMeterId, execution: { status } });
const profile = (role, workbases, activeWorkbase = workbases[0]) => ({ employment: { role }, access: { activeWorkbase, workbases } });
const call = (uid, data = { lmPcode: LM }) => getBatchStats({ db, request: { auth: uid ? { uid, token: {} } : null, data } });

before(async () => {
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  assert.equal(response.ok, true);
  const docs = {
    "users/MNG1": profile("MNG", [{ id: LM }]),
    "users/SPV1": { profile: { employment: { role: "SPV" } }, access: { workbases: [OTHER_LM, LM] } },
    "users/FWR1": profile("FWR", [{ id: LM }]),
    "users/MNG2": profile("MNG", [{ id: OTHER_LM }]),
    // Batches: B001 GPS for Team One, B002 Non-GPS for Main SP, B003..B033 Non-GPS not allocated.
    [`tb_uploads/${tb(1)}`]: upload(tb(1), "PREPAID_SALES", { targetType: "TEAM", targetId: "TEAM1", targetName: "Team One" }),
    [`tb_uploads/${tb(2)}`]: upload(tb(2), "PREPAID_SALES_NON_GPS", { targetType: "SERVICE_PROVIDER", targetId: "SP1", targetName: "Main SP" }),
    [`tb_uploads/${tb(99)}`]: upload(tb(99), "PREPAID_SALES", { targetType: "TEAM", targetId: "TEAM9", targetName: "Other LM Team" }, OTHER_LM),
    [`tb_rows/${tb(1)}_1`]: tbRow(tb(1), 1, "S1", "NOT_STARTED"), // its Sales meter is VISIBLE: Completed (TB-R054)
    [`tb_rows/${tb(1)}_2`]: tbRow(tb(1), 2, "S2", "IN_PROGRESS"),
    [`tb_rows/${tb(1)}_3`]: tbRow(tb(1), 3, "S3", "NOT_STARTED"),
    [`tb_rows/${tb(2)}_1`]: tbRow(tb(2), 1, "S4", "COMPLETED"),
    [`tb_rows/${tb(2)}_2`]: tbRow(tb(2), 2, "S5", "NOT_STARTED"),
    [`tb_rows/${tb(99)}_1`]: tbRow(tb(99), 1, "X1", "COMPLETED"),
    "sales-all-meters/S1": gps("S1", "E1", undefined, { master: { id: "S1", visibility: "VISIBLE" }, targetedBatchId: tb(1) }),
    "sales-all-meters/S2": gps("S2", "E1", undefined, { targetedBatchId: tb(1) }),
    "sales-all-meters/S3": gps("S3", "E1", undefined, { targetedBatchId: tb(1) }),
    "sales-all-meters/S4": nonGps("S4", { targetedBatchId: tb(2) }),
    "sales-all-meters/S5": nonGps("S5", { targetedBatchId: tb(2) }),
    // CAT meters still to batch.
    "sales-all-meters/GIN": gps("GIN", "E1"),
    "sales-all-meters/GOUT": gps("GOUT", "E2", [30.2, -28.55]),
    "sales-all-meters/GNOERF": gps("GNOERF", "E9"),
    "sales-all-meters/NREADY": nonGps("NREADY", { town: "Dundee" }),
    "sales-all-meters/NMAN": manual(nonGps("NMAN", { adr: { strNo: "", strName: "Smith", strType: "Street" } })),
    "sales-all-meters/NADDR": nonGps("NADDR", { town: "" }),
    // Not counted in the table: already found, an unclear batch link, not CAT, another LM.
    "sales-all-meters/FOUND": nonGps("FOUND", { master: { id: "FOUND", visibility: "VISIBLE" } }),
    "sales-all-meters/GHOST": nonGps("GHOST", { targetedBatchId: "TGB_20260101_000000_GHST" }),
    "sales-all-meters/NORMAL": nonGps("NORMAL", { monthlyCategories: { "2026-08": { leakageCategory: "Normal - No Leakage Flag" } } }),
    "sales-all-meters/OTHERLM": { ...nonGps("OTHERLM"), lmPcode: OTHER_LM },
    "geo_fences/F1": { id: "F1", name: "Gf W6 Dundee", status: "ACTIVE", parents: { lmPcode: LM, wardPcode: WARD }, geometry: square([30.0, -28.6, 30.1, -28.5]) },
    "geo_fences/F2": { id: "F2", name: "Gf W6 Broken", status: "ACTIVE", parents: { lmPcode: LM, wardPcode: WARD }, geometry: { type: "Polygon", points: [{ latitude: -28.55, longitude: 30.2 }] } },
    "geo_fences/F9": { id: "F9", name: "Gf W1 Elsewhere", status: "ACTIVE", parents: { lmPcode: OTHER_LM, wardPcode: "ZA5242001" }, geometry: square([30.15, -28.6, 30.25, -28.5]) },
    "ireps_erfs/E1": erf([30.05, -28.55]),
    "ireps_erfs/E2": erf([30.2, -28.55]),
  };
  for (let n = 3; n <= 33; n += 1) {
    docs[`tb_uploads/${tb(n)}`] = upload(tb(n), "PREPAID_SALES_NON_GPS");
    docs[`tb_rows/${tb(n)}_1`] = tbRow(tb(n), 1, `M${n}`, "NOT_STARTED"); // no Sales record: counted by the row
  }
  const batch = db.batch();
  for (const [path, data] of Object.entries(docs)) batch.set(db.doc(path), data);
  await batch.commit();
});
after(async () => { await db.terminate(); await deleteApp(app); });

// Every document of the emulator, to prove that counting wrote nothing.
async function dump() {
  const out = {};
  for (const collection of await db.listCollections()) for (const doc of (await collection.get()).docs) out[doc.ref.path] = JSON.stringify(doc.data());
  return out;
}
const line = (NOT_STARTED = 0, IN_PROGRESS = 0, COMPLETED = 0) => ({ total: NOT_STARTED + IN_PROGRESS + COMPLETED, NOT_STARTED, IN_PROGRESS, COMPLETED });
const counts = (GPS_INSIDE_FENCE, GPS_NO_FENCE, NON_GPS_READY, NON_GPS_MANUAL_ERFING, ADDRESS_MISSING, OTHER) => ({ GPS_INSIDE_FENCE, GPS_NO_FENCE, NON_GPS_READY, NON_GPS_MANUAL_ERFING, ADDRESS_MISSING, OTHER });
const EXPECTED = {
  success: true, lmPcode: LM,
  batches: { total: 33, GPS: 1, NON_GPS: 32, OTHER: 0 },
  meters: { ALL: line(33, 1, 2), GPS: line(1, 1, 1), NON_GPS: line(32, 0, 1), OTHER: line() },
  teams: [
    { key: "SP:SP1", kind: "SP", name: "Main SP", allocated: true, batches: { total: 1, GPS: 0, NON_GPS: 1, OTHER: 0 }, meters: { ALL: line(1, 0, 1), GPS: line(), NON_GPS: line(1, 0, 1), OTHER: line() } },
    { key: "TEAM:TEAM1", kind: "TEAM", name: "Team One", allocated: true, batches: { total: 1, GPS: 1, NON_GPS: 0, OTHER: 0 }, meters: { ALL: line(1, 1, 1), GPS: line(1, 1, 1), NON_GPS: line(), OTHER: line() } },
    { key: "NOT_ALLOCATED", kind: null, name: "Not allocated", allocated: false, batches: { total: 31, GPS: 0, NON_GPS: 31, OTHER: 0 }, meters: { ALL: line(31), GPS: line(), NON_GPS: line(31), OTHER: line() } },
  ],
  stillToBatch: {
    reasons: ["GPS_INSIDE_FENCE", "GPS_NO_FENCE", "NON_GPS_READY", "NON_GPS_MANUAL_ERFING", "ADDRESS_MISSING", "OTHER"],
    towns: [
      { town: "Dundee", counts: counts(1, 1, 1, 1, 0, 1), total: 5 },
      { town: null, counts: counts(0, 0, 0, 0, 1, 0), total: 1 },
    ],
    totals: { ...counts(1, 1, 1, 1, 1, 1), total: 6 },
    otherReasons: [{ code: "GPS_ERF_NOT_FOUND", label: "its ERF cannot be found", count: 1 }],
    foundWithoutBatch: 1,
    unclearLink: 1,
  },
  fencesSkipped: 1,
};
const withoutTime = ({ generatedAt, ...rest }) => { assert.ok(!Number.isNaN(Date.parse(generatedAt)), "generatedAt is a time"); return rest; };

test("a management user gets the exact numbers, and counting writes nothing", async () => {
  const before = await dump();
  const stats = await call("MNG1");
  assert.deepEqual(withoutTime(stats), EXPECTED);
  assert.deepEqual(await dump(), before);
});

test("an SPV whose workbases list the LM gets the same numbers; the callable wraps the same count", async () => {
  assert.deepEqual(withoutTime(await call("SPV1")), EXPECTED);
  assert.deepEqual(withoutTime(await getBatchStatsCallable.run({ auth: { uid: "MNG1", token: {} }, data: { lmPcode: LM } })), EXPECTED);
});

test("refusals: no sign-in, no valid LM, not management, LM outside the workbases", async () => {
  const refused = (code, message) => error => error.code === code && error.message === message;
  await assert.rejects(call(null), refused("unauthenticated", "Sign in to continue."));
  await assert.rejects(call("MNG1", { lmPcode: "Dundee" }), refused("invalid-argument", "A valid LM is required."));
  await assert.rejects(call("FWR1"), refused("permission-denied", "Only management users can see Batch Stats."));
  await assert.rejects(call("NOBODY"), refused("permission-denied", "Only management users can see Batch Stats."));
  await assert.rejects(call("MNG2"), refused("permission-denied", "The LM must be one of your workbases."));
});
