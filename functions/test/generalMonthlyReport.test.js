import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGeneralMonthlyReportDataset,
  resolveGmrPeriod,
  validateGrDateRange,
  buildGmrNormalisationText,
  buildGmrFieldRow,
  getGmrReportMonthWindow,
  getGmrSalesCategory,
  getGmrSubmissionTime,
  isGmrTransactionInMonth,
  resolveGmrTeamAt,
  validateGmrReportMonth,
} from "../reports/generalMonthlyReport.js";

const SEPTEMBER = getGmrReportMonthWindow("2026-09");

function discovery(overrides = {}) {
  return {
    meterType: "electricity",
    accessData: {
      trnType: "METER_DISCOVERY",
      access: { hasAccess: "yes" },
      premise: { id: "PREM_1" },
      parents: { lmPcode: "ZA5241", wardPcode: "ZA5241006" },
    },
    ast: {
      astData: { astNo: "0714 1234567", meter: { type: "prepaid", phase: "single", seal: { sealNo: "S1" }, remainingCredit: "12.5" } },
      anomalies: { anomaly: "Meter Ok", anomalyDetail: "Operationally Ok" },
      normalisation: { actionTaken: ["None"], noActionReason: "" },
      location: { gps: { lat: -28.1, lng: 30.2 }, placement: "Outside" },
    },
    metadata: {
      createdAt: "2026-09-10T08:00:00.000Z",
      createdByUid: "U1",
      createdByUser: "Lefu Worker",
    },
    media: [{ tag: "astNoPhoto", url: "https://example.test/1.jpg" }],
    ...overrides,
  };
}

function disconnection(overrides = {}) {
  return {
    meterType: "electricity",
    accessData: {
      trnType: "METER_DISCONNECTION",
      access: { hasAccess: "yes" },
      premise: { id: "PREM_1" },
      parents: { lmPcode: "ZA5241", wardPcode: "ZA5241006" },
    },
    ast: { astData: { astId: "TRN_MD_1", astNo: "07141234567", meter: {} } },
    origin: { channel: "FIELD", parentTrnId: "TRN_MD_1", parentTrnType: "METER_DISCOVERY" },
    workflow: {
      state: "COMPLETED",
      completedAt: "2026-09-10T09:00:00.000Z",
      completedByUid: "U2",
      completedByUser: "Sipho Worker",
    },
    metadata: { createdAt: "2026-08-30T08:00:00.000Z", createdByUid: "MNG1", createdByUser: "Manager" },
    media: [],
    ...overrides,
  };
}

test("the month is South African time, the future is refused and the current month is incomplete", () => {
  assert.equal(SEPTEMBER.startIso, "2026-08-31T22:00:00.000Z");
  assert.equal(SEPTEMBER.endIso, "2026-09-30T22:00:00.000Z");
  assert.throws(() => validateGmrReportMonth("2026-10", new Date("2026-09-21T10:00:00Z")), /future/);
  assert.equal(validateGmrReportMonth("2026-09", new Date("2026-09-21T10:00:00Z")).isIncompleteMonth, true);
  assert.equal(validateGmrReportMonth("2026-08", new Date("2026-09-21T10:00:00Z")).isIncompleteMonth, false);
  assert.throws(() => getGmrReportMonthWindow("2026-13"), /YYYY-MM/);
});

test("work counts when it reached the server: creation with no workflow, completion with one", () => {
  assert.equal(getGmrSubmissionTime(discovery()), "2026-09-10T08:00:00.000Z");
  assert.equal(getGmrSubmissionTime(disconnection()), "2026-09-10T09:00:00.000Z");
  assert.equal(getGmrSubmissionTime(disconnection({ workflow: { state: "ACCEPTED" } })), null);

  const installation = discovery({ accessData: { ...discovery().accessData, trnType: "METER_INSTALLATION" } });
  assert.equal(getGmrSubmissionTime(installation), "2026-09-10T08:00:00.000Z");

  // 23:30 on 31 August, South African time, is still August.
  const lateAugust = discovery({ metadata: { createdAt: "2026-08-31T21:30:00.000Z" } });
  assert.equal(isGmrTransactionInMonth(lateAugust, SEPTEMBER), false);
  const earlySeptember = discovery({ metadata: { createdAt: "2026-08-31T22:00:00.000Z" } });
  assert.equal(isGmrTransactionInMonth(earlySeptember, SEPTEMBER), true);
  // An office instruction issued in August and completed in September is September's work.
  assert.equal(isGmrTransactionInMonth(disconnection(), SEPTEMBER), true);
});

