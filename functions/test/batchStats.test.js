// Targeted Batch rules TB-R057 (1.3.55): Batch Stats counting. Plain functions, no Firestore.
import test from "node:test";
import assert from "node:assert/strict";
import { composeSalesGeocodingAddress } from "../salesAllMeters/sales-batch-policy.js";
import { STILL_TO_BATCH_REASONS, batchStatsErfIds, fenceGeometry, batchStatsRowStatus, batchStatsTarget, batchStatsTown, batchStatsType, gpsFenceReason, isCatNow, stillToBatchReason, summarizeBatchStats } from "../targetedBatches/batch-stats.js";

const LM = "ZA5241", WARD = "ZA5241006", OTHER_WARD = "ZA5241004";
const stamp = { seconds: 1789257600, nanoseconds: 0 };
const month = (value, label) => ({ [value]: { leakageCategory: label } });
const CAT = month("2026-08", "CAT4 - Long Gap (4+ months)");
const NORMAL = month("2026-08", "Normal - No Leakage Flag");
const tb = suffix => `TGB_20260919_120000_${suffix}`;
// Sales IDs are capital letters and digits only. A Non-GPS meter, batchable unless changed.
const nonGps = (id, extra = {}) => ({ id, master: { id, visibility: "INVISIBLE" }, meterNo: id, meterNoNormalized: id, lmPcode: LM, town: "Dundee",
  adr: { strNo: "01A", strName: "Smith", strType: "Street" }, tbRefs: [], hasUsableGps: false, monthlyCategories: CAT, ...extra });
// A GPS meter on ERF `erfId` (its one pipeline ERF), batchable unless changed.
const gps = (id, erfId, extra = {}) => ({ ...nonGps(id), hasUsableGps: true, adr: { strNo: "1", strName: "Ayob" }, erfCandidates: [{ ErfId: erfId, Latitude: 5, Longitude: 5 }], ...extra });
// A failed ERF lookup for the meter's current address: the office must ERF it by hand.
const manual = row => ({ ...row, erfLookup: { version: 1, outcome: "NO_ERF", address: composeSalesGeocodingAddress(row), provider: "Google Geocoding API", attemptedAt: stamp, attemptedByUid: "U1", attemptedByUser: "Supervisor" } });
const erf = ([lng, lat], ward = WARD) => ({ admin: { ward: { pcode: ward }, localMunicipality: { pcode: LM } }, centroid: { latitude: lat, longitude: lng } });
const square = (from, to) => ({ type: "Polygon", points: [[from, from], [to, from], [to, to], [from, to]].map(([longitude, latitude]) => ({ latitude, longitude })) });
const fence = (id, [from, to], { ward = WARD, status = "ACTIVE", lm = LM, geometry = square(from, to) } = {}) => ({ id, status, parents: { lmPcode: lm, wardPcode: ward }, geometry });
const batch = (id, source, allocation = null, extra = {}) => ({ id, scope: { lmPcode: LM }, source: { type: source }, ...(allocation ? { status: "ALLOCATED", allocation } : { status: "READY_FOR_ALLOCATION" }), ...extra });
const row = (tbId, salesAllMeterId, status) => ({ tbId, salesAllMeterId, ...(status === undefined ? {} : { execution: { status } }) });
const zero = () => ({ total: 0, NOT_STARTED: 0, IN_PROGRESS: 0, COMPLETED: 0 });
const line = (NOT_STARTED = 0, IN_PROGRESS = 0, COMPLETED = 0) => ({ total: NOT_STARTED + IN_PROGRESS + COMPLETED, NOT_STARTED, IN_PROGRESS, COMPLETED });

test("batch type follows TB Register's Batch Type column; neither type is Other", () => {
  assert.equal(batchStatsType({ selection: { planningMode: " non_gps_street " }, source: { type: "PREPAID_SALES" } }), "NON_GPS", "the planning mode wins");
  assert.equal(batchStatsType({ source: { type: "PREPAID_SALES_NON_GPS" } }), "NON_GPS");
  assert.equal(batchStatsType({ source: { type: "PREPAID_SALES" } }), "GPS");
  assert.equal(batchStatsType({ source: { type: "CSV_UPLOAD" } }), "OTHER");
  assert.equal(batchStatsType({}), "OTHER");
  assert.equal(batchStatsType(null), "OTHER");
});

