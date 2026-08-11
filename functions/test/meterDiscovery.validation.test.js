import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  METER_DISCOVERY_VALIDATION_METADATA,
  validateMeterDiscoveryPayload,
} from "../meterDiscovery/validation.js";

const media = (...tags) => tags.map((tag) => ({
  tag,
  url: `https://example.test/${tag}.jpg`,
}));

function baseAccessData() {
  return {
    trnType: "METER_DISCOVERY",
    erfId: "ERF_1",
    erfNo: "100",
    parents: {
      countryPcode: "ZA",
      provincePcode: "ZA5",
      dmPcode: "ZA52",
      lmPcode: "ZA5241",
      wardPcode: "ZA5241002",
    },
    premise: {
      id: "PREM_1",
      address: "1 TEST STREET",
      propertyType: "ERF RESIDENTIAL",
    },
    access: {
      hasAccess: "yes",
      reason: "NAv",
    },
  };
}

function baseElectricity(overrides = {}) {
  const payload = {
    id: "TRN_MDIS_1_ELC_ZA5241002_100",
    accessData: baseAccessData(),
    ast: {
      astData: {
        astNo: "04085348920",
        astManufacturer: "Conlog",
        astName: "Model X",
        meter: {
          phase: "single",
          type: "prepaid",
          category: "Normal",
          seal: { sealNo: "S-1", comment: "" },
          keypad: { serialNo: "K-1", comment: "" },
          cb: { size: "60A", comment: "" },
        },
      },
      anomalies: {
        anomaly: "Meter Ok",
        anomalyDetail: "Operationally Ok",
        otherAnomalies: [],
      },
      ogs: { hasOffGridSupply: "no" },
      normalisation: { actionTaken: ["none"] },
      location: {
        placement: "Boundary Wall",
        gps: { lat: -28.16, lng: 30.23 },
      },
    },
    meterType: "electricity",
    media: media("astNoPhoto", "sealPhoto", "keypadPhoto", "astCbPhoto"),
    status: { state: "CONNECTED" },
    serviceProvider: { id: "SP_1", name: "Provider" },
  };

  return deepMerge(payload, overrides);
}

function baseWater(subtype = "conventional", overrides = {}) {
  const payload = {
    id: "TRN_MDIS_1_WTR_ZA5241002_100",
    accessData: baseAccessData(),
    ast: {
      astData: {
        astNo: "WATER-1",
        astManufacturer: "Itron",
        astName: "Water Model",
        meter: {
          type: subtype,
          category: "Normal",
        },
      },
      anomalies: {
        anomaly: "Meter Ok",
        anomalyDetail: "Operationally Ok",
        otherAnomalies: [],
      },
      location: {
        gps: { lat: -28.16, lng: 30.23 },
      },
    },
    meterType: "water",
    media: media(
      "astNoPhoto",
      subtype === "conventional" ? "meterReadingPhoto" : "tokenReadingPhoto",
    ),
    status: { state: "CONNECTED" },
    serviceProvider: { id: "SP_1", name: "Provider" },
    mreadings: subtype === "conventional" ? [{ reading: "1234" }] : [],
    treadings: subtype === "prepaid" ? [{ tokenReading: "4567" }] : [],
  };

  return deepMerge(payload, overrides);
}

function deepMerge(target, source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return source === undefined ? structuredClone(target) : structuredClone(source);
  }

  const output = structuredClone(target);
  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      output[key] &&
      typeof output[key] === "object" &&
      !Array.isArray(output[key])
    ) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = structuredClone(value);
    }
  }
  return output;
}

function expectPass(payload) {
  assert.equal(validateMeterDiscoveryPayload({ data: payload }), null);
}

function expectCode(payload, code) {
  const result = validateMeterDiscoveryPayload({ data: payload });
  assert.equal(result?.success, false);
  assert.equal(result?.code, code);
}

test("baseline canonical electricity discovery passes", () => {
  expectPass(baseElectricity());
});

test("baseline canonical water discoveries pass", () => {
  expectPass(baseWater("conventional"));
  expectPass(baseWater("prepaid"));
});

