// MN-R001: what a Meter Inspection must say about a finding, and the status it
// records. The same rules as Meter Discovery, on the other form.
import test from "node:test";
import assert from "node:assert/strict";

import {
  linkFollowUp,
  linkReplacementInstallation,
  markParentFollowUpCompleted,
  resolveReplacementOrigin,
  sanitizeOrigin,
  validateAssignment,
  validateMeterInspection,
} from "../meterLifecycle/helpers.js";

const photo = (tag) => ({ tag, url: `https://example.test/${tag}.jpg` });

function astDoc(state = "CONNECTED") {
  return {
    id: "AST_1",
    meterType: "electricity",
    status: { state },
    ast: { astData: { astNo: "04297700454", meter: { type: "prepaid" } } },
  };
}

function inspectionPayload({
  anomaly = "Meter Ok",
  anomalyDetail = "Operationally Ok",
  normalisation = { actionTaken: ["none"] },
  statusState = "CONNECTED",
  media = [photo("astNoPhoto")],
  origin = { channel: "FIELD" },
  instructionTrnId = "",
} = {}) {
  return {
    id: "TRN_MINSP_1",
    trnType: "METER_INSPECTION",
    instructionTrnId,
    origin,
    status: { state: statusState },
    media,
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
              cb: { size: "60A" },
              keypad: { serialNo: "K-1" },
            },
          },
          anomalies: { anomaly, anomalyDetail },
          normalisation,
          location: { placement: "Boundary Wall", gps: { lat: -28.1, lng: 30.2 } },
          ogs: { hasOffGridSupply: "no" },
        },
      },
    },
  };
}

const mediaFor = (...tags) => [photo("astNoPhoto"), ...tags.map(photo)];

test("a field worker may inspect without an office instruction", () => {
  const result = validateMeterInspection({
    data: inspectionPayload(),
    astDoc: astDoc(),
  });

  assert.equal(result.ok, true, result.message);
});

test("a missing CB size or keypad serial number needs the reason it is not available", () => {
  const withMeter = (cb, keypad) => {
    const data = inspectionPayload();
    Object.assign(data.inspection.captured.ast.astData.meter, { cb, keypad });
    return validateMeterInspection({ data, astDoc: astDoc() });
  };

  assert.equal(withMeter({ size: "" }, { serialNo: "K-1" }).code, "INSPECTION_CB_SIZE_REQUIRED");
  assert.equal(
    withMeter({ size: "", comment: "Circuit Breaker Size Not Visible" }, { serialNo: "K-1" }).ok,
    true,
  );
  assert.equal(
    withMeter({ size: "60A" }, { serialNo: "", comment: "Keypad Missing" }).ok,
    true,
  );
  assert.equal(
    withMeter({ size: "60A" }, { serialNo: "", comment: "Other" }).code,
    "INSPECTION_SERIAL_NUMBER_REQUIRED",
  );
  assert.equal(
    withMeter({ size: "60A" }, { serialNo: "", comment: "Worn off by the sun" }).ok,
    true,
  );
});

test("SAME may copy NAv, and a conventional meter needs no keypad", () => {
  const data = inspectionPayload();
  Object.assign(data.inspection.captured.ast.astData.meter, {
    cb: { size: "NAv", comment: "Circuit Breaker Missing" },
    keypad: { serialNo: "NAv" },
  });
  assert.equal(validateMeterInspection({ data, astDoc: astDoc() }).ok, true);

  const conventional = inspectionPayload();
  Object.assign(conventional.inspection.captured.ast.astData.meter, {
    type: "conventional",
    keypad: { serialNo: "" },
  });
  assert.equal(validateMeterInspection({ data: conventional, astDoc: astDoc() }).ok, true);

  const prepaid = inspectionPayload();
  prepaid.inspection.captured.ast.astData.meter.keypad = { serialNo: "" };
  assert.equal(
    validateMeterInspection({ data: prepaid, astDoc: astDoc() }).code,
    "INSPECTION_SERIAL_NUMBER_REQUIRED",
  );
});