test("allocation target follows TB Register's Allocated To column", () => {
  assert.deepEqual(batchStatsTarget({ status: "ALLOCATED", allocation: { targetType: "TEAM", targetId: "T1", targetName: " Team One " } }), { key: "TEAM:T1", kind: "TEAM", name: "Team One", allocated: true });
  assert.deepEqual(batchStatsTarget({ allocation: { status: "allocated", target: { type: "SERVICE_PROVIDER", id: "SP1", name: "Main SP" } } }), { key: "SP:SP1", kind: "SP", name: "Main SP", allocated: true }, "any type other than TEAM is an SP");
  assert.deepEqual(batchStatsTarget({ allocation: { targetId: "SP9" } }), { key: "SP:SP9", kind: "SP", name: "Name missing", allocated: true }, "a target ID alone means allocated");
  assert.deepEqual(batchStatsTarget({ status: "ALLOCATED", allocation: { targetType: "TEAM" } }), { key: "TEAM:Name missing", kind: "TEAM", name: "Name missing", allocated: true });
  assert.deepEqual(batchStatsTarget({ status: "ALLOCATED" }), { key: "SP:Name missing", kind: "SP", name: "Name missing", allocated: true });
  assert.deepEqual(batchStatsTarget({ allocation: { targetName: "Team One", targetType: "TEAM", status: "UNALLOCATED" } }), { key: "NOT_ALLOCATED", kind: null, name: "Not allocated", allocated: false }, "a name alone does not allocate");
  assert.deepEqual(batchStatsTarget({}), { key: "NOT_ALLOCATED", kind: null, name: "Not allocated", allocated: false });
});

test("row status is TB-R054's: a VISIBLE Sales meter is Completed, otherwise the row's own status", () => {
  const visible = nonGps("V1", { master: { id: "V1", visibility: "VISIBLE" } });
  assert.equal(batchStatsRowStatus({ row: row("T", "V1", "NOT_STARTED"), sales: visible }), "COMPLETED");
  assert.equal(batchStatsRowStatus({ row: row("T", "V1", "IN_PROGRESS"), sales: visible }), "COMPLETED");
  assert.equal(batchStatsRowStatus({ row: row("T", "A1", " in_progress "), sales: nonGps("A1") }), "IN_PROGRESS");
  assert.equal(batchStatsRowStatus({ row: row("T", "A1", "COMPLETED"), sales: nonGps("A1") }), "COMPLETED");
  assert.equal(batchStatsRowStatus({ row: row("T", "A1", "WHATEVER"), sales: nonGps("A1") }), "NOT_STARTED", "a status that cannot be read is Not Started");
  assert.equal(batchStatsRowStatus({ row: row("T", "A1"), sales: nonGps("A1") }), "NOT_STARTED");
  // A missing Sales record counts by the row only.
  assert.equal(batchStatsRowStatus({ row: row("T", "GONE", "COMPLETED"), sales: null }), "COMPLETED");
  assert.equal(batchStatsRowStatus({ row: row("T", "GONE", "IN_PROGRESS") }), "IN_PROGRESS");
  assert.equal(batchStatsRowStatus({ row: row("T", "GONE") }), "NOT_STARTED");
  // Only VISIBLE comes from Sales: a Sales record In Progress does not move a Not Started row.
  const salesInProgress = nonGps("P1", { targetedBatchId: tb("AB12"), tbRefs: [{ id: tb("AB12"), date: stamp, rowId: "TBR_1", fieldWork: { status: "IN_PROGRESS", updatedAt: stamp } }] });
  assert.equal(batchStatsRowStatus({ row: row("T", "P1", "NOT_STARTED"), sales: salesInProgress }), "NOT_STARTED");
});

