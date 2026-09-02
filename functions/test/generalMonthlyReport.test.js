import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCanonicalGmrMeterRow,
  buildGeneralMonthlyReportDataset,
  buildGmrMonthKeysFromSales,
  buildGmrTeamMembershipIndex,
  buildZamoReportPhotoConfig,
  getGmrReportMonthWindow,
  isTimestampInGmrReportMonth,
  resolveGmrFieldStatsTeam,
  selectGmrPopulationMeters,
  validateGmrReportMonth,
} from "../reports/generalMonthlyReport.js";

function registryMeter(index, visibility = "VISIBLE") {
  return {
    id: `TRN_MD_${String(index).padStart(4, "0")}`,
    meterNo: `METER${index}`,
    visibility,
    premiseId: `PREM_${index}`,
    erfNo: String(1000 + index),
    parents: {
      lmPcode: "ZA5241",
      wardPcode: `ZA5241${String((index % 3) + 1).padStart(3, "0")}`,
    },
  };
}

function discoveryEntry(registry, createdAt = "2026-08-10T08:00:00.000Z") {
  return {
    id: registry.id,
    data: {
      accessData: {
        trnType: "METER_DISCOVERY",
        access: { hasAccess: "yes" },
        premise: { id: registry.premiseId },
        parents: registry.parents,
        erfNo: registry.erfNo,
      },
      ast: {
        astData: {
          astNo: registry.meterNo,
          meter: { type: "prepaid", phase: "single" },
        },
        anomalies: { anomaly: "Meter Ok", anomalyDetail: "Meter Ok" },
        location: { gps: { lat: -28.123, lng: 30.654 } },
      },
      meterType: "electricity",
      metadata: {
        createdAt,
        updatedAt: "2026-09-10T08:00:00.000Z",
        createdByUid: "USER_1",
        createdByUser: "Field Worker One",
      },
      serviceProvider: { name: "Example SP" },
    },
  };
}

function salesEntry(id, monthlySalesC = {}, legacySales = undefined) {
  return {
    id,
    data: {
      meterNoNormalized: id,
      leakageCategory: "Normal - No Leakage Flag",
      monthlySalesC,
      ...(legacySales ? { Sales: legacySales } : {}),
    },
  };
}

test("GMR full population includes every Endumeni registry meter in deterministic order", () => {
  const meters = [
    registryMeter(5, "VISIBLE"),
    registryMeter(2, "INVISIBLE"),
    registryMeter(9, "UNKNOWN"),
    registryMeter(1, "VISIBLE"),
  ];

  const result = selectGmrPopulationMeters(meters);
  assert.equal(result.selected.length, 4);
  assert.equal(result.summary.selectedTotal, 4);
  assert.equal(result.summary.visibleSelected, 2);
  assert.equal(result.summary.invisibleSelected, 1);
  assert.equal(result.summary.unclassifiedSelected, 1);
  assert.deepEqual(new Set(result.selected.map((meter) => meter.id)), new Set(meters.map((meter) => meter.id)));
});

test("GMR premise enrichment still reads the authoritative premises collection", () => {
  const source = readFileSync(new URL("../reports/generalMonthlyReport.js", import.meta.url), "utf8");
  assert.match(source, /getDocsByIds\(db,\s*"premises",\s*premiseIds\)/);
  assert.doesNotMatch(source, /getDocsByIds\(db,\s*"registry_premises",\s*premiseIds\)/);
});

test("Johannesburg August reporting window uses half-open UTC instants", () => {
  const window = getGmrReportMonthWindow("2026-08");
  assert.equal(window.startIso, "2026-07-31T22:00:00.000Z");
  assert.equal(window.endIso, "2026-08-31T22:00:00.000Z");
  assert.equal(window.reportingPeriodLabel, "August 2026");

  assert.equal(isTimestampInGmrReportMonth("2026-07-31T21:59:59.999Z", window), false);
  assert.equal(isTimestampInGmrReportMonth("2026-07-31T22:00:00.000Z", window), true);
  assert.equal(isTimestampInGmrReportMonth("2026-08-31T21:59:59.999Z", window), true);
  assert.equal(isTimestampInGmrReportMonth("2026-08-31T22:00:00.000Z", window), false);
});