test("office work still carries the instruction it was issued with", () => {
  const result = validateMeterInspection({
    data: inspectionPayload({
      origin: { channel: "OFFICE" },
      instructionTrnId: "TRN_LCT_1",
    }),
    astDoc: astDoc(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "INSPECTION_INSTRUCTION_REQUIRED");
});

test("an illegal connection found on inspection must be disconnected, or say why not", () => {
  const illegal = (normalisation) =>
    validateMeterInspection({
      data: inspectionPayload({
        anomaly: "Illegally Connected",
        anomalyDetail: "Straight Connection (Meter Bypassed)",
        normalisation,
        media: mediaFor("anomalyPhoto"),
      }),
      astDoc: astDoc(),
    });

  const nothingDone = illegal({ actionTaken: ["none"] });
  assert.equal(nothingDone.ok, false);
  assert.equal(nothingDone.code, "NORMALISATION_REASON_REQUIRED");

  assert.equal(illegal({ actionTaken: ["Disconnect meter"] }).ok, true);

  assert.equal(
    illegal({
      actionTaken: ["none"],
      noActionReason: "Threatened or chased away",
    }).ok,
    true,
  );
});

test("the meter takes the status the worker found, so a re-offender can be disconnected again", () => {
  // The record says disconnected; the worker finds it live again.
  const result = validateMeterInspection({
    data: inspectionPayload({
      anomaly: "Illegally Connected",
      anomalyDetail: "Straight Connection (Meter Bypassed)",
      normalisation: { actionTaken: ["Disconnect meter"] },
      statusState: "CONNECTED",
      media: mediaFor("anomalyPhoto"),
    }),
    astDoc: astDoc("DISCONNECTED"),
  });

  assert.equal(result.ok, true, result.message);
  assert.equal(result.nextAstState, "CONNECTED");
  assert.equal(result.astStatusChanged, true);
});

test("a status that belongs to another transaction is refused", () => {
  const result = validateMeterInspection({
    data: inspectionPayload({ statusState: "REMOVED" }),
    astDoc: astDoc(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "INSPECTION_STATUS_NOT_ALLOWED");
});

test("finding the meter as the record has it changes nothing", () => {
  const result = validateMeterInspection({
    data: inspectionPayload({ statusState: "CONNECTED" }),
    astDoc: astDoc("CONNECTED"),
  });

  assert.equal(result.ok, true, result.message);
  assert.equal(result.astStatusChanged, false);
});

test("a disconnection carries the finding it came from, and nothing else", () => {
  const fromDiscovery = sanitizeOrigin({
    channel: "FIELD",
    parentTrnId: "TRN_MDIS_1",
    parentTrnType: "METER_DISCOVERY",
  });
  assert.equal(fromDiscovery.parentTrnId, "TRN_MDIS_1");
  assert.equal(fromDiscovery.parentTrnType, "METER_DISCOVERY");

  // A standalone disconnection carries no parent.
  const standalone = sanitizeOrigin({ channel: "FIELD" });
  assert.equal(standalone.parentTrnId, null);
  assert.equal(standalone.parentTrnType, null);

  // Only a finding can be a parent.
  const wrongParent = sanitizeOrigin({
    channel: "FIELD",
    parentTrnId: "TRN_MREAD_1",
    parentTrnType: "METER_READING",
  });
  assert.equal(wrongParent.parentTrnId, null);
});

test("a field inspection needs no office instruction at the front door either", () => {
  const assignment = {
    instruction: { code: "METER_INSPECTION", text: "" },
    targets: [{ type: "USER", id: "FWR_1", name: "Peter" }],
  };

  assert.equal(
    validateAssignment(assignment, "METER_INSPECTION", { originChannel: "FIELD" }).ok,
    true,
  );

  // Office work still needs the words of the instruction.
  assert.equal(
    validateAssignment(assignment, "METER_INSPECTION", { originChannel: "OFFICE" }).ok,
    false,
  );
});

test("a Meter Ok suspicion on an inspection needs its photo, as on a discovery", () => {
  const suspicion = validateMeterInspection({
    data: inspectionPayload({
      anomaly: "Meter Ok",
      anomalyDetail: "Bypass Suspicion",
    }),
    astDoc: astDoc(),
  });

  assert.equal(suspicion.ok, false);
  assert.equal(suspicion.code, "MISSING_INSPECTION_ANOMALY_PHOTO");
});

// A small in-memory Firestore: enough for the link rules.
function fakeDb(docs) {
  const updates = [];
  return {
    updates,
    collection: () => ({
      doc: (id) => ({
        get: async () => ({ exists: !!docs[id], data: () => docs[id] }),
        update: async (patch) => {
          updates.push({ id, patch });
          const doc = docs[id];
          for (const [path, value] of Object.entries(patch)) {
            const parts = path.split(".");
            let node = doc;
            for (const part of parts.slice(0, -1)) {
              node[part] = node[part] || {};
              node = node[part];
            }
            node[parts[parts.length - 1]] = value;
          }
        },
      }),
    }),
  };
}

function discovery(followUp) {
  return {
    accessData: { trnType: "METER_DISCOVERY" },
    ast: { normalisation: { followUp } },
  };
}

test("a disconnection links to its finding once, with its number and no status word", async () => {
  const db = fakeDb({
    TRN_MDIS_1: discovery({ required: "METER_DISCONNECTION", disconnectionTrnId: "" }),
  });

  const first = await markParentFollowUpCompleted({
    db,
    parentTrnId: "TRN_MDIS_1",
    parentTrnType: "METER_DISCOVERY",
    trnId: "TRN_MDCN_1",
    astId: "TRN_MDIS_1",
  });
  assert.equal(first.linked, true);
  assert.deepEqual(db.updates[0].patch, {
    "ast.normalisation.followUp.disconnectionTrnId": "TRN_MDCN_1",
  });

  // A second disconnection never overwrites the first.
  const second = await markParentFollowUpCompleted({
    db,
    parentTrnId: "TRN_MDIS_1",
    parentTrnType: "METER_DISCOVERY",
    trnId: "TRN_MDCN_2",
    astId: "TRN_MDIS_1",
  });
  assert.equal(second.linked, false);
  assert.equal(second.reason, "ALREADY_LINKED");
});

test("a phone cannot attach work to a finding it does not belong to", async () => {
  const db = fakeDb({
    TRN_MDIS_A: discovery({ required: "METER_DISCONNECTION", disconnectionTrnId: "" }),
    TRN_MDIS_R: discovery({
      required: "METER_REPLACEMENT",
      removalTrnId: "",
      installationTrnId: "",
    }),
    TRN_MREAD_X: { accessData: { trnType: "METER_READING" } },
  });

  // Work on another meter.
  const otherMeter = await linkFollowUp({
    db,
    parentTrnId: "TRN_MDIS_A",
    parentTrnType: "METER_DISCOVERY",
    workTrnType: "METER_DISCONNECTION",
    trnId: "TRN_MDCN_B",
    astId: "TRN_MDIS_B",
  });
  assert.equal(otherMeter.reason, "DIFFERENT_METER");

  // Work the finding did not ask for.
  const notAsked = await linkFollowUp({
    db,
    parentTrnId: "TRN_MDIS_A",
    parentTrnType: "METER_DISCOVERY",
    workTrnType: "METER_REMOVAL",
    trnId: "TRN_MREM_A",
    astId: "TRN_MDIS_A",
  });
  assert.equal(notAsked.reason, "WORK_NOT_ASKED_FOR");

  // A parent that says it is a discovery but is not.
  const wrongType = await linkFollowUp({
    db,
    parentTrnId: "TRN_MREAD_X",
    parentTrnType: "METER_DISCOVERY",
    workTrnType: "METER_DISCONNECTION",
    trnId: "TRN_MDCN_X",
  });
  assert.equal(wrongType.reason, "PARENT_TYPE_MISMATCH");

  // A parent that is not there is never invented.
  const missing = await linkFollowUp({
    db,
    parentTrnId: "MISSING",
    parentTrnType: "METER_DISCOVERY",
    workTrnType: "METER_DISCONNECTION",
    trnId: "TRN_MDCN_Y",
  });
  assert.equal(missing.reason, "PARENT_NOT_FOUND");

  assert.equal(db.updates.length, 0);
});

test("the replacement chain: the removal, then the installation, each once", async () => {
  const docs = {
    TRN_MDIS_9: discovery({
      required: "METER_REPLACEMENT",
      removalTrnId: "",
      installationTrnId: "",
    }),
    TRN_MREM_9: {
      trnType: "METER_REMOVAL",
      sourceAstId: "TRN_MDIS_9",
      ast: { astData: { astId: "TRN_MDIS_9", astNo: "0425774532" } },
      accessData: { premise: { id: "PREM_1" }, access: { hasAccess: "yes" } },
      executionOutcome: { outcome: "SUCCESS", success: true },
      origin: { parentTrnId: "TRN_MDIS_9", parentTrnType: "METER_DISCOVERY" },
    },
  };
  const db = fakeDb(docs);

  const removal = await linkFollowUp({
    db,
    parentTrnId: "TRN_MDIS_9",
    parentTrnType: "METER_DISCOVERY",
    workTrnType: "METER_REMOVAL",
    trnId: "TRN_MREM_9",
    astId: "TRN_MDIS_9",
  });
  assert.equal(removal.linked, true);

  // The installation takes the replaced meter from the removal, not the phone.
  const resolved = await resolveReplacementOrigin({
    db,
    origin: {
      parentTrnId: "TRN_MREM_9",
      parentTrnType: "METER_REMOVAL",
      replacesMeterNo: "SOMETHING_ELSE",
    },
    premiseId: "PREM_1",
  });
  assert.equal(resolved.origin.replacesMeterNo, "0425774532");
  assert.equal(resolved.origin.replacesAstId, "TRN_MDIS_9");

  const installation = await linkReplacementInstallation({
    db,
    removalTrnId: "TRN_MREM_9",
    installationTrnId: "TRN_MINST_9",
  });
  assert.equal(installation.linked, true);
  assert.equal(docs.TRN_MREM_9.replacement.installationTrnId, "TRN_MINST_9");
  assert.equal(
    docs.TRN_MDIS_9.ast.normalisation.followUp.installationTrnId,
    "TRN_MINST_9",
  );

  // A second installation against the same removal is not a replacement.
  const again = await resolveReplacementOrigin({
    db,
    origin: { parentTrnId: "TRN_MREM_9", parentTrnType: "METER_REMOVAL" },
    premiseId: "PREM_1",
  });
  assert.equal(again.origin, null);
  assert.equal(again.reason, "REPLACEMENT_ALREADY_INSTALLED");
});

test("a No Access removal, another premise, or a non-removal is never a replacement", async () => {
  const db = fakeDb({
    TRN_MREM_NA: {
      trnType: "METER_REMOVAL",
      accessData: { premise: { id: "PREM_1" }, access: { hasAccess: "no" } },
      executionOutcome: { outcome: "NO_ACCESS", success: false },
    },
    TRN_MREM_OK: {
      trnType: "METER_REMOVAL",
      accessData: { premise: { id: "PREM_1" }, access: { hasAccess: "yes" } },
      executionOutcome: { outcome: "SUCCESS", success: true },
    },
    TRN_MDCN_1: { trnType: "METER_DISCONNECTION" },
  });

  const noAccess = await resolveReplacementOrigin({
    db,
    origin: { parentTrnId: "TRN_MREM_NA", parentTrnType: "METER_REMOVAL" },
    premiseId: "PREM_1",
  });
  assert.equal(noAccess.reason, "REMOVAL_NOT_DONE");

  const otherPremise = await resolveReplacementOrigin({
    db,
    origin: { parentTrnId: "TRN_MREM_OK", parentTrnType: "METER_REMOVAL" },
    premiseId: "PREM_2",
  });
  assert.equal(otherPremise.reason, "DIFFERENT_PREMISE");

  const notRemoval = await resolveReplacementOrigin({
    db,
    origin: { parentTrnId: "TRN_MDCN_1", parentTrnType: "METER_REMOVAL" },
    premiseId: "PREM_1",
  });
  assert.equal(notRemoval.reason, "NOT_A_REMOVAL");

  const standalone = await resolveReplacementOrigin({ db, origin: {}, premiseId: "PREM_1" });
  assert.equal(standalone.reason, "NOT_A_REPLACEMENT");

  assert.equal(db.updates.length, 0);
});