test("CAT by the newest category on the meter's own Sales record", () => {
  assert.equal(isCatNow(nonGps("A1")), true);
  assert.equal(isCatNow(nonGps("A1", { monthlyCategories: NORMAL })), false);
  assert.equal(isCatNow(nonGps("A1", { monthlyCategories: { ...month("2026-07", "CAT1 - Zero Purchaser"), ...NORMAL } })), false, "an older CAT month does not count");
  assert.equal(isCatNow(nonGps("A1", { monthlyCategories: { ...NORMAL, ...month("2026-09", "CAT2 - Ghost Purchaser (1-3 mo)") } })), true);
  assert.equal(isCatNow(nonGps("A1", { monthlyCategories: {} })), false);
  assert.equal(isCatNow(null), false);
});

test("the town on the Sales file in title case; a blank town is No town", () => {
  assert.equal(batchStatsTown({ town: "DUNDEE" }), "Dundee");
  assert.equal(batchStatsTown({ town: "  glencoe   north-east " }), "Glencoe North-East");
  assert.equal(batchStatsTown({ town: "" }), null);
  assert.equal(batchStatsTown({ town: " NAv " }), null);
  assert.equal(batchStatsTown({}), null);
});

test("still to batch: the first check a meter fails, in the order of TB Draft and the GPS Sales map", () => {
  assert.deepEqual(stillToBatchReason(gps("G1", "E1"), LM), { reason: "GPS_NEEDS_FENCE_TEST", erfId: "E1" });
  assert.deepEqual(stillToBatchReason(gps("G1", "E1", { adr: { strNo: "-", strName: "" } }), LM), { reason: "ADDRESS_MISSING" }, "GPS: the street address the field needs");
  assert.deepEqual(stillToBatchReason(gps("G1", "E1", { town: " " }), LM), { reason: "ADDRESS_MISSING" }, "GPS: and the town");
  assert.deepEqual(stillToBatchReason(gps("G1", "E1", { erfCandidates: [], adr: {} }), LM), { reason: "OTHER", code: "PIPELINE_ERF_INVALID" }, "the batch checks come before the address");
  assert.deepEqual(stillToBatchReason(nonGps("N1"), LM), { reason: "NON_GPS_READY" });
  assert.deepEqual(stillToBatchReason(manual(nonGps("N1")), LM), { reason: "NON_GPS_MANUAL_ERFING" });
  const incomplete = nonGps("N1", { adr: { strNo: "", strName: "Smith", strType: "Street" } });
  assert.deepEqual(stillToBatchReason(incomplete, LM), { reason: "ADDRESS_MISSING" });
  assert.deepEqual(stillToBatchReason(manual(incomplete), LM), { reason: "NON_GPS_MANUAL_ERFING" }, "manual ERFing comes before the address");
  assert.deepEqual(stillToBatchReason(nonGps("N1", { town: "NAv" }), LM), { reason: "ADDRESS_MISSING" }, "Non-GPS: a town, street number and street name");
  assert.deepEqual(stillToBatchReason(nonGps("N1", { meterNo: "OTHER" }), LM), { reason: "OTHER", code: "SALES_IDENTITY_INVALID" });
});

// Rules TB-R057: an ordinary geofence is drawn by clicking on the map, so it may repeat a point or hold many of them.
test("a hand-drawn geofence still holds its meters", () => {
  const points = [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 10 }, { latitude: 0, longitude: 10 }, { latitude: 10, longitude: 10 }, { latitude: 10, longitude: 0 }];
  const drawn = fence("DRAWN", [0, 10], { geometry: { type: "Polygon", points } });
  assert.deepEqual(gpsFenceReason(erf([5, 5]), [{ ...drawn, geometry: fenceGeometry(drawn) }], LM), { reason: "GPS_INSIDE_FENCE" }, "a repeated point");
  const many = { latitude: 0, longitude: 0 };
  const big = fence("BIG", [0, 10], { geometry: { type: "Polygon", points: [...Array.from({ length: 360 }, (_, i) => ({ latitude: 5 + 4 * Math.sin((i * Math.PI) / 180), longitude: 5 + 4 * Math.cos((i * Math.PI) / 180) })), many].slice(0, 360) } });
  assert.deepEqual(gpsFenceReason(erf([5, 5]), [{ ...big, geometry: fenceGeometry(big) }], LM), { reason: "GPS_INSIDE_FENCE" }, "more than 300 points");
  assert.throws(() => fenceGeometry(fence("BAD", [0, 10], { geometry: { type: "Polygon", points: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }] } })));
});