test("no-access discovery requires NA, reason and uploaded photo", () => {
  const good = {
    id: "TRN_MDIS_1_NA_ZA5241002_100",
    accessData: {
      ...baseAccessData(),
      access: { hasAccess: "no", reason: "Property Locked" },
    },
    ast: null,
    meterType: "NA",
    media: media("noAccessPhoto"),
  };
  expectPass(good);
  expectCode({ ...good, meterType: "electricity" }, "INVALID_NO_ACCESS_METER_TYPE");
  expectCode(deepMerge(good, { accessData: { access: { reason: "   " } } }), "NO_ACCESS_REASON_REQUIRED");
  expectCode({ ...good, media: [] }, "NO_ACCESS_PHOTO_REQUIRED");
  expectCode({ ...good, media: [{ tag: "noAccessPhoto" }] }, "NO_ACCESS_PHOTO_REQUIRED");
});

test("common discovery identity, field, status and GPS gates remain enforced", () => {
  expectCode(deepMerge(baseElectricity(), { id: "BAD_1" }), "INVALID_TRN_ID");
  expectCode(deepMerge(baseElectricity(), { accessData: { trnType: "OTHER" } }), "INVALID_TRN_TYPE");
  expectCode(deepMerge(baseElectricity(), { ast: { astData: { astNo: "   " } } }), "MISSING_REQUIRED_FIELD");
  expectCode(deepMerge(baseElectricity(), { status: { state: "FIELD" } }), "INVALID_METER_STATUS");
  expectCode(deepMerge(baseElectricity(), { ast: { location: { gps: null } } }), "INVALID_METER_GPS");
  expectCode(deepMerge(baseElectricity(), { ast: { location: { gps: { lat: 0, lng: 0 } } } }), "INVALID_METER_GPS");
  expectCode(deepMerge(baseElectricity(), { ast: { location: { gps: { lat: -91, lng: 30 } } } }), "INVALID_METER_GPS");
});

test("electricity phase, subtype, category and placement mirror Formik choices", () => {
  expectCode(deepMerge(baseElectricity(), { ast: { astData: { meter: { phase: "two" } } } }), "INVALID_METER_PHASE");
  expectCode(deepMerge(baseElectricity(), { ast: { astData: { meter: { type: "smart" } } } }), "INVALID_METER_SUBTYPE");
  expectCode(deepMerge(baseElectricity(), { ast: { astData: { meter: { category: "Special" } } } }), "INVALID_METER_CATEGORY");
  expectCode(deepMerge(baseElectricity(), { ast: { location: { placement: " " } } }), "METER_PLACEMENT_REQUIRED");
});

test("canonical custom manufacturer is accepted without Formik helper field", () => {
  expectPass(deepMerge(baseElectricity(), {
    ast: { astData: { astManufacturer: "Custom Meter Works" } },
  }));
});

test("literal Other manufacturer is rejected as non-canonical", () => {
  expectCode(
    deepMerge(baseElectricity(), {
      ast: { astData: { astManufacturer: "Other" } },
    }),
    "NON_CANONICAL_MANUFACTURER_OTHER",
  );
});

for (const [reason, photoRequired] of Object.entries(
  METER_DISCOVERY_VALIDATION_METADATA.sealCommentEvidence,
)) {
  test(`seal reason '${reason}' mirrors photoRequired=${photoRequired}`, () => {
    const payload = deepMerge(baseElectricity(), {
      ast: { astData: { meter: { seal: { sealNo: "", comment: reason } } } },
      media: media("astNoPhoto", "keypadPhoto", "astCbPhoto"),
    });
    if (photoRequired) {
      expectCode(payload, "SEAL_PHOTO_REQUIRED");
      payload.media.push(...media("sealPhoto"));
    }
    expectPass(payload);
  });
}

test("literal Other seal comment is rejected when seal number is absent", () => {
  expectCode(
    deepMerge(baseElectricity(), {
      ast: { astData: { meter: { seal: { sealNo: "", comment: "Other" } } } },
      media: media("astNoPhoto", "keypadPhoto", "astCbPhoto"),
    }),
    "NON_CANONICAL_SEAL_COMMENT_OTHER",
  );
});

