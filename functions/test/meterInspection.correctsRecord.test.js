// MN-R001 8.2: an accepted inspection corrects the meter record — the finding
// and the meter's own details. The meter number and the GPS are not touched.
import test from "node:test";
import assert from "node:assert/strict";

import { validateMeterInspection } from "../meterLifecycle/helpers.js";

const photo = (tag) => ({ tag, url: `https://example.test/${tag}.jpg` });

const astDoc = {
  id: "AST_1",
  meterType: "electricity",
  status: { state: "CONNECTED" },
  ast: {
    astData: { astNo: "04297700454", meter: { type: "prepaid" } },
    anomalies: { anomaly: "Illegally Connected", anomalyDetail: "Bridge Wire On the Meter" },
  },
};

function inspection(overrides = {}) {
  return {
    id: "TRN_MINSP_1",
    trnType: "METER_INSPECTION",
    origin: { channel: "FIELD" },
    status: { state: "CONNECTED" },
    media: [photo("astNoPhoto")],
    inspection: {
      comparison: { hasDifferences: false },
      captured: {
        ast: {
          astData: {
            astNo: "04297700454",
            astManufacturer: "Conlog",
            astName: "Model X",
            meter: {
              type: "prepaid",
              category: "Normal",
              phase: "single",
              cb: { size: "60", comment: "" },
              seal: { sealNo: "", comment: "Seal Missing" },
              keypad: { serialNo: "K-1", comment: "" },
              ...overrides.meter,
            },
          },
          anomalies: { anomaly: "Meter Ok", anomalyDetail: "Operationally Ok", otherAnomalies: [] },
          normalisation: { actionTaken: ["none"] },
          location: { placement: "Pole Top", gps: { lat: -28.1, lng: 30.2 } },
          ogs: { hasOffGridSupply: "no" },
        },
      },
    },
  };
}

test("the finding the worker recorded becomes the meter's finding", () => {
  const result = validateMeterInspection({ data: inspection(), astDoc });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.astPatch["ast.anomalies.anomaly"], "Meter Ok");
  assert.equal(result.astPatch["ast.anomalies.anomalyDetail"], "Operationally Ok");
  assert.deepEqual(result.astPatch["ast.anomalies.otherAnomalies"], []);
  assert.deepEqual(result.astPatch["ast.normalisation"].actionTaken, ["none"]);
  assert.equal(result.astDataChanged, true);
});

test("the meter's own details are corrected, the meter number and GPS are not", () => {
  const patch = validateMeterInspection({ data: inspection(), astDoc }).astPatch;
  assert.equal(patch["ast.astData.astManufacturer"], "Conlog");
  assert.equal(patch["ast.astData.meter.phase"], "single");
  assert.equal(patch["ast.location.placement"], "Pole Top");
  assert.equal(patch["ast.ogs.hasOffGridSupply"], "no");
  assert.deepEqual(patch["ast.astData.meter.cb"], { size: "60", comment: "" });
  // a seal that has gone clears the old number and keeps the reason
  assert.deepEqual(patch["ast.astData.meter.seal"], { sealNo: "", comment: "Seal Missing" });
  for (const key of Object.keys(patch)) {
    assert.notEqual(key, "ast.astData.astNo");
    assert.ok(!key.includes("gps"), key);
  }
});

test("a field the worker was not asked for does not wipe what the record holds", () => {
  // A conventional meter has no keypad question, so nothing is written for it.
  const data = inspection();
  data.inspection.captured.ast.astData.meter.type = "conventional";
  data.inspection.captured.ast.astData.meter.keypad = { serialNo: "", comment: "" };
  data.inspection.captured.mreading = { reading: "1234", readingAt: "2026-09-23T00:00:00.000Z" };
  data.media = [photo("astNoPhoto"), photo("meterReadingPhoto")];

  const result = validateMeterInspection({
    data,
    astDoc: {
      ...astDoc,
      ast: { ...astDoc.ast, astData: { ...astDoc.ast.astData, meter: { type: "conventional" } } },
    },
  });

  assert.equal(result.ok, true, result.message);
  assert.equal("ast.astData.meter.keypad" in result.astPatch, false);
  assert.equal(result.astPatch["ast.astData.meter.type"], "conventional");
});