test("the geofence test: an ACTIVE geofence of the LM, of the ERF's Ward when it names one", () => {
  const inside = erf([5, 5]);
  assert.deepEqual(gpsFenceReason(inside, [fence("F1", [0, 10])], LM), { reason: "GPS_INSIDE_FENCE" });
  assert.deepEqual(gpsFenceReason(erf([5, 5], OTHER_WARD), [fence("F1", [0, 10])], LM), { reason: "GPS_NO_FENCE" }, "a geofence of another Ward");
  assert.deepEqual(gpsFenceReason(inside, [fence("F1", [0, 10], { status: "INACTIVE" })], LM), { reason: "GPS_NO_FENCE" }, "an inactive geofence is ignored");
  assert.deepEqual(gpsFenceReason(inside, [fence("F1", [0, 10], { lm: "ZA5242" })], LM), { reason: "GPS_NO_FENCE" }, "a geofence of another LM");
  assert.deepEqual(gpsFenceReason(inside, [fence("F1", [0, 10], { ward: "NAv" })], LM), { reason: "GPS_INSIDE_FENCE" }, "a geofence that names no Ward");
  assert.deepEqual(gpsFenceReason(erf([0, 5]), [fence("F1", [0, 10])], LM), { reason: "GPS_NO_FENCE" }, "on the edge is not strictly inside");
  assert.deepEqual(gpsFenceReason(erf([15, 5]), [fence("F1", [0, 10])], LM), { reason: "GPS_NO_FENCE" });
  assert.deepEqual(gpsFenceReason(inside, [fence("BAD", [0, 10], { geometry: { type: "Polygon", points: [{ latitude: 0, longitude: 0 }] } }), fence("F2", [20, 30])], LM), { reason: "GPS_NO_FENCE" }, "an unreadable geofence holds no meter");
  // Rules TB-R057: an ERF that cannot hold a batch is a reason of its own, not "no geofence yet".
  assert.deepEqual(gpsFenceReason({ admin: { localMunicipality: { pcode: LM }, ward: { pcode: WARD } } }, [fence("F1", [0, 10])], LM), { reason: "OTHER", code: "ERF_CENTROID_INVALID" }, "an ERF without a centroid");
  assert.deepEqual(gpsFenceReason({ ...inside, admin: { localMunicipality: { pcode: "ZA5242" }, ward: { pcode: WARD } } }, [fence("F1", [0, 10])], LM), { reason: "OTHER", code: "ERF_SCOPE_INVALID" }, "an ERF of another municipality");
  assert.deepEqual(gpsFenceReason({ ...inside, admin: { localMunicipality: { pcode: LM }, ward: { pcode: "NAv" } } }, [fence("F1", [0, 10])], LM), { reason: "OTHER", code: "ERF_SCOPE_INVALID" }, "an ERF naming no Ward");
  assert.deepEqual(gpsFenceReason(null, [fence("F1", [0, 10])], LM), { reason: "OTHER", code: "GPS_ERF_NOT_FOUND" });
});

