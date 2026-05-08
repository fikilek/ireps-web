import {
  buildFlatMetadata,
  buildPremiseServiceSnapshotPatch,
  getAstCurrentState,
  getAstData,
  getAstMeterType,
  getAstPrepaidType,
  normalizeUpper,
  removeUndefinedDeep,
  sanitizeCommissioning,
  sanitizeMedia,
  validateMeterCommissioning,
} from "../meterLifecycle/helpers.js";

export const COMMISSIONING_TRN_TYPE = "METER_COMMISSIONING";
export const COMMISSIONING_TRN_PREFIX = "TRN_MCOM_";

export const COMMISSIONING_INSTRUCTION_TEXT =
  "Confirm meter can vend and is ready for final switch-on";

function cleanString(value, fallback = "") {
  const clean = String(value || "").trim();
  return clean || fallback;
}

function cleanId(value, fallback = "NAv") {
  return cleanString(value, fallback);
}

function normalizeMeterNo(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
}

export function getCommissioningTrnType(data = {}) {
  return normalizeUpper(data?.accessData?.trnType || data?.trnType);
}

export function getCommissioningTrnId(data = {}) {
  return cleanId(data?.id);
}

export function getCommissioningAstId(data = {}) {
  return cleanId(
    data?.ast?.astData?.astId ||
      data?.astId ||
      data?.sourceAstId ||
      data?.accessData?.astId,
  );
}

export function getCommissioningPremiseId(data = {}) {
  return cleanId(
    data?.accessData?.premise?.id || data?.premiseId || data?.premise?.id,
  );
}

export function getCommissioningMeterNo({ trn = {}, astDoc = {} }) {
  const astData = getAstData(astDoc);
  return normalizeMeterNo(
    astData?.astNo ||
      trn?.ast?.astData?.astNo ||
      trn?.astData?.astNo ||
      trn?.meterNo,
  );
}

export function validateCommissioningInstruction(assignment = {}) {
  const instruction = assignment?.instruction || {};
  const code = normalizeUpper(instruction?.code);

  if (Array.isArray(assignment?.targets) && assignment.targets.length > 0) {
    return {
      ok: false,
      code: "COMMISSIONING_TARGETS_NOT_ALLOWED",
      message: "Commissioning must not use assignment.targets",
    };
  }

  if (assignment?.createdFor) {
    return {
      ok: false,
      code: "COMMISSIONING_CREATED_FOR_NOT_ALLOWED",
      message: "Commissioning must not use assignment.createdFor",
    };
  }

  if (!code) {
    return {
      ok: false,
      code: "INVALID_COMMISSIONING_INSTRUCTION_CODE",
      message: "assignment.instruction.code is required",
    };
  }

  if (code !== COMMISSIONING_TRN_TYPE) {
    return {
      ok: false,
      code: "COMMISSIONING_INSTRUCTION_MISMATCH",
      message: "assignment.instruction.code must be METER_COMMISSIONING",
    };
  }

  if (!cleanString(instruction?.text)) {
    return {
      ok: false,
      code: "INVALID_COMMISSIONING_INSTRUCTION_TEXT",
      message: "assignment.instruction.text is required",
    };
  }

  return { ok: true };
}

export function validateCommissioningCreateInput(data = {}) {
  const trnId = getCommissioningTrnId(data);
  const trnType = getCommissioningTrnType(data);
  const astId = getCommissioningAstId(data);
  const premiseId = getCommissioningPremiseId(data);

  if (!trnId || trnId === "NAv") {
    return {
      ok: false,
      code: "INVALID_TRN_ID",
      message: "Commissioning TRN id is required",
    };
  }

  if (!trnId.startsWith(COMMISSIONING_TRN_PREFIX)) {
    return {
      ok: false,
      code: "INVALID_COMMISSIONING_TRN_ID",
      message: `Commissioning TRN id must start with ${COMMISSIONING_TRN_PREFIX}`,
    };
  }

  if (!data?.accessData) {
    return {
      ok: false,
      code: "INVALID_ACCESS_DATA",
      message: "accessData is required",
    };
  }

  if (trnType !== COMMISSIONING_TRN_TYPE) {
    return {
      ok: false,
      code: "INVALID_COMMISSIONING_TRN_TYPE",
      message: "accessData.trnType must be METER_COMMISSIONING",
    };
  }

  if (!astId || astId === "NAv") {
    return {
      ok: false,
      code: "INVALID_AST_ID",
      message: "ast.astData.astId is required",
    };
  }

  if (!premiseId || premiseId === "NAv") {
    return {
      ok: false,
      code: "INVALID_PREMISE_ID",
      message: "A valid premise id is required",
    };
  }

  if (!data?.commissioning || typeof data.commissioning !== "object") {
    return {
      ok: false,
      code: "INVALID_COMMISSIONING_DATA",
      message: "commissioning answers are required",
    };
  }

  const instructionCheck = validateCommissioningInstruction(
    data?.assignment || {},
  );

  if (!instructionCheck.ok) {
    return instructionCheck;
  }

  return {
    ok: true,
    trnId,
    trnType,
    astId,
    premiseId,
  };
}