test("seal captured value requires photo; missing/custom no-photo reason is accepted", () => {
  expectCode(deepMerge(baseElectricity(), {
    media: media("astNoPhoto", "keypadPhoto", "astCbPhoto"),
  }), "SEAL_PHOTO_REQUIRED");

  expectPass(deepMerge(baseElectricity(), {
    ast: { astData: { meter: { seal: { sealNo: "", comment: "Seal Missing" } } } },
    media: media("astNoPhoto", "keypadPhoto", "astCbPhoto"),
  }));

  expectPass(deepMerge(baseElectricity(), {
    ast: { astData: { meter: { seal: { sealNo: "", comment: "Custom field explanation" } } } },
    media: media("astNoPhoto", "keypadPhoto", "astCbPhoto"),
  }));

  expectCode(deepMerge(baseElectricity(), {
    ast: { astData: { meter: { seal: { sealNo: "", comment: "" } } } },
  }), "SEAL_NUMBER_OR_COMMENT_REQUIRED");
});

for (const [reason, photoRequired] of Object.entries(
  METER_DISCOVERY_VALIDATION_METADATA.keypadCommentEvidence,
)) {
  test(`prepaid keypad reason '${reason}' mirrors photoRequired=${photoRequired}`, () => {
    const payload = deepMerge(baseElectricity(), {
      ast: { astData: { meter: { keypad: { serialNo: "", comment: reason } } } },
      media: media("astNoPhoto", "sealPhoto", "astCbPhoto"),
    });
    if (photoRequired) {
      expectCode(payload, "KEYPAD_PHOTO_REQUIRED");
      payload.media.push(...media("keypadPhoto"));
    }
    expectPass(payload);
  });
}

test("literal Other keypad comment is rejected when serial number is absent", () => {
  expectCode(
    deepMerge(baseElectricity(), {
      ast: { astData: { meter: { keypad: { serialNo: "", comment: "Other" } } } },
      media: media("astNoPhoto", "sealPhoto", "astCbPhoto"),
    }),
    "NON_CANONICAL_KEYPAD_COMMENT_OTHER",
  );
});

test("prepaid keypad supports no-photo and custom comments but still requires serial or comment", () => {
  expectPass(deepMerge(baseElectricity(), {
    ast: { astData: { meter: { keypad: { serialNo: "", comment: "Keypad Missing" } } } },
    media: media("astNoPhoto", "sealPhoto", "astCbPhoto"),
  }));
  expectPass(deepMerge(baseElectricity(), {
    ast: { astData: { meter: { keypad: { serialNo: "", comment: "Custom keypad explanation" } } } },
    media: media("astNoPhoto", "sealPhoto", "astCbPhoto"),
  }));
  expectCode(deepMerge(baseElectricity(), {
    ast: { astData: { meter: { keypad: { serialNo: "", comment: "" } } } },
  }), "KEYPAD_SERIAL_OR_COMMENT_REQUIRED");
});

test("conventional electricity does not require keypad evidence", () => {
  expectPass(deepMerge(baseElectricity(), {
    ast: { astData: { meter: { type: "conventional", keypad: { serialNo: "", comment: "" } } } },
    media: media("astNoPhoto", "sealPhoto", "astCbPhoto"),
  }));
});

for (const [reason, photoRequired] of Object.entries(
  METER_DISCOVERY_VALIDATION_METADATA.cbCommentEvidence,
)) {
  test(`CB reason '${reason}' mirrors photoRequired=${photoRequired}`, () => {
    const payload = deepMerge(baseElectricity(), {
      ast: { astData: { meter: { cb: { size: "", comment: reason } } } },
      media: media("astNoPhoto", "sealPhoto", "keypadPhoto"),
    });
    if (photoRequired) {
      expectCode(payload, "CB_PHOTO_REQUIRED");
      payload.media.push(...media("astCbPhoto"));
    }
    expectPass(payload);
  });
}