test("report month validation rejects malformed and future months", () => {
  assert.throws(() => validateGmrReportMonth("2026-13", new Date("2026-09-02T08:00:00.000Z")), /YYYY-MM/);
  assert.throws(() => validateGmrReportMonth("26-08", new Date("2026-09-02T08:00:00.000Z")), /YYYY-MM/);
  assert.throws(() => validateGmrReportMonth("2026-10", new Date("2026-09-02T08:00:00.000Z")), /future/);
  assert.equal(validateGmrReportMonth("2026-09", new Date("2026-09-02T08:00:00.000Z")).reportMonth, "2026-09");
  assert.equal(validateGmrReportMonth("2026-08", new Date("2026-09-02T08:00:00.000Z")).reportMonth, "2026-08");
});

test("dynamic Sales month keys span the full contiguous observed range beyond August 2026", () => {
  const keys = buildGmrMonthKeysFromSales([
    salesEntry("M1", { "2023-11": 100, "2026-01": 0 }),
    salesEntry("M2", { "2026-10": 200 }),
  ]);

  assert.equal(keys[0], "2023-11");
  assert.equal(keys.at(-1), "2026-10");
  assert.ok(keys.includes("2024-07"));
  assert.ok(keys.includes("2026-09"));
  assert.equal(keys.length, 36);
});