export function validateCommissioningAgainstAst({ data = {}, astDoc = {} }) {
  return validateMeterCommissioning({
    data,
    astDoc,
  });
}

export function sanitizeCommissioningInstruction(assignment = {}) {
  const instruction = assignment?.instruction || {};

  return {
    instruction: {
      code: COMMISSIONING_TRN_TYPE,
      text: cleanString(instruction?.text, COMMISSIONING_INSTRUCTION_TEXT),
      notes: cleanString(instruction?.notes, ""),
      mediaRequired: instruction?.mediaRequired !== false,
    },
  };
}

export function buildCommissioningTrnPayload({
  data = {},
  astDoc = {},
  now,
  actorUid,
  actorName,
  statusState,
}) {
  const serverAstData = getAstData(astDoc);
  const inputAstData = data?.ast?.astData || {};
  const astId = getCommissioningAstId(data);

  const nextStatusState =
    normalizeUpper(statusState) ||
    normalizeUpper(data?.status?.state) ||
    getAstCurrentState(astDoc);

  return removeUndefinedDeep({
    id: data.id,

    accessData: {
      access: {
        hasAccess: data?.accessData?.access?.hasAccess || "yes",
        reason: data?.accessData?.access?.reason || "NAv",
      },

      erfId: astDoc?.accessData?.erfId || data?.accessData?.erfId || "NAv",
      erfNo: astDoc?.accessData?.erfNo || data?.accessData?.erfNo || "NAv",

      parents: astDoc?.accessData?.parents || data?.accessData?.parents || {},

      premise: {
        id:
          astDoc?.accessData?.premise?.id ||
          data?.accessData?.premise?.id ||
          "NAv",

        address:
          astDoc?.accessData?.premise?.address ||
          data?.accessData?.premise?.address ||
          "NAv",

        propertyType:
          astDoc?.accessData?.premise?.propertyType ||
          data?.accessData?.premise?.propertyType ||
          "NAv",
      },

      trnType: COMMISSIONING_TRN_TYPE,
    },

    assignment: sanitizeCommissioningInstruction(data?.assignment || {}),

    ast: {
      astData: {
        astId,

        astNo: serverAstData?.astNo || inputAstData?.astNo || "NAv",

        astManufacturer:
          serverAstData?.astManufacturer ||
          inputAstData?.astManufacturer ||
          "NAv",

        astName: serverAstData?.astName || inputAstData?.astName || "NAv",

        meter: serverAstData?.meter || inputAstData?.meter || {},
      },
    },

    commissioning: sanitizeCommissioning(data?.commissioning || {}),

    media: sanitizeMedia(data?.media || []),

    metadata: buildFlatMetadata({
      now,
      actorUid,
      actorName,
    }),

    meterType: astDoc?.meterType || data?.meterType || "NAv",

    serviceProvider: astDoc?.serviceProvider ||
      data?.serviceProvider || {
        id: "NAv",
        name: "NAv",
      },

    status: {
      state: nextStatusState,
      id:
        astDoc?.status?.id ||
        data?.status?.id ||
        astDoc?.accessData?.parents?.lmPcode ||
        data?.accessData?.parents?.lmPcode ||
        "NAv",
      detail:
        astDoc?.status?.detail ||
        data?.status?.detail ||
        astDoc?.accessData?.parents?.lmPcode ||
        data?.accessData?.parents?.lmPcode ||
        "NAv",
    },
  });
}