test("literal Other CB comment is rejected when CB size is absent", () => {
  expectCode(
    deepMerge(baseElectricity(), {
      ast: { astData: { meter: { cb: { size: "", comment: "Other" } } } },
      media: media("astNoPhoto", "sealPhoto", "keypadPhoto"),
    }),
    "NON_CANONICAL_CB_COMMENT_OTHER",
  );
});

test("CB supports no-photo and custom comments but still requires size or comment", () => {
  expectPass(deepMerge(baseElectricity(), {
    ast: { astData: { meter: { cb: { size: "", comment: "Circuit Breaker Inaccessible" } } } },
    media: media("astNoPhoto", "sealPhoto", "keypadPhoto"),
  }));
  expectPass(deepMerge(baseElectricity(), {
    ast: { astData: { meter: { cb: { size: "", comment: "Custom CB explanation" } } } },
    media: media("astNoPhoto", "sealPhoto", "keypadPhoto"),
  }));
  expectCode(deepMerge(baseElectricity(), {
    ast: { astData: { meter: { cb: { size: "", comment: "" } } } },
  }), "CB_SIZE_OR_COMMENT_REQUIRED");
});

test("off-grid status is required and yes requires evidence", () => {
  expectCode(deepMerge(baseElectricity(), { ast: { ogs: { hasOffGridSupply: "" } } }), "OFF_GRID_STATUS_REQUIRED");
  expectCode(deepMerge(baseElectricity(), { ast: { ogs: { hasOffGridSupply: "yes" } } }), "OFF_GRID_PHOTO_REQUIRED");
  expectPass(deepMerge(baseElectricity(), {
    ast: { ogs: { hasOffGridSupply: "yes" } },
    media: media("astNoPhoto", "sealPhoto", "keypadPhoto", "astCbPhoto", "ogsPhoto"),
  }));
  expectPass(deepMerge(baseElectricity(), { ast: { ogs: { hasOffGridSupply: "no" } } }));
  // Yup only requires a nonempty string; the UI supplies yes/no. Do not strengthen it here.
  expectPass(deepMerge(baseElectricity(), { ast: { ogs: { hasOffGridSupply: "unknown" } } }));
});

test("normalisation preserves Yup empty-array semantics and requires photo only for intervention", () => {
  expectCode(deepMerge(baseElectricity(), { ast: { normalisation: { actionTaken: null } } }), "NORMALISATION_ACTIONS_REQUIRED");
  expectPass(deepMerge(baseElectricity(), { ast: { normalisation: { actionTaken: [] } } }));
  expectPass(deepMerge(baseElectricity(), { ast: { normalisation: { actionTaken: ["none"] } } }));
  expectCode(deepMerge(baseElectricity(), { ast: { normalisation: { actionTaken: ["Issue Fine"] } } }), "NORMALISATION_PHOTO_REQUIRED");
  expectPass(deepMerge(baseElectricity(), {
    ast: { normalisation: { actionTaken: ["Issue Fine"] } },
    media: media("astNoPhoto", "sealPhoto", "keypadPhoto", "astCbPhoto", "normalisationPhoto"),
  }));
  expectCode(deepMerge(baseElectricity(), { ast: { normalisation: { actionTaken: [null] } } }), "INVALID_NORMALISATION_ACTION");
  // Yup does not restrict action values to norm_actions; evidence still follows any non-none action.
  expectPass(deepMerge(baseElectricity(), {
    ast: { normalisation: { actionTaken: ["Custom Intervention"] } },
    media: media("astNoPhoto", "sealPhoto", "keypadPhoto", "astCbPhoto", "normalisationPhoto"),
  }));
});