test("dynamic Sales month keys include legacy Sales evidence and return empty when none exists", () => {
  const keys = buildGmrMonthKeysFromSales([
    { data: { Sales: { "2025-12": 100, "2026-02": 200 } } },
    { data: { monthlySalesC: { "2026-04": 30000 } } },
  ]);
  assert.deepEqual(keys, ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04"]);
  assert.deepEqual(buildGmrMonthKeysFromSales([{ data: {} }]), []);
});

test("Discovery row anchors capture/investigation date to metadata.createdAt, not updatedAt", () => {
  const registry = registryMeter(1, "VISIBLE");
  const discovery = discoveryEntry(registry, "2026-08-31T21:30:00.000Z");
  discovery.data.metadata.updatedAt = "2026-09-02T10:00:00.000Z";
  const sales = salesEntry("METER1", { "2026-08": 0, "2026-09": 12345 });

  const row = buildCanonicalGmrMeterRow({
    registry,
    discoveryEntry: discovery,
    premiseEntry: null,
    fieldSalesEntry: sales,
    sourceSalesEntry: sales,
    lifecycleTrns: [],
    monthKeys: ["2026-08", "2026-09"],
  });

  assert.equal(row.captureDate, "2026-08-31T21:30:00.000Z");
  assert.equal(row.investigationDate, "2026-08-31T21:30:00.000Z");
  assert.equal(row.investigationMonthPurchase, 0);
});

test("Invisible field-found meter retains targeted Sales history and approved Field Data values", () => {
  const registry = registryMeter(2, "INVISIBLE");
  registry.meterNo = "FIELD999";
  registry.meterKind = "prepaid";
  registry.meterType = "electricity";
  registry.meterPhase = "single";

  const discovery = discoveryEntry(registry, "2026-06-15T10:00:00.000Z");
  discovery.data.ast.astData.astNo = "FIELD999";
  discovery.data.ast.astData.meter.seal = { sealNo: "SEAL-001" };
  discovery.data.ast.anomalies = {
    anomaly: "Illegally Connected",
    anomalyDetail: "Straight Connection (Meter Bypass)",
  };
  discovery.data.ast.normalisation = { actionTaken: ["Meter number corrected", "Address corrected"] };
  discovery.data.targetedBatchContext = {
    tbId: "TB_1",
    rowId: "ROW_1",
    salesDocId: "ORIG123",
    meterNo: "ORIG123",
    accountNumber: "ACC001",
    customerName: "Example Customer",
  };
  discovery.data.fieldComment = { text: "Meter audit completed with customer present." };
  discovery.data.media = [
    { url: "https://example.test/photo-1.jpg" },
    { url: "https://example.test/photo-2.jpg" },
  ];

  const premiseEntry = {
    id: registry.premiseId,
    data: {
      erfNo: registry.erfNo,
      address: { strNo: "14A", strName: "vAN rENSBURG", strType: "sTREET", suburbName: "Example Suburb" },
      propertyType: { name: "Block A", type: "Residential", unitNo: "A1" },
      occupancy: { status: "Accessed" },
      parents: registry.parents,
    },
  };
  const sourceSalesEntry = {
    id: "ORIG123",
    data: {
      meterNoNormalized: "ORIG123",
      accountNumber: "ACC001",
      customerName: "Example Customer",
      leakageCategory: "CAT5 - Stopped Purchasing",
      monthlySalesC: { "2026-04": 0, "2026-05": 25000, "2026-06": 10000 },
    },
  };

  const row = buildCanonicalGmrMeterRow({
    registry,
    discoveryEntry: discovery,
    premiseEntry,
    fieldSalesEntry: null,
    sourceSalesEntry,
    lifecycleTrns: [],
    fieldStatsTeam: "Kaiser Team",
    monthKeys: ["2026-04", "2026-05", "2026-06"],
  });

  assert.equal(row.registryVisibility, "Invisible");
  assert.equal(row.originalProjectMeterNo, "ORIG123");
  assert.equal(row.fieldFoundMeterNo, "FIELD999");
  assert.equal(row.monthlyPurchases["2026-04"], 0);
  assert.equal(row.monthlyPurchases["2026-05"], 250);
  assert.equal(row.sameDifferent, "Different");
  assert.equal(row.streetName, "Van Rensburg");
  assert.equal(row.primaryFinding, "Illegally Connected");
  assert.equal(row.normalisation, "Meter number corrected • Address corrected");
  assert.equal(row.fieldStatsTeam, "Kaiser Team");
  assert.equal(row.meterMode, "Prepaid");
});

test("current monthlySalesC evidence takes precedence and legacy Sales fills only absent months", () => {
  const registry = registryMeter(3);
  const discovery = discoveryEntry(registry, "2026-05-10T10:00:00.000Z");
  const sales = {
    id: "METER3",
    data: {
      meterNoNormalized: "METER3",
      monthlySalesC: { "2026-05": 0, "2026-07": "bad" },
      Sales: { "2026-05": 999, "2026-06": 123.45, "2026-07": 77 },
    },
  };
  const row = buildCanonicalGmrMeterRow({
    registry,
    discoveryEntry: discovery,
    premiseEntry: null,
    fieldSalesEntry: sales,
    sourceSalesEntry: sales,
    lifecycleTrns: [],
    monthKeys: ["2026-05", "2026-06", "2026-07"],
  });
  assert.equal(row.monthlyPurchases["2026-05"], 0);
  assert.equal(row.monthlyPurchases["2026-06"], 123.45);
  assert.equal(row.monthlyPurchases["2026-07"], null);
});

test("GMR Field Stats team attribution follows current team membership with Unassigned and Multiple handling", () => {
  const index = buildGmrTeamMembershipIndex([
    { id: "TEAM_KAISER", data: { team: { name: "Kaiser Team", status: "ACTIVE" }, scope: { memberUserIds: ["USER_1", "USER_MULTI"] } } },
    { id: "TEAM_PETER", data: { team: { name: "Peter Team", status: "ACTIVE" }, scope: { memberUserIds: ["USER_2", "USER_MULTI"] } } },
    { id: "TEAM_INACTIVE", data: { team: { name: "Inactive Team", status: "INACTIVE" }, scope: { memberUserIds: ["USER_3"] } } },
  ]);
  assert.equal(resolveGmrFieldStatsTeam("USER_1", index), "Kaiser Team");
  assert.equal(resolveGmrFieldStatsTeam("USER_2", index), "Peter Team");
  assert.equal(resolveGmrFieldStatsTeam("USER_MULTI", index), "Multiple");
  assert.equal(resolveGmrFieldStatsTeam("USER_3", index), "Unassigned");
});

test("Zamo Report photo columns follow observed data up to six-photo ceiling", () => {
  assert.deepEqual(buildZamoReportPhotoConfig([
    { photoUrls: ["p1", "p2", "p3"] },
    { photoUrls: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"] },
    { photoUrls: [] },
  ]), {
    observedMaxPhotoCount: 7,
    photoColumnCount: 6,
    hardCeiling: 6,
    truncatedPhotoCount: 1,
  });
});

test("GMR intervention summary retains full lifecycle state without inventing fine revenue", () => {
  const registry = registryMeter(4);
  const discovery = discoveryEntry(registry, "2026-08-01T08:00:00.000Z");
  const sales = salesEntry("METER4", { "2026-06": 0 });
  const lifecycleTrns = [
    {
      id: "TRN_DCN_1",
      data: {
        accessData: { trnType: "METER_DISCONNECTION" },
        ast: { astData: { astId: registry.id } },
        workflow: { state: "COMPLETED", completedAt: "2026-07-10T08:00:00.000Z", completedByUser: "Field User" },
        disconnection: { level: { label: "Meter" }, supplyDisconnected: { answer: "yes" } },
        executionOutcome: { success: true },
      },
    },
    {
      id: "TRN_RCN_1",
      data: {
        accessData: { trnType: "METER_RECONNECTION" },
        ast: { astData: { astId: registry.id } },
        workflow: { state: "COMPLETED", completedAt: "2026-08-12T08:00:00.000Z", completedByUser: "Field User 2" },
        reconnection: { supplyReconnected: { answer: "yes" } },
        executionOutcome: { success: true },
      },
    },
  ];
  const row = buildCanonicalGmrMeterRow({
    registry,
    discoveryEntry: discovery,
    premiseEntry: null,
    fieldSalesEntry: sales,
    sourceSalesEntry: sales,
    lifecycleTrns,
    monthKeys: ["2026-06"],
  });
  assert.equal(row.interventionCount, 2);
  assert.equal(row.disconnected, "Yes");
  assert.equal(row.reconnected, "Yes");
  assert.equal(row.latestInterventionType, "METER_RECONNECTION");
  assert.equal(row.totalFinesPaidR, null);
  assert.equal(row.lifecycleEvents.length, 2);
});

test("completed no-access DCN attempt is lifecycle activity but not a successful disconnection", () => {
  const registry = registryMeter(5);
  const discovery = discoveryEntry(registry, "2026-08-01T08:00:00.000Z");
  const sales = salesEntry("METER5", { "2026-06": 0 });
  const row = buildCanonicalGmrMeterRow({
    registry,
    discoveryEntry: discovery,
    premiseEntry: null,
    fieldSalesEntry: sales,
    sourceSalesEntry: sales,
    lifecycleTrns: [{
      id: "TRN_DCN_NO_ACCESS",
      data: {
        accessData: { trnType: "METER_DISCONNECTION" },
        ast: { astData: { astId: registry.id } },
        workflow: { state: "COMPLETED", completedAt: "2026-08-10T08:00:00.000Z", completedByUser: "Field User" },
        executionOutcome: { outcome: "NO_ACCESS", success: false },
      },
    }],
    monthKeys: ["2026-06"],
  });
  assert.equal(row.interventionCount, 1);
  assert.equal(row.interventionStatus, "Pending");
  assert.equal(row.disconnected, "No");
  assert.equal(row.reconnected, "No");
});

test("consecutive zero-purchase count respects contiguous calendar months", () => {
  const registry = registryMeter(6);
  const discovery = discoveryEntry(registry, "2026-05-10T10:00:00.000Z");
  const sales = salesEntry("METER6", { "2026-04": 10000, "2026-05": 0, "2026-06": 0 });
  const row = buildCanonicalGmrMeterRow({
    registry,
    discoveryEntry: discovery,
    premiseEntry: null,
    fieldSalesEntry: sales,
    sourceSalesEntry: sales,
    lifecycleTrns: [],
    monthKeys: ["2026-04", "2026-05", "2026-06"],
  });
  assert.equal(row.latestAvailablePurchaseValue, 0);
  assert.equal(row.latestPurchasingStatus, "Zero Purchase");
  assert.equal(row.consecutiveZeroPurchaseMonths, 2);
});


function getPathValue(value, path) {
  return String(path).split(".").reduce((current, part) => current?.[part], value);
}

function fakeFirestore(seed) {
  function snapshot(id, data) {
    return { id, exists: Boolean(data), data: () => data };
  }
  function collection(name) {
    const source = seed[name] || {};
    return {
      doc(id) { return { __collection: name, id }; },
      where(path, operator, expected) {
        assert.equal(operator, "==");
        return {
          async get() {
            return {
              docs: Object.entries(source)
                .filter(([, data]) => getPathValue(data, path) === expected)
                .map(([id, data]) => snapshot(id, data)),
            };
          },
        };
      },
      async get() {
        return { docs: Object.entries(source).map(([id, data]) => snapshot(id, data)) };
      },
    };
  }
  return {
    collection,
    async getAll(...refs) {
      return refs.map((ref) => snapshot(ref.id, seed[ref.__collection]?.[ref.id]));
    },
  };
}

test("August and September keep the same full meter rows while only TRN-driven activity changes", async () => {
  const r1 = registryMeter(11, "VISIBLE");
  const r2 = registryMeter(12, "VISIBLE");
  const d1 = discoveryEntry(r1, "2026-08-15T08:00:00.000Z").data;
  const d2 = discoveryEntry(r2, "2026-09-01T08:00:00.000Z").data;
  const seed = {
    registry_meters: { [r1.id]: r1, [r2.id]: r2 },
    trns: {
      [r1.id]: d1,
      [r2.id]: d2,
      TRN_DCN_AUG: {
        accessData: { trnType: "METER_DISCONNECTION", parents: { lmPcode: "ZA5241" } },
        ast: { astData: { astId: r1.id } },
        workflow: { state: "COMPLETED", completedAt: "2026-08-20T08:00:00.000Z", completedByUser: "Worker" },
        executionOutcome: { success: true },
      },
      TRN_RCN_SEP: {
        accessData: { trnType: "METER_RECONNECTION", parents: { lmPcode: "ZA5241" } },
        ast: { astData: { astId: r1.id } },
        workflow: { state: "COMPLETED", completedAt: "2026-09-01T12:00:00.000Z", completedByUser: "Worker" },
        executionOutcome: { success: true },
      },
    },
    teams: {},
    premises: {
      [r1.premiseId]: { parents: r1.parents, address: { strNo: "1", strName: "Main", strType: "Street" } },
      [r2.premiseId]: { parents: r2.parents, address: { strNo: "2", strName: "Main", strType: "Street" } },
    },
    "sales-all-meters": {
      [r1.meterNo]: { meterNoNormalized: r1.meterNo, monthlySalesC: { "2026-07": 10000, "2026-09": 20000 } },
      [r2.meterNo]: { meterNoNormalized: r2.meterNo, monthlySalesC: { "2026-08": 30000 } },
    },
  };
  const db = fakeFirestore(seed);
  const generatedAt = new Date("2026-09-02T08:00:00.000Z");
  const august = await buildGeneralMonthlyReportDataset({ db, reportMonth: "2026-08", generatedAt });
  const september = await buildGeneralMonthlyReportDataset({ db, reportMonth: "2026-09", generatedAt });

  assert.equal(august.rows.length, 2);
  assert.equal(september.rows.length, 2);
  assert.deepEqual(august.rows.map((row) => row.iRepsMeterId), september.rows.map((row) => row.iRepsMeterId));
  assert.deepEqual(august.fieldRows.map((row) => row.iRepsMeterId), [r1.id]);
  assert.deepEqual(september.fieldRows.map((row) => row.iRepsMeterId), [r2.id]);
  assert.deepEqual(august.interventionEvents.map((event) => event.eventId), ["TRN_DCN_AUG"]);
  assert.deepEqual(september.interventionEvents.map((event) => event.eventId), ["TRN_RCN_SEP"]);
  assert.equal(august.summary.selectedTotal, 2);
  assert.equal(september.summary.selectedTotal, 2);
  assert.equal(august.summary.monthlyDiscoveryCount, 1);
  assert.equal(september.summary.monthlyDiscoveryCount, 1);
  assert.ok(august.monthKeys.includes("2026-09"), "August GMR keeps later available purchase history");
  assert.equal(august.rows.find((row) => row.iRepsMeterId === r1.id).reconnected, "Yes", "Master context retains full lifecycle history");
});

test("source contains strict MONTHLY_GMR fieldRows and completed lifecycle allocation", () => {
  const source = readFileSync(new URL("../reports/generalMonthlyReport.js", import.meta.url), "utf8");
  assert.match(source, /GMR_GENERATION_MODE = "MONTHLY_GMR"/);
  assert.match(source, /const fieldRows = \[\]/);
  assert.match(source, /metadata\?\.createdAt/);
  assert.match(source, /workflow\?\.state/);
  assert.match(source, /workflow\?\.completedAt/);
  assert.doesNotMatch(source, /export const GMR_MONTH_KEYS/);
});