function fakeDb(collections) {
  return {
    collection(name) {
      if (name === "registry_meters") throw new Error("The Meter Registry must never be read.");
      const store = collections[name] || {};
      return {
        doc: (id) => ({ collectionName: name, id }),
        where: (field, op, values) => ({
          get: async () => ({
            docs: Object.entries(store)
              .filter(([, data]) => op === "in" && values.includes(data[field]))
              .map(([id, data]) => ({ id, data: () => data })),
          }),
        }),
      };
    },
    async getAll(...refs) {
      return refs.map((ref) => {
        const data = (collections[ref.collectionName] || {})[ref.id];
        return { id: ref.id, exists: Boolean(data), data: () => data };
      });
    },
  };
}

test("a bad meter number does not stop the report, and completed work with no readable time is listed", async () => {
  const slashed = discovery();
  slashed.ast.astData.astNo = "12/34";
  const noTime = disconnection({ workflow: { state: "COMPLETED", completedAt: "", completedByUid: "U2" }, metadata: { createdAt: "2026-09-02T08:00:00.000Z" } });
  const dataset = await buildGeneralMonthlyReportDataset({
    db: fakeDb({}),
    reportMonth: "2026-09",
    generatedAt: new Date("2026-09-21T10:00:00.000Z"),
    loadTransactions: async () => new Map([["TRN_SLASH", slashed], ["TRN_NO_TIME", noTime]]),
  });
  assert.deepEqual(dataset.fieldRows.map((row) => row.trnId), ["TRN_SLASH"]);
  assert.equal(dataset.fieldRows[0].onVendingList, null);
  assert.equal(dataset.unplaced.length, 1);
  assert.equal(dataset.unplaced[0].trnId, "TRN_NO_TIME");
  assert.match(dataset.unplaced[0].reason, /completion time cannot be read/);
});

// GMR-R037
test("a General Report takes any range, in South African time, and never the future", () => {
  const now = new Date("2026-09-25T10:00:00Z");
  const window = validateGrDateRange({ startDate: "2026-08-01", endDate: "2026-09-15" }, now);
  assert.equal(window.reportKind, "GR");
  assert.equal(window.periodLabel, "1 Aug 2026 to 15 Sep 2026");
  assert.equal(window.startIso, "2026-07-31T22:00:00.000Z");
  assert.equal(window.endIso, "2026-09-15T22:00:00.000Z", "the end includes the whole of that day");
  assert.throws(() => validateGrDateRange({ startDate: "2026-09-15", endDate: "2026-08-01" }, now), /on or before/);
  assert.throws(() => validateGrDateRange({ startDate: "2026-09-01", endDate: "2026-09-30" }, now), /future/);
  assert.throws(() => validateGrDateRange({ startDate: "", endDate: "2026-09-15" }, now), /start date and an end date/);

  const month = resolveGmrPeriod({ mode: "MONTHLY_GMR", reportMonth: "2026-08" }, now);
  assert.equal(month.reportKind, "GMR");
  assert.equal(month.periodLabel, "August 2026");
});

test("a General Report says it is not the payment record, and keeps the same rows", async () => {
  const dataset = await buildGeneralMonthlyReportDataset({
    db: fakeDb({}),
    mode: "GENERAL_REPORT",
    startDate: "2026-09-09",
    endDate: "2026-09-10",
    generatedAt: new Date("2026-09-25T10:00:00.000Z"),
    loadTransactions: async () => new Map([["TRN_MD_1", discovery()], ["TRN_DCN_1", disconnection()]]),
  });

  assert.equal(dataset.reportKind, "GR");
  assert.equal(dataset.reportType, "GENERAL_REPORT");
  assert.equal(dataset.isPaymentRecord, false);
  assert.match(dataset.notForPaymentNotice, /never the record the municipality pays on/);
  assert.equal(dataset.periodLabel, "9 Sep 2026 to 10 Sep 2026");
  assert.equal(dataset.reportMonth, null);
  assert.deepEqual(dataset.fieldRows.map((row) => row.trnId), ["TRN_MD_1", "TRN_DCN_1"]);
});

