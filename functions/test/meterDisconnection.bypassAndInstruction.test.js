// MN-R001 1.3.0: the bypass (a disconnection that follows a finding may be done
// on a meter recorded as Disconnected), and every disconnection says why.
import test from "node:test";
import assert from "node:assert/strict";

import { validateMeterDisconnection } from "../meterLifecycle/helpers.js";

const photo = (tag) => ({ tag, url: `https://example.test/${tag}.jpg` });

const meter = (state) => ({
  id: "AST_1",
  meterType: "electricity",
  status: { state },
  ast: { astData: { astNo: "04297700454", meter: { type: "prepaid" } } },
});

function disconnection({ origin, instructionText = "Illegal Connection" } = {}) {
  return {
    id: "TRN_MDCN_1",
    trnType: "METER_DISCONNECTION",
    meterType: "electricity",
    origin,
    accessData: { access: { hasAccess: "yes" } },
    assignment: { instruction: { code: "METER_DISCONNECTION", text: instructionText } },
    disconnection: { level: { code: "LEVEL_1_CB_ONLY", label: "Level 1 - Flip circuit breaker only" } },
    media: [photo("disconnectionLevelEvidence")],
  };
}

const afterInspection = {
  channel: "FIELD",
  source: "METER_INSPECTION",
  parentTrnId: "TRN_MINSP_1",
  parentTrnType: "METER_INSPECTION",
};
const fromMeterCard = { channel: "FIELD", source: "AST_ITEM" };

test("after a finding, a meter recorded as Disconnected may be disconnected (the bypass)", () => {
  const result = validateMeterDisconnection({
    data: disconnection({ origin: afterInspection }),
    astDoc: meter("DISCONNECTED"),
  });
  assert.equal(result.ok, true, result.message);
});

test("started any other way, a Disconnected meter still cannot be disconnected", () => {
  const result = validateMeterDisconnection({
    data: disconnection({ origin: fromMeterCard }),
    astDoc: meter("DISCONNECTED"),
  });
  assert.equal(result.code, "INVALID_AST_STATE");
});

test("a meter-card disconnection must say why", () => {
  const result = validateMeterDisconnection({
    data: disconnection({ origin: fromMeterCard, instructionText: "" }),
    astDoc: meter("CONNECTED"),
  });
  assert.equal(result.code, "DISCONNECTION_INSTRUCTION_REQUIRED");

  const withReason = validateMeterDisconnection({
    data: disconnection({ origin: fromMeterCard, instructionText: "Non Payment" }),
    astDoc: meter("CONNECTED"),
  });
  assert.equal(withReason.ok, true, withReason.message);
});
