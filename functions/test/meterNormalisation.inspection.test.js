// MN-R001: what a Meter Inspection must say about a finding, and the status it
// records. The same rules as Meter Discovery, on the other form.
import test from "node:test";
import assert from "node:assert/strict";

import {
  linkFollowUp,
  linkReplacementInstallation,
  markParentFollowUpCompleted,
  sanitizeOrigin,
  sanitizeReplacementOrigin,
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

test("the finding is marked done only when a real disconnection arrives", async () => {
  const updates = [];
  const db = {
    collection: () => ({
      doc: (id) => ({
        get: async () => ({ exists: id !== "MISSING" }),
        update: async (patch) => updates.push({ id, patch }),
      }),
    }),
  };

  const linked = await markParentFollowUpCompleted({
    db,
    parentTrnId: "TRN_MDIS_1",
    parentTrnType: "METER_DISCOVERY",
    trnId: "TRN_MDCN_1",
  });

  assert.equal(linked.linked, true);
  // The number of the work, never a status word (MN-R001 1.1.0 section 7).
  assert.deepEqual(updates[0].patch, {
    "ast.normalisation.followUp.disconnectionTrnId": "TRN_MDCN_1",
  });

  const onInspection = await markParentFollowUpCompleted({
    db,
    parentTrnId: "TRN_MINSP_1",
    parentTrnType: "METER_INSPECTION",
    trnId: "TRN_MDCN_2",
  });
  assert.equal(onInspection.linked, true);
  assert.equal(
    Object.keys(updates[1].patch)[0],
    "inspection.captured.ast.normalisation.followUp.disconnectionTrnId",
  );

  // A parent that is not there is never invented.
  const missing = await markParentFollowUpCompleted({
    db,
    parentTrnId: "MISSING",
    parentTrnType: "METER_DISCOVERY",
    trnId: "TRN_MDCN_3",
  });
  assert.equal(missing.linked, false);
  assert.equal(missing.reason, "PARENT_NOT_FOUND");
  assert.equal(updates.length, 2);

  // A standalone disconnection links nothing.
  const none = await markParentFollowUpCompleted({
    db,
    parentTrnId: "",
    parentTrnType: "",
    trnId: "TRN_MDCN_4",
  });
  assert.equal(none.linked, false);
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

test("the replacement chain: removal on the finding, installation on the finding and the removal", async () => {
  const docs = {
    TRN_MDIS_9: { ast: { normalisation: { followUp: {} } } },
    TRN_MREM_9: {
      origin: { parentTrnId: "TRN_MDIS_9", parentTrnType: "METER_DISCOVERY" },
    },
  };
  const updates = [];
  const db = {
    collection: () => ({
      doc: (id) => ({
        get: async () => ({ exists: !!docs[id], data: () => docs[id] }),
        update: async (patch) => updates.push({ id, patch }),
      }),
    }),
  };

  const removal = await linkFollowUp({
    db,
    parentTrnId: "TRN_MDIS_9",
    parentTrnType: "METER_DISCOVERY",
    workTrnType: "METER_REMOVAL",
    trnId: "TRN_MREM_9",
  });
  assert.equal(removal.linked, true);
  assert.deepEqual(updates[0], {
    id: "TRN_MDIS_9",
    patch: { "ast.normalisation.followUp.removalTrnId": "TRN_MREM_9" },
  });

  const installation = await linkReplacementInstallation({
    db,
    removalTrnId: "TRN_MREM_9",
    installationTrnId: "TRN_MINST_9",
  });
  assert.equal(installation.linked, true);
  assert.deepEqual(updates[1], {
    id: "TRN_MREM_9",
    patch: { "replacement.installationTrnId": "TRN_MINST_9" },
  });
  assert.deepEqual(updates[2], {
    id: "TRN_MDIS_9",
    patch: { "ast.normalisation.followUp.installationTrnId": "TRN_MINST_9" },
  });
});

test("an installation keeps only a real replacement origin", () => {
  assert.deepEqual(
    sanitizeReplacementOrigin({
      parentTrnId: "TRN_MREM_9",
      parentTrnType: "METER_REMOVAL",
      replacesAstId: "AST_OLD",
      replacesMeterNo: "0425774532",
      injected: "ignored",
    }),
    {
      channel: "FIELD",
      source: "METER_REMOVAL",
      parentTrnId: "TRN_MREM_9",
      parentTrnType: "METER_REMOVAL",
      replacesAstId: "AST_OLD",
      replacesMeterNo: "0425774532",
    },
  );

  // A new installation on its own, or anything else, carries no replacement.
  assert.equal(sanitizeReplacementOrigin({}), null);
  assert.equal(
    sanitizeReplacementOrigin({ parentTrnId: "X", parentTrnType: "METER_DISCOVERY" }),
    null,
  );
});