test("a discovery row carries the schema columns from the transaction and its enrichment", () => {
  const row = buildGmrFieldRow({
    trnId: "TRN_MD_1",
    trn: discovery({ targetedBatchContext: { tbId: "TB_9", meterNo: "07141234567", salesDocId: "07141234567" } }),
    reportMonth: "2026-09",
    premise: { address: { strNo: "14", strName: "VAN RENSBURG", strType: "STREET", suburbName: "Dundee" }, propertyType: { type: "Residential", name: "Block A", unitNo: "A1" } },
    sales: { monthlyCategories: { "2026-09": { leakageCategory: "CAT4 - Long Gap", riskTier: "Medium", riskScore: 40 } } },
    fieldSalesExists: true,
    ast: { master: { visibility: "VISIBLE" } },
    team: "Kaizer Team",
  });

  assert.equal(row.trnId, "TRN_MD_1");
  assert.equal(row.trnTypeLabel, "Meter Discovery");
  assert.equal(row.channel, "Field");
  assert.equal(row.fieldWorkerName, "Lefu Worker");
  assert.equal(row.team, "Kaizer Team");
  assert.equal(row.batchId, "TB_9");
  assert.equal(row.streetName, "Van Rensburg");
  assert.equal(row.ward, "Ward 6");
  assert.equal(row.meterMode, "Prepaid");
  assert.equal(row.meterPhase, "Single Phase");
  assert.equal(row.fieldFoundMeterNo, "07141234567");
  assert.equal(row.sameDifferent, "Same");
  assert.equal(row.salesCategory, "CAT4 - Long Gap");
  assert.equal(row.primaryFinding, "Meter Ok");
  assert.equal(row.findingGroup, "Meter Ok · Operationally Ok");
  assert.equal(row.normalisation, "Meter Ok - None", "every row carries its finding");
  assert.equal(row.noActionReason, null);
  assert.equal(row.visibility, "Visible");
  assert.equal(row.onVendingList, "Yes");
  assert.deepEqual(row.photoUrls, ["https://example.test/1.jpg"]);
});

test("work outside a batch is AD HOC and a water meter is never judged against the vending list", () => {
  const row = buildGmrFieldRow({ trnId: "T", trn: discovery({ meterType: "water" }), reportMonth: "2026-09" });
  assert.equal(row.batchId, "AD HOC");
  assert.equal(row.onVendingList, null);
  const electricity = buildGmrFieldRow({ trnId: "T", trn: discovery(), reportMonth: "2026-09", fieldSalesExists: false });
  assert.equal(electricity.onVendingList, "No");
});

test("no access is its own row with the recorded reason", () => {
  const trn = discovery({
    accessData: { ...discovery().accessData, access: { hasAccess: "no", reason: "Gate locked" } },
    ast: {},
  });
  const row = buildGmrFieldRow({ trnId: "T", trn, reportMonth: "2026-09" });
  assert.equal(row.primaryFinding, "No Access");
  assert.equal(row.findingDetail, "Gate locked");
  assert.equal(row.findingGroup, "No Access");
  assert.equal(row.hasAccess, false);
});

test("a finding left with no action shows the reason, and a suspicion is not a healthy meter", () => {
  const trn = discovery();
  trn.ast.anomalies = { anomaly: "Illegally Connected", anomalyDetail: "Bridge Wire On The Meter" };
  trn.ast.normalisation = { actionTaken: ["None"], noActionReason: "Not recorded - captured before this rule" };
  const row = buildGmrFieldRow({ trnId: "T", trn, reportMonth: "2026-09" });
  assert.equal(row.noActionReason, "Not recorded - captured before this rule");
  assert.equal(row.findingGroup, "Illegally Connected");
  assert.equal(row.followUpStatus, null);

  const suspicion = discovery();
  suspicion.ast.anomalies = { anomaly: "Meter Ok", anomalyDetail: "Bypass Suspicion" };
  assert.equal(buildGmrFieldRow({ trnId: "T", trn: suspicion, reportMonth: "2026-09" }).findingGroup, "Meter Ok · Suspicion");
});