// One LM with every case. Batches B1..B6; Part 4 meters in towns Dundee, Glencoe and No town.
function scenario() {
  const B = { B1: tb("BB01"), B2: tb("BB02"), B3: tb("BB03"), B4: tb("BB04"), B5: tb("BB05"), B6: tb("BB06") };
  const batches = [
    batch(B.B1, "PREPAID_SALES", { targetType: "TEAM", targetId: "T2", targetName: "Team Zulu" }),
    batch(B.B2, "PREPAID_SALES_NON_GPS", { targetType: "TEAM", targetId: "T1", targetName: "alpha team" }),
    batch(B.B3, "PREPAID_SALES_NON_GPS", { targetType: "SP", targetId: "SP1", targetName: "Beta SP" }),
    batch(B.B4, "PREPAID_SALES"),
    batch(B.B5, "CSV_UPLOAD", { targetType: "TEAM", targetId: "T1", targetName: "alpha team" }),
    batch(B.B6, "PREPAID_SALES_NON_GPS", {}, { selection: { planningMode: "NON_GPS_STREET" } }),
  ];
  const rows = [
    row(B.B1, "G1", "NOT_STARTED"), row(B.B1, "G2", "IN_PROGRESS"), row(B.B1, "MISSING1", "COMPLETED"), row(B.B1, "G3", "NOT_STARTED"),
    row(B.B2, "N1", "NOT_STARTED"), row(B.B2, "N2", "COMPLETED"),
    row(B.B3, "N3"),
    row(B.B4, "G4", "IN_PROGRESS"),
    row(B.B5, "X1", "NOT_STARTED"),
    row(B.B6, "N4", "IN_PROGRESS"),
    row(tb("ZZZZ"), "N1", "COMPLETED"), // a row of a batch that is not this LM's
  ];
  const member = (sales, tbId) => ({ ...sales, targetedBatchId: tbId });
  const salesDocs = [
    member(gps("G1", "E1", { master: { id: "G1", visibility: "VISIBLE" } }), B.B1), member(gps("G2", "E1"), B.B1), member(gps("G3", "E1"), B.B1), member(gps("G4", "E1"), B.B4),
    member(nonGps("N1"), B.B2), member(nonGps("N2"), B.B2), member(nonGps("N3"), B.B3), member(nonGps("N4"), B.B6),
    // Part 4, Dundee.
    gps("GIN1", "E1", { town: "DUNDEE" }),
    gps("GOW1", "E2", { targetedBatchId: null }),
    gps("GINACT1", "E3"),
    gps("GOTHERLM1", "E5"),
    gps("GNOERF1", "E404"),
    nonGps("NREADY1"),
    manual(nonGps("NMAN1", { adr: { strNo: "", strName: "Smith", strType: "Street" } })),
    // Part 4, Glencoe.
    gps("GADDR1", "E1", { town: "glencoe", adr: { strNo: "-", strName: "" } }),
    nonGps("NADDR1", { town: "Glencoe", adr: { strNo: "1" } }),
    gps("GPIPE1", "E1", { town: "GLENCOE", erfCandidates: [{ ErfId: "E1", Latitude: 5, Longitude: 5 }, { ErfId: "E2", Latitude: 5, Longitude: 5 }] }),
    // Part 4, No town.
    nonGps("NNOTOWN1", { town: "NAv" }),
    gps("GNOTOWN1", "E1", { town: "" }),
    // Not CAT now: never counted.
    nonGps("NORMAL1", { monthlyCategories: NORMAL }),
    nonGps("NOCAT1", { monthlyCategories: {} }),
    nonGps("OLDCAT1", { monthlyCategories: { ...month("2026-07", "CAT1 - Zero Purchaser"), ...NORMAL } }),
    nonGps("NORMALGHOST1", { monthlyCategories: NORMAL, targetedBatchId: tb("GHST") }),
    // CAT, in no batch, already found.
    nonGps("FOUND1", { master: { id: "FOUND1", visibility: "VISIBLE" } }),
    gps("FOUND2", "E1", { master: { id: "FOUND2", visibility: "VISIBLE" }, targetedBatchId: null }),
    // CAT with an unclear batch link.
    nonGps("UNRES1", { targetedBatchId: "BAD" }),
    nonGps("GHOST1", { targetedBatchId: tb("GHST") }),
    nonGps("MULTI1", { tbRefs: [{ id: tb("AA01"), date: stamp }, { id: tb("AA02"), date: stamp }] }),
    // CAT, in no batch, In Progress: neither still to batch nor found.
    nonGps("INPROG1", { targetedBatchId: null, tbRefs: [{ id: tb("AA03"), date: stamp, rowId: "TBR_1", fieldWork: { status: "IN_PROGRESS", updatedAt: stamp } }] }),
  ];
  const fences = [
    fence("F1", [0, 10]),
    fence("F2", [20, 30], { status: "INACTIVE" }),
    fence("F3", [0, 10], { geometry: { type: "Polygon", points: [{ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 1 }] } }), // unreadable
    fence("F4", [40, 50], { lm: "ZA5242" }),
    fence("F5", [0, 10], { status: "INACTIVE", geometry: "not a shape" }), // unreadable but not used anyway
  ];
  const erfsById = new Map([["E1", erf([5, 5])], ["E2", erf([5, 5], OTHER_WARD)], ["E3", erf([25, 25])], ["E5", erf([45, 45])]]);
  return { lmPcode: LM, batches, rows, salesDocs, fences, erfsById, generatedAt: "2026-09-19T10:00:00.000Z" };
}