test("other anomalies allow configured unique values and reject invalid or duplicates", () => {
  const withoutOtherAnomalies = baseElectricity();
  delete withoutOtherAnomalies.ast.anomalies.otherAnomalies;
  expectPass(withoutOtherAnomalies);

  expectPass(deepMerge(baseElectricity(), {
    ast: { anomalies: { otherAnomalies: ["Meter Not Registered", "Keypad Faulty"] } },
  }));
  expectCode(deepMerge(baseElectricity(), {
    ast: { anomalies: { otherAnomalies: ["Not Configured"] } },
  }), "INVALID_OTHER_ANOMALY");
  expectCode(deepMerge(baseElectricity(), {
    ast: { anomalies: { otherAnomalies: ["Keypad Faulty", "Keypad Faulty"] } },
  }), "DUPLICATE_OTHER_ANOMALY");
  expectCode(deepMerge(baseElectricity(), {
    ast: { anomalies: { otherAnomalies: "Keypad Faulty" } },
  }), "INVALID_OTHER_ANOMALIES");
});

test("anomaly photo is conditional exactly as the mobile form", () => {
  expectPass(baseElectricity());
  expectCode(deepMerge(baseElectricity(), {
    ast: { anomalies: { anomaly: "Meter Faulty", anomalyDetail: "Meter Display Blank" } },
  }), "ANOMALY_PHOTO_REQUIRED");
  expectPass(deepMerge(baseElectricity(), {
    ast: { anomalies: { anomaly: "Meter Faulty", anomalyDetail: "Meter Display Blank" } },
    media: media("astNoPhoto", "sealPhoto", "keypadPhoto", "astCbPhoto", "anomalyPhoto"),
  }));
});

test("water conventional reading and photo are both required in canonical arrays", () => {
  expectCode(deepMerge(baseWater("conventional"), { mreadings: [] }), "METER_READING_REQUIRED");
  expectCode(deepMerge(baseWater("conventional"), {
    media: media("astNoPhoto"),
  }), "METER_READING_PHOTO_REQUIRED");
});

test("water prepaid token reading and photo are both required in canonical arrays", () => {
  expectCode(deepMerge(baseWater("prepaid"), { treadings: [] }), "TOKEN_READING_REQUIRED");
  expectCode(deepMerge(baseWater("prepaid"), {
    media: media("astNoPhoto"),
  }), "TOKEN_READING_PHOTO_REQUIRED");
});

test("legacy water reading locations remain accepted as fallback", () => {
  expectPass(deepMerge(baseWater("conventional"), {
    mreadings: [],
    ast: { meterReading: "111" },
  }));
  expectPass(deepMerge(baseWater("prepaid"), {
    treadings: [],
    ast: { tokenReading: "222" },
  }));
});

test("malformed media cannot satisfy evidence gates", () => {
  expectCode(deepMerge(baseElectricity(), { media: null }), "METER_PHOTO_REQUIRED");
  expectCode(deepMerge(baseElectricity(), { media: [{ tag: "astNoPhoto" }] }), "METER_PHOTO_REQUIRED");
});

test("Meter Installation stays on the unchanged legacy validator while both discovery paths share the new validator", async () => {
  const source = await readFile(new URL("../index.js", import.meta.url), "utf8");

  const trigger = source.slice(
    source.indexOf("export const onMeterDiscoveryCreated"),
    source.indexOf("export const onNoAccessRecorded"),
  );
  const callable = source.slice(
    source.indexOf("export const onMeterDiscoveryCallable"),
    source.indexOf("export const onMeterCreated"),
  );
  const installation = source.slice(
    source.indexOf("export const onMeterInstallationCallable"),
  );

  assert.match(trigger, /validateMeterDiscoveryPayload\(\{\s*data: trnData,\s*\}\)/s);
  assert.match(callable, /validateMeterDiscoveryPayload\(\{\s*data,\s*\}\)/s);
  assert.doesNotMatch(trigger, /expectedTrnType: "METER_DISCOVERY"/);
  assert.doesNotMatch(callable, /expectedTrnType: "METER_DISCOVERY"/);

  assert.match(installation, /validateMeterCreationPayload\(\{/);
  assert.match(installation, /expectedTrnType: "METER_INSTALLATION"/);
  assert.match(source, /"SEAL_EVIDENCE_REQUIRED"/);
  assert.match(source, /"Electricity meter seal number and photo are required"/);
});