test("what a finding called for: done, not started, or recorded before the follow-up existed", () => {
  const done = discovery();
  done.ast.anomalies = { anomaly: "Illegally Connected", anomalyDetail: "Bridge Wire On The Meter" };
  done.ast.normalisation = {
    actionTaken: ["Disconnect meter"],
    noActionReason: "",
    followUp: { required: "METER_DISCONNECTION", status: "Completed", trnId: "TRN_DCN_1" },
  };
  const doneRow = buildGmrFieldRow({ trnId: "T", trn: done, reportMonth: "2026-09" });
  assert.equal(doneRow.followUpRequired, "Meter Disconnection");
  assert.equal(doneRow.followUpStatus, "Completed");
  assert.equal(doneRow.followUpTrnId, "TRN_DCN_1");

  const old = discovery();
  old.ast.anomalies = { anomaly: "Illegally Connected", anomalyDetail: "Bridge Wire On The Meter" };
  old.ast.normalisation = { actionTaken: ["Disconnect meter"], noActionReason: "" };
  const oldRow = buildGmrFieldRow({ trnId: "T", trn: old, reportMonth: "2026-09" });
  assert.equal(oldRow.followUpStatus, "No disconnection record");
  assert.equal(oldRow.followUpRequired, "Meter Disconnection");
});

test("an inspection is read from what it captured, like a discovery", () => {
  const inspection = disconnection({
    accessData: { ...disconnection().accessData, trnType: "METER_INSPECTION" },
    origin: { channel: "OFFICE" },
    inspection: {
      captured: {
        ast: {
          astData: { astNo: "07141234567", meter: { type: "prepaid", phase: "three" } },
          anomalies: { anomaly: "Meter Faulty", anomalyDetail: "Meter Display Blank" },
          normalisation: { actionTaken: ["Meter replaced"], noActionReason: "" },
        },
      },
    },
  });
  const row = buildGmrFieldRow({ trnId: "T", trn: inspection, reportMonth: "2026-09" });
  assert.equal(row.trnTypeLabel, "Meter Inspection");
  assert.equal(row.channel, "Office");
  assert.equal(row.fieldWorkerName, "Sipho Worker");
  assert.equal(row.primaryFinding, "Meter Faulty");
  assert.equal(row.findingGroup, "Meter Faulty");
  assert.equal(row.normalisation, "Meter Faulty - Meter replaced");
  assert.equal(row.meterPhase, "Three Phase");
});

test("a disconnection names who completed it and the finding it followed", () => {
  const row = buildGmrFieldRow({ trnId: "TRN_DCN_1", trn: disconnection(), reportMonth: "2026-09" });
  assert.equal(row.fieldWorkerName, "Sipho Worker");
  assert.equal(row.channel, "Field");
  assert.equal(row.startedFrom, "TRN_MD_1");
  assert.equal(row.primaryFinding, null);
  assert.equal(row.findingGroup, null);
  assert.equal(row.batchId, "AD HOC");
});

test("the team is the one the worker was in when the work was submitted", () => {
  const periods = [
    { userUid: "U1", teamId: "T_A", teamName: "Team A", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: "2026-09-05T00:00:00.000Z" },
    { userUid: "U1", teamId: "T_B", teamName: "Team B", joinedAt: "2026-09-05T00:00:00.000Z", leftAt: null },
    { userUid: "U3", teamId: "T_A", teamName: "Team A", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: null },
    { userUid: "U3", teamId: "T_B", teamName: "Team B", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: null },
  ];
  assert.equal(resolveGmrTeamAt(periods, "U1", "2026-09-01T10:00:00.000Z"), "Team A");
  assert.equal(resolveGmrTeamAt(periods, "U1", "2026-09-10T10:00:00.000Z"), "Team B");
  assert.equal(resolveGmrTeamAt(periods, "U3", "2026-09-10T10:00:00.000Z"), "Multiple");
  assert.equal(resolveGmrTeamAt(periods, "U9", "2026-09-10T10:00:00.000Z"), "Unassigned");
});

test("the Sales category is the reporting month's only, and a malformed month is not used", () => {
  const sales = {
    leakageCategory: "LEGACY",
    monthlyCategories: {
      "2026-08": { leakageCategory: "AUGUST", riskTier: "Low", riskScore: 0 },
      "2026-09": { leakageCategory: "SEPTEMBER", riskScore: 2 },
    },
  };
  assert.equal(getGmrSalesCategory(sales, "2026-08"), "AUGUST");
  assert.equal(getGmrSalesCategory(sales, "2026-09"), null);
  assert.equal(getGmrSalesCategory(sales, "2026-07"), null);
});