test("the ERFs to read are those of the GPS meters that reached the geofence test", () => {
  const { batches, salesDocs } = scenario();
  assert.deepEqual(batchStatsErfIds({ lmPcode: LM, batches, salesDocs }), ["E1", "E2", "E3", "E404", "E5"]);
});

test("Batch Stats: every part of the contract", () => {
  const input = scenario();
  const stats = summarizeBatchStats(input);
  assert.equal(stats.success, true);
  assert.equal(stats.lmPcode, LM);
  assert.equal(stats.generatedAt, "2026-09-19T10:00:00.000Z");
  // Part 1.
  assert.deepEqual(stats.batches, { total: 6, GPS: 2, NON_GPS: 3, OTHER: 1 });
  // Part 2: G1 VISIBLE with a Not Started row is Completed; MISSING1 and X1 have no Sales record.
  assert.deepEqual(stats.meters, { ALL: line(4, 3, 3), GPS: line(1, 2, 2), NON_GPS: line(2, 1, 1), OTHER: line(1, 0, 0) });
  // Part 3: by name, Not allocated last.
  assert.deepEqual(stats.teams.map(team => [team.key, team.kind, team.name, team.allocated]), [
    ["TEAM:T1", "TEAM", "alpha team", true],
    ["SP:SP1", "SP", "Beta SP", true],
    ["SP:Name missing", "SP", "Name missing", true],
    ["TEAM:T2", "TEAM", "Team Zulu", true],
    ["NOT_ALLOCATED", null, "Not allocated", false],
  ]);
  const team = key => stats.teams.find(item => item.key === key);
  assert.deepEqual(team("TEAM:T1").batches, { total: 2, GPS: 0, NON_GPS: 1, OTHER: 1 });
  assert.deepEqual(team("TEAM:T1").meters, { ALL: line(2, 0, 1), GPS: zero(), NON_GPS: line(1, 0, 1), OTHER: line(1, 0, 0) });
  assert.deepEqual(team("SP:SP1").meters, { ALL: line(1), GPS: zero(), NON_GPS: line(1), OTHER: zero() });
  assert.deepEqual(team("SP:Name missing").meters.NON_GPS, line(0, 1, 0));
  assert.deepEqual(team("TEAM:T2").batches, { total: 1, GPS: 1, NON_GPS: 0, OTHER: 0 });
  assert.deepEqual(team("TEAM:T2").meters, { ALL: line(1, 1, 2), GPS: line(1, 1, 2), NON_GPS: zero(), OTHER: zero() });
  assert.deepEqual(team("NOT_ALLOCATED").meters, { ALL: line(0, 1, 0), GPS: line(0, 1, 0), NON_GPS: zero(), OTHER: zero() });
  // The teams add up to the whole.
  for (const type of ["ALL", "GPS", "NON_GPS", "OTHER"]) for (const key of ["total", "NOT_STARTED", "IN_PROGRESS", "COMPLETED"]) {
    assert.equal(stats.teams.reduce((sum, item) => sum + item.meters[type][key], 0), stats.meters[type][key], `${type} ${key}`);
  }
  assert.equal(stats.teams.reduce((sum, item) => sum + item.batches.total, 0), stats.batches.total);
  // Part 4.
  const still = stats.stillToBatch;
  assert.deepEqual(still.reasons, [...STILL_TO_BATCH_REASONS]);
  assert.deepEqual(still.reasons, ["GPS_INSIDE_FENCE", "GPS_NO_FENCE", "NON_GPS_READY", "NON_GPS_MANUAL_ERFING", "ADDRESS_MISSING", "OTHER"]);
  const counts = (GPS_INSIDE_FENCE, GPS_NO_FENCE, NON_GPS_READY, NON_GPS_MANUAL_ERFING, ADDRESS_MISSING, OTHER) => ({ GPS_INSIDE_FENCE, GPS_NO_FENCE, NON_GPS_READY, NON_GPS_MANUAL_ERFING, ADDRESS_MISSING, OTHER });
  assert.deepEqual(still.towns, [
    { town: "Dundee", counts: counts(1, 3, 1, 1, 0, 1), total: 7 },
    { town: "Glencoe", counts: counts(0, 0, 0, 0, 2, 1), total: 3 },
    { town: null, counts: counts(0, 0, 0, 0, 2, 0), total: 2 },
  ]);
  assert.deepEqual(still.totals, { ...counts(1, 3, 1, 1, 4, 2), total: 12 });
  for (const reason of still.reasons) assert.equal(still.towns.reduce((sum, town) => sum + town.counts[reason], 0), still.totals[reason], reason);
  assert.equal(still.towns.reduce((sum, town) => sum + town.total, 0), still.totals.total);
  // The total is every CAT meter that is Not Started and in no batch.
  const notStarted = ["GIN1", "GOW1", "GINACT1", "GOTHERLM1", "GNOERF1", "NREADY1", "NMAN1", "GADDR1", "NADDR1", "GPIPE1", "NNOTOWN1", "GNOTOWN1"];
  assert.equal(still.totals.total, notStarted.length);
  assert.deepEqual(still.otherReasons, [
    { code: "PIPELINE_ERF_INVALID", label: "GPS meter without exactly one ERF", count: 1 },
    { code: "GPS_ERF_NOT_FOUND", label: "its ERF cannot be found", count: 1 },
  ]);
  assert.equal(still.foundWithoutBatch, 2);
  assert.equal(still.unclearLink, 3, "malformed, naming a batch that does not exist, in two batches; a Normal meter is never counted");
  assert.equal(stats.fencesSkipped, 1, "only an ACTIVE geofence of the LM counts as skipped");
  assert.deepEqual(Object.keys(stats), ["success", "lmPcode", "generatedAt", "batches", "meters", "teams", "stillToBatch", "fencesSkipped"]);
});

