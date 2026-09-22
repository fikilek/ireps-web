// MN-R001 1.2.0 / UI-R003: the removal asks for the instruction, Meter removed
// (Yes and a photo) and the reading. Safety confirmed was removed (owner,
// 22 Sep 2026), so a removal without it is accepted.
import test from "node:test";
import assert from "node:assert/strict";

import { validateMeterRemoval } from "../meterLifecycle/helpers.js";

const photo = (tag) => ({ tag, url: `https://example.test/${tag}.jpg` });

const astDoc = {
  id: "AST_1",
  meterType: "electricity",
  status: { state: "CONNECTED" },
  ast: { astData: { astNo: "04297700454", meter: { type: "prepaid" } } },
};

function removal({ tokenReading = "985", noReadingReason = "", media } = {}) {
  return {
    id: "TRN_MREM_1",
    trnType: "METER_REMOVAL",
    meterType: "electricity",
    origin: { channel: "FIELD", source: "METER_INSPECTION" },
    accessData: { access: { hasAccess: "yes" } },
    assignment: { instruction: { code: "METER_REMOVAL", text: "Replace meter – step 1: remove" } },
    removal: {
      meterRemoved: { answer: "yes", notes: "" },
      tokenReading,
      noReadingReason,
    },
    media: media || [photo("removalEvidence"), photo("tokenReadingPhoto")],
  };
}

test("a removal needs no safety answer or safety photo", () => {
  const result = validateMeterRemoval({ data: removal(), astDoc });
  assert.equal(result.ok, true, result.message);
});

test("a prepaid removal needs the remaining credit, or why it could not be captured", () => {
  const none = validateMeterRemoval({
    data: removal({ tokenReading: "", media: [photo("removalEvidence")] }),
    astDoc,
  });
  assert.equal(none.code, "TOKEN_READING_OR_REASON_REQUIRED");
  assert.match(none.message, /Remaining credit/);

  const reason = validateMeterRemoval({
    data: removal({
      tokenReading: "",
      noReadingReason: "Display blank / no reading",
      media: [photo("removalEvidence")],
    }),
    astDoc,
  });
  assert.equal(reason.ok, true, reason.message);
});
