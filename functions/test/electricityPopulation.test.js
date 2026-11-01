import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFieldMeterList,
  buildSalesPopulationRow,
  getElectricityPopulation,
  monthInJohannesburg,
} from "../dashboard/electricityPopulation.js";

const timestamp = (iso) => ({ toDate: () => new Date(iso) });

test("the found month is the Johannesburg calendar month", () => {
  assert.equal(monthInJohannesburg("2026-07-31T22:30:00.000Z"), "2026-08");
  assert.equal(monthInJohannesburg("2026-07-31T21:30:00.000Z"), "2026-07");
  assert.equal(monthInJohannesburg(timestamp("2026-06-15T10:00:00.000Z")), "2026-06");
  assert.equal(monthInJohannesburg(""), null);
  assert.equal(monthInJohannesburg("not a date"), null);
  assert.equal(monthInJohannesburg(null), null);
});

test("only electricity meters that are not removed or decommissioned, earliest month per meter", () => {
  const { meters, skipped } = buildFieldMeterList([
    { master: { id: "M2" }, meterType: "electricity", metadata: { createdAt: "2026-08-10T08:00:00Z" } },
    { master: { id: "M1" }, meterType: "Electricity", metadata: { createdAt: timestamp("2026-07-02T08:00:00Z") } },
    { master: { id: "M1" }, meterType: "electricity", metadata: { createdAt: "2026-06-20T08:00:00Z" } },
    { master: { id: "W1" }, meterType: "water", metadata: { createdAt: "2026-06-20T08:00:00Z" } },
    { master: { id: "M3" }, meterType: "electricity", status: { state: "REMOVED" }, metadata: { createdAt: "2026-06-20T08:00:00Z" } },
    { master: { id: "M5" }, meterType: "electricity", status: { state: "Decommissioned" }, metadata: { createdAt: "2026-06-20T08:00:00Z" } },
    { master: { id: "" }, meterType: "electricity", metadata: { createdAt: "2026-06-20T08:00:00Z" } },
    { master: { id: "M4" }, meterType: "electricity", metadata: {} },
  ]);
  assert.deepEqual(meters, [
    { meterNo: "M1", foundMonth: "2026-06" },
    { meterNo: "M2", foundMonth: "2026-08" },
  ]);
  assert.deepEqual(skipped, { notElectricity: 1, removed: 2, noMeterNumber: 1, noFoundDate: 1 });
});

function fakeDb({ role = "MNG", workbases = ["ZA5241"], asts = [], sales = [] } = {}) {
  const calls = [];
  return {
    calls,
    doc: () => ({ get: async () => ({ exists: true, data: () => ({ employment: { role }, access: { activeWorkbase: { id: workbases[0] }, workbases } }) }) }),
    collection: (name) => ({
      where: (field, op, value) => {
        calls.push({ name, field, op, value });
        const docs = name === "sales-all-meters"
          ? sales.map(([id, data]) => ({ id, data: () => data }))
          : asts.map((data) => ({ data: () => data }));
        return { select: () => ({ get: async () => ({ docs }) }) };
      },
    }),
  };
}

test("a Sales row reads GPS the same way as the Sales tables", () => {
  assert.deepEqual(
    [buildSalesPopulationRow("A", { hasUsableGps: true }).hasUsableGps, buildSalesPopulationRow("A", { hasUsableGps: true }).gpsAvailable],
    [true, true],
  );
  const fromCandidate = buildSalesPopulationRow("B", { erfCandidates: [{ Latitude: -28.1, Longitude: 30.2, hasValidGps: true }] });
  assert.deepEqual([fromCandidate.hasUsableGps, fromCandidate.gpsAvailable], [true, true]);
  const unknown = buildSalesPopulationRow("C", {});
  assert.deepEqual([unknown.hasUsableGps, unknown.gpsAvailable], [false, false]);
  const badCandidate = buildSalesPopulationRow("D", { erfCandidates: [{ Latitude: "", Longitude: 30.2 }] });
  assert.deepEqual([badCandidate.hasUsableGps, badCandidate.gpsAvailable], [false, false]);
  const noGps = buildSalesPopulationRow("E", { hasUsableGps: false });
  assert.deepEqual([noGps.hasUsableGps, noGps.gpsAvailable], [false, true]);
});

test("management users of the LM get the monthly figures; others are refused", async () => {
  const cat = (leakageCategory) => ({ leakageCategory, riskTier: "Normal", riskScore: 0 });
  const sales = [
    ["S1", { hasUsableGps: true, monthlyCategories: { "2026-07": cat("Normal"), "2026-08": cat("Normal") }, metadata: { updatedAt: "2026-09-06T02:22:17Z" } }],
    ["S2", { hasUsableGps: false, monthlyCategories: { "2026-08": cat("CAT4 - Long Gap (4+ months)") } }],
  ];
  const asts = [
    { master: { id: "F1" }, meterType: "electricity", metadata: { createdAt: "2026-07-20T08:00:00Z" } },
    { master: { id: "S2" }, meterType: "electricity", metadata: { createdAt: "2026-07-20T08:00:00Z" } },
  ];
  const db = fakeDb({ asts, sales });
  const result = await getElectricityPopulation({ db, request: { auth: { uid: "U1" }, data: { lmPcode: "ZA5241" } } });
  assert.equal(result.success, true);
  assert.deepEqual(result.months.map((m) => m.month), ["2026-07", "2026-08"]);
  const [july, august] = result.months;
  assert.deepEqual([july.onList, july.foundInField, july.total], [1, 2, 3]); // S2 found in July, listed from August
  assert.deepEqual([august.onList, august.foundInField, august.normal, august.targeted, august.withGps, august.withoutGps], [2, 1, 1, 1, 1, 1]);
  assert.equal(result.salesUpdatedAt, "2026-09-06T02:22:17.000Z");
  assert.deepEqual(db.calls, [
    { name: "sales-all-meters", field: "lmPcode", op: "==", value: "ZA5241" },
    { name: "asts", field: "accessData.parents.lmPcode", op: "==", value: "ZA5241" },
  ]);

  const request = { auth: { uid: "U1" }, data: { lmPcode: "ZA5241" } };
  await assert.rejects(getElectricityPopulation({ db: fakeDb(), request: { data: { lmPcode: "ZA5241" } } }), /Sign in/);
  await assert.rejects(getElectricityPopulation({ db: fakeDb({ role: "FWR" }), request }), /Only management users/);
  await assert.rejects(getElectricityPopulation({ db: fakeDb({ workbases: ["ZA9999"] }), request }), /one of your workbases/);
  await assert.rejects(getElectricityPopulation({ db: fakeDb(), request: { auth: { uid: "U1" }, data: { lmPcode: "bad" } } }), /valid LM/);
});