test("each meter line adds up; an empty LM gives zeros and no groups", () => {
  const stats = summarizeBatchStats({ lmPcode: LM, generatedAt: "2026-09-19T10:00:00.000Z" });
  assert.deepEqual(stats.batches, { total: 0, GPS: 0, NON_GPS: 0, OTHER: 0 });
  assert.deepEqual(stats.meters, { ALL: zero(), GPS: zero(), NON_GPS: zero(), OTHER: zero() });
  assert.deepEqual(stats.teams, []);
  assert.deepEqual(stats.stillToBatch.towns, []);
  assert.deepEqual(stats.stillToBatch.totals, { GPS_INSIDE_FENCE: 0, GPS_NO_FENCE: 0, NON_GPS_READY: 0, NON_GPS_MANUAL_ERFING: 0, ADDRESS_MISSING: 0, OTHER: 0, total: 0 });
  assert.deepEqual(stats.stillToBatch.otherReasons, []);
  assert.equal(stats.fencesSkipped, 0);
  // Not allocated only when a batch is not allocated; ERFs given as a plain object work too.
  const { batches, rows, salesDocs, fences, erfsById } = scenario();
  const allocatedOnly = summarizeBatchStats({ lmPcode: LM, batches: batches.filter(item => item.status === "ALLOCATED"), rows, salesDocs, fences, erfsById: Object.fromEntries(erfsById) });
  assert.equal(allocatedOnly.teams.some(item => item.key === "NOT_ALLOCATED"), false);
  assert.equal(allocatedOnly.stillToBatch.totals.GPS_INSIDE_FENCE, 1);
  // G4's batch is left out, so G4 names a batch that is not among the LM's batches.
  assert.equal(allocatedOnly.stillToBatch.unclearLink, 4);
  for (const counts of Object.values(allocatedOnly.meters)) assert.equal(counts.total, counts.NOT_STARTED + counts.IN_PROGRESS + counts.COMPLETED);
});
