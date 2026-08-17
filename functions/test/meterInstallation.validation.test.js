import assert from "node:assert/strict";
import test from "node:test";

import {
  validateMeterInstallationElectricity,
  validateMeterInstallationInfrastructure,
} from "../meterInstallation/validation.js";

function media(...tags) {
  return tags.map((tag) => ({
    tag,
    url: `https://example.test/${tag}.jpg`,
  }));
}

function baseMeter(overrides = {}) {
  return {
    type: "prepaid",
    seal: { sealNo: "", comment: "Seal Missing" },
    keypad: { serialNo: "", comment: "" },
    cb: { size: "", comment: "" },
    ...overrides,
  };
}

test("Seal remains mandatory via number or comment", () => {
  const result = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      seal: { sealNo: "", comment: "" },
    }),
    media: [],
  });

  assert.equal(result?.code, "SEAL_NUMBER_OR_COMMENT_REQUIRED");
});

test("Seal non-photo comment satisfies the mandatory Seal rule", () => {
  const result = validateMeterInstallationInfrastructure({
    meter: baseMeter(),
    media: [],
  });

  assert.equal(result, null);
});

test("Seal number requires Seal evidence photo", () => {
  const withoutPhoto = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      seal: { sealNo: "ABC123", comment: "" },
    }),
    media: [],
  });
  assert.equal(withoutPhoto?.code, "SEAL_PHOTO_REQUIRED");

  const withPhoto = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      seal: { sealNo: "ABC123", comment: "" },
    }),
    media: media("sealPhoto"),
  });
  assert.equal(withPhoto, null);
});

test("Seal photo-required comment still requires evidence", () => {
  const result = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      seal: { sealNo: "", comment: "Seal Broken" },
    }),
    media: [],
  });

  assert.equal(result?.code, "SEAL_PHOTO_REQUIRED");
});

test("Literal Other Seal comment is rejected as non-canonical", () => {
  const result = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      seal: { sealNo: "", comment: "Other" },
    }),
    media: [],
  });

  assert.equal(result?.code, "NON_CANONICAL_SEAL_COMMENT_OTHER");
});

test("Canonical custom Seal explanation is accepted", () => {
  const result = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      seal: { sealNo: "", comment: "Seal hidden behind locked cover" },
    }),
    media: [],
  });

  assert.equal(result, null);
});

test("Prepaid Keypad section may be completely blank", () => {
  const result = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      keypad: undefined,
    }),
    media: [],
  });

  assert.equal(result, null);
});

test("Supplied Keypad serial number requires evidence photo", () => {
  const withoutPhoto = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      keypad: { serialNo: "KP123", comment: "" },
    }),
    media: [],
  });
  assert.equal(withoutPhoto?.code, "KEYPAD_PHOTO_REQUIRED");

  const withPhoto = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      keypad: { serialNo: "KP123", comment: "" },
    }),
    media: media("keypadPhoto"),
  });
  assert.equal(withPhoto, null);
});

test("Keypad photo-required comment still requires evidence", () => {
  const result = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      keypad: {
        serialNo: "",
        comment: "Keypad Serial Number Not Visible",
      },
    }),
    media: [],
  });

  assert.equal(result?.code, "KEYPAD_PHOTO_REQUIRED");
});

test("Keypad non-photo comment remains valid without evidence", () => {
  const result = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      keypad: { serialNo: "", comment: "Keypad Not Installed" },
    }),
    media: [],
  });

  assert.equal(result, null);
});

test("Literal Other Keypad comment is rejected as non-canonical", () => {
  const result = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      keypad: { serialNo: "", comment: "Other" },
    }),
    media: [],
  });

  assert.equal(result?.code, "NON_CANONICAL_KEYPAD_COMMENT_OTHER");
});

test("Canonical custom Keypad explanation is accepted", () => {
  const result = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      keypad: { serialNo: "", comment: "Keypad removed by customer" },
    }),
    media: [],
  });

  assert.equal(result, null);
});

test("CB section may be completely blank", () => {
  const result = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      cb: undefined,
    }),
    media: [],
  });

  assert.equal(result, null);
});

test("Supplied CB size requires evidence photo", () => {
  const withoutPhoto = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      cb: { size: "60", comment: "" },
    }),
    media: [],
  });
  assert.equal(withoutPhoto?.code, "CB_PHOTO_REQUIRED");

  const withPhoto = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      cb: { size: "60", comment: "" },
    }),
    media: media("astCbPhoto"),
  });
  assert.equal(withPhoto, null);
});

test("CB photo-required comment still requires evidence", () => {
  const result = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      cb: { size: "", comment: "Circuit Breaker Size Not Visible" },
    }),
    media: [],
  });

  assert.equal(result?.code, "CB_PHOTO_REQUIRED");
});

test("CB non-photo comment remains valid without evidence", () => {
  const result = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      cb: { size: "", comment: "Circuit Breaker Missing" },
    }),
    media: [],
  });

  assert.equal(result, null);
});

test("Literal Other CB comment is rejected as non-canonical", () => {
  const result = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      cb: { size: "", comment: "Other" },
    }),
    media: [],
  });

  assert.equal(result?.code, "NON_CANONICAL_CB_COMMENT_OTHER");
});

test("Canonical custom CB explanation is accepted", () => {
  const result = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      cb: { size: "", comment: "Breaker installed in inaccessible kiosk" },
    }),
    media: [],
  });

  assert.equal(result, null);
});

test("Conventional meters do not validate Keypad infrastructure", () => {
  const result = validateMeterInstallationInfrastructure({
    meter: baseMeter({
      type: "conventional",
      keypad: { serialNo: "", comment: "Other" },
    }),
    media: [],
  });

  assert.equal(result, null);
});

test("Meter Installation accepts every canonical Meter Discovery placement", () => {
  const placements = [
    "Kiosk",
    "Pole Top",
    "Pole Bottom",
    "Boundary Wall",
    "Meter Room",
    "Wall Indoors",
    "Inside Property",
    "Other",
  ];

  for (const placement of placements) {
    const result = validateMeterInstallationElectricity({
      meter: baseMeter(),
      location: { placement },
      media: [],
    });

    assert.equal(result, null, `Expected placement ${placement} to be accepted`);
  }
});

test("Meter Installation rejects blank Meter Placement", () => {
  const result = validateMeterInstallationElectricity({
    meter: baseMeter(),
    location: { placement: "" },
    media: [],
  });

  assert.equal(result?.code, "METER_PLACEMENT_REQUIRED");
});

test("Meter Installation rejects unsupported Meter Placement", () => {
  const result = validateMeterInstallationElectricity({
    meter: baseMeter(),
    location: { placement: "Behind House" },
    media: [],
  });

  assert.equal(result?.code, "INVALID_METER_PLACEMENT");
});