export function buildCommissioningAstPatch({
  actionCheck = {},
  now,
  actorUid,
  actorName,
}) {
  const nextAstState = normalizeUpper(actionCheck?.nextAstState);

  if (!nextAstState) {
    return {
      ok: false,
      code: "INVALID_NEXT_AST_STATE",
      message: "Commissioning next AST state could not be resolved",
    };
  }

  const patch = {
    "metadata.updatedAt": now,
    "metadata.updatedByUid": actorUid,
    "metadata.updatedByUser": actorName,
  };

  if (actionCheck.astStatusChanged === true) {
    patch["status.state"] = nextAstState;
  }

  return {
    ok: true,
    patch,
  };
}

export function buildCommissioningPremisePatch({
  premiseData = {},
  astId,
  meterType,
  status,
  now,
  actorUid,
  actorName,
}) {
  const servicePatchResult = buildPremiseServiceSnapshotPatch({
    premiseData,
    astId,
    meterType,
    status,
    updatedAt: now,
  });

  if (!servicePatchResult.ok) {
    return servicePatchResult;
  }

  return {
    ok: true,
    serviceBucket: servicePatchResult.serviceBucket,
    patch: {
      ...servicePatchResult.patch,
      "metadata.updatedAt": now,
      "metadata.updatedByUid": actorUid,
      "metadata.updatedByUser": actorName,
    },
  };
}

export function buildCommissioningMasterPatch({
  trn = {},
  astDoc = {},
  statusState,
  now,
  actorUid,
  actorName,
}) {
  const meterNo = getCommissioningMeterNo({
    trn,
    astDoc,
  });

  if (!meterNo || meterNo === "NAv") {
    return {
      ok: false,
      code: "INVALID_MASTER_METER_NO",
      message: "Cannot update meter_master without a meter number",
    };
  }

  const status = {
    state: normalizeUpper(statusState),
    id:
      astDoc?.status?.id ||
      trn?.status?.id ||
      astDoc?.accessData?.parents?.lmPcode ||
      trn?.accessData?.parents?.lmPcode ||
      "NAv",
    detail:
      astDoc?.status?.detail ||
      trn?.status?.detail ||
      astDoc?.accessData?.parents?.lmPcode ||
      trn?.accessData?.parents?.lmPcode ||
      "NAv",
  };

  return {
    ok: true,
    meterNo,
    patch: {
      id: meterNo,
      meterNo,
      meterType: astDoc?.meterType || trn?.meterType || "electricity",
      status,
      refs: {
        asts: {
          id: getCommissioningAstId(trn),
        },
        trns: {
          id: trn?.id || "NAv",
        },
        premise: {
          id: getCommissioningPremiseId(trn),
        },
      },
      parents: astDoc?.accessData?.parents || trn?.accessData?.parents || {},
      metadata: {
        updatedAt: now,
        updatedByUid: actorUid,
        updatedByUser: actorName,
      },
    },
  };
}

export function shouldApplyCommissioningAstUpdate(actionCheck = {}) {
  return (
    actionCheck?.ok === true &&
    actionCheck?.commissioningPassed === true &&
    normalizeUpper(actionCheck?.nextAstState) === "CONNECTED"
  );
}

export function buildCommissioningProcessingPatch({
  actionCheck = {},
  now,
  actorUid,
  actorName,
  processingState,
  message,
}) {
  const nextState =
    processingState ||
    (shouldApplyCommissioningAstUpdate(actionCheck)
      ? "AST_UPDATED"
      : "AST_UNCHANGED");

  return {
    "processing.commissioning.state": nextState,
    "processing.commissioning.message": message || "",
    "processing.commissioning.processedAt": now,
    "processing.commissioning.processedByUid": actorUid,
    "processing.commissioning.processedByUser": actorName,
    "processing.commissioning.astStatusAfter":
      actionCheck?.nextAstState || "FIELD",
    "metadata.updatedAt": now,
    "metadata.updatedByUid": actorUid,
    "metadata.updatedByUser": actorName,
  };
}