// GMR-R035
test("the normalisation column carries the finding that caused it", () => {
  const read = (options) => buildGmrNormalisationText(options);
  assert.equal(read({ finding: "Illegally Connected", actions: ["Disconnect meter"] }), "Illegally Connected - Disconnect meter");
  assert.equal(read({ finding: "Meter Ok", actions: ["None"] }), "Meter Ok - None", "every row carries its finding");
  assert.equal(read({ finding: "Meter Ok", actions: ["none"] }), "Meter Ok - none", "the old lowercase word is not treated as None: uncleaned data shows itself");
  assert.equal(read({ finding: "Meter Ok", actions: ["Tamper removed"] }), "Meter Ok - Tamper removed", "a fix on the spot, too");
  assert.equal(
    read({ finding: "Illegally Connected", actions: ["Disconnect meter", "Tamper removed"] }),
    "Illegally Connected - Disconnect meter, Tamper removed",
    "more than one thing done, in the order recorded",
  );
  // The reason stands beside None, never in place of it: the form's answer is
  // never hidden (owner, 25 September 2026).
  assert.equal(
    read({ finding: "Illegally Connected", actions: ["None"], noActionReason: "Not recorded - captured before this rule" }),
    'Illegally Connected - None, reason "Not recorded - captured before this rule"',
  );
  assert.equal(
    read({ finding: "Illegally Connected", actions: [], noActionReason: "Threatened or chased away" }),
    'Illegally Connected - None, reason "Threatened or chased away"',
  );
  assert.equal(
    read({ finding: "Meter Faulty", actions: ["None"], noActionReason: "No meter available to replace" }),
    'Meter Faulty - None, reason "No meter available to replace"',
  );
  assert.equal(read({ finding: "Illegally Connected", actions: ["None"] }), "Illegally Connected - None", "nothing done, nothing said");
  assert.equal(read({ finding: "Meter Ok", actions: ["None"], hasAccess: false }), "No Access", "no meter, so nothing to join");
  assert.equal(read({ finding: "Meter Ok", actions: [], isWater: true }), "Meter Ok", "water carries no normalisation");
  assert.equal(read({ finding: null, actions: ["Disconnect meter"] }), "NAv - Disconnect meter", "a missing side reads NAv, never a dropped dash");
  assert.equal(read({ finding: null, actions: [] }), "NAv - None", "an inspection that recorded no finding keeps the column's shape");
});

test("a meter number that is not a real number is shown but never looked up on Sales", () => {
  const trn = discovery();
  trn.ast.astData.astNo = "N/AV";
  const row = buildGmrFieldRow({ trnId: "T", trn, reportMonth: "2026-09" });
  assert.equal(row.fieldFoundMeterNo, "N/AV");
  assert.equal(row.onVendingList, null);
});

test("the dataset is the month's submitted transactions, in time order, never read from the registry", async () => {
  const unfinished = disconnection({ workflow: { state: "ACCEPTED" } });
  const transactions = new Map([
    ["TRN_DCN_1", disconnection()],
    ["TRN_MD_1", discovery()],
    ["TRN_DCN_OPEN", unfinished],
    ["TRN_MD_AUG", discovery({ metadata: { createdAt: "2026-08-20T08:00:00.000Z", createdByUid: "U1", createdByUser: "Lefu Worker" } })],
  ]);
  const db = fakeDb({
    premises: { PREM_1: { address: { strNo: "14" } } },
    "sales-all-meters": {},
    asts: { TRN_MD_1: { master: { visibility: "INVISIBLE" } } },
    team_member_history: {
      h1: { userUid: "U1", teamId: "T_A", teamName: "Team A", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: null },
    },
  });

  const dataset = await buildGeneralMonthlyReportDataset({
    db,
    reportMonth: "2026-09",
    generatedAt: new Date("2026-09-21T10:00:00.000Z"),
    loadTransactions: async () => transactions,
  });

  assert.deepEqual(dataset.fieldRows.map((row) => row.trnId), ["TRN_MD_1", "TRN_DCN_1"]);
  assert.equal(dataset.summary.payableTotal, 2);
  assert.equal(dataset.summary.unplacedCount, 0);
  assert.equal(dataset.isIncompleteMonth, true);
  assert.equal(dataset.fieldRows[0].team, "Team A");
  assert.equal(dataset.fieldRows[0].visibility, "Invisible");
  assert.equal(dataset.fieldRows[0].onVendingList, "No");
  assert.equal(dataset.fieldRows[1].team, "Unassigned");
  assert.equal(dataset.photoColumnCount, 1);
});
