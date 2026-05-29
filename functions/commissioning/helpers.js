import {
  buildFlatMetadata,
  getAstCurrentState,
  getAstData,
  normalizeUpper,
  removeUndefinedDeep,
  sanitizeMedia,
} from "../meterLifecycle/helpers.js";

export const COMMISSIONING_TRN_TYPE = "METER_COMMISSIONING";
export const COMMISSIONING_TRN_PREFIX = "TRN_MCOM_";

function cleanString(value, fallback = "") {
  const clean = String(value || "").trim();
  return clean || fallback;
}

function cleanId(value, fallback = "NAv") {
  return cleanString(value, fallback);
}

function normalizeLower(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeMeterNo(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
}

function readQuestionAnswer(question = {}) {
  return normalizeLower(question?.answer);
}

function readQuestionNotes(question = {}) {
  return cleanString(question?.notes, "");
}

function hasMediaTag(media = [], tag) {
  if (!Array.isArray(media)) return false;

  return media.some((item) => {
    return String(item?.tag || "").trim() === tag;
  });
}

function buildQuestion(answer = "", notes = "") {
  return {
    answer: normalizeLower(answer),
    notes: cleanString(notes, ""),
  };
}

function sanitizeCommissioningAnswers(commissioning = {}) {
  return removeUndefinedDeep({
    vendingConfirmed: buildQuestion(
      commissioning?.vendingConfirmed?.answer,
      commissioning?.vendingConfirmed?.notes,
    ),

    finalSwitchOnTested: buildQuestion(
      commissioning?.finalSwitchOnTested?.answer,
      commissioning?.finalSwitchOnTested?.notes,
    ),

    keypadIssued: buildQuestion(
      commissioning?.keypadIssued?.answer,
      commissioning?.keypadIssued?.notes,
    ),

    waterMeterOperational: buildQuestion(
      commissioning?.waterMeterOperational?.answer,
      commissioning?.waterMeterOperational?.notes,
    ),

    waterReadingOrFlowConfirmed: buildQuestion(
      commissioning?.waterReadingOrFlowConfirmed?.answer,
      commissioning?.waterReadingOrFlowConfirmed?.notes,
    ),
  });
}

function validateRequiredCommissioningCheck({
  commissioning = {},
  media = [],
  fieldKey,
  fieldLabel,
  evidenceTag,
  evidenceLabel,
}) {
  const question = commissioning?.[fieldKey] || {};
  const answer = readQuestionAnswer(question);
  const notes = readQuestionNotes(question);

  if (!["yes", "no"].includes(answer)) {
    return {
      ok: false,
      code: "INVALID_COMMISSIONING_ANSWER",
      message: `${fieldLabel} must be answered yes or no`,
    };
  }

  if (answer === "no" && !notes) {
    return {
      ok: false,
      code: "COMMISSIONING_NOTES_REQUIRED",
      message: `Notes are required when ${fieldLabel} is no`,
    };
  }

  if (answer === "yes" && evidenceTag && !hasMediaTag(media, evidenceTag)) {
    return {
      ok: false,
      code: "COMMISSIONING_EVIDENCE_REQUIRED",
      message: `${evidenceLabel || fieldLabel} evidence is required`,
    };
  }

  return {
    ok: true,
    passed: answer === "yes",
  };
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

  return {
    ok: true,
    trnId,
    trnType,
    astId,
    premiseId,
  };
}

export function validateCommissioningAgainstAst({ data = {}, astDoc = {} }) {
  const currentState = getAstCurrentState(astDoc);
  const meterType = normalizeLower(astDoc?.meterType || data?.meterType);
  const astData = getAstData(astDoc);
  const meterKind = normalizeLower(
    astData?.meter?.type || data?.ast?.astData?.meter?.type,
  );

  if (currentState !== "FIELD") {
    return {
      ok: false,
      code: "AST_NOT_FIELD",
      message: "Only FIELD meters can be commissioned",
      currentState,
      meterType,
      commissioningPassed: false,
      nextAstState: currentState || "NAv",
      astStatusChanged: false,
    };
  }

  if (!["electricity", "water"].includes(meterType)) {
    return {
      ok: false,
      code: "INVALID_COMMISSIONING_METER_TYPE",
      message: "Only electricity or water meters can be commissioned",
      currentState,
      meterType,
      commissioningPassed: false,
      nextAstState: "FIELD",
      astStatusChanged: false,
    };
  }

  const commissioning = data?.commissioning || {};
  const media = Array.isArray(data?.media) ? data.media : [];
  const checks = [];

  if (meterType === "electricity" && meterKind === "prepaid") {
    checks.push(
      validateRequiredCommissioningCheck({
        commissioning,
        media,
        fieldKey: "vendingConfirmed",
        fieldLabel: "Vending confirmation",
        evidenceTag: "vendingEvidence",
        evidenceLabel: "Vending",
      }),
    );

    checks.push(
      validateRequiredCommissioningCheck({
        commissioning,
        media,
        fieldKey: "finalSwitchOnTested",
        fieldLabel: "Final switch-on / energisation confirmation",
        evidenceTag: "finalSwitchOnEvidence",
        evidenceLabel: "Final switch-on",
      }),
    );

    checks.push(
      validateRequiredCommissioningCheck({
        commissioning,
        media,
        fieldKey: "keypadIssued",
        fieldLabel: "Keypad issued confirmation",
        evidenceTag: "keypadIssuedEvidence",
        evidenceLabel: "Keypad issued",
      }),
    );
  }

  if (meterType === "electricity" && meterKind !== "prepaid") {
    checks.push(
      validateRequiredCommissioningCheck({
        commissioning,
        media,
        fieldKey: "finalSwitchOnTested",
        fieldLabel: "Final switch-on / energisation confirmation",
        evidenceTag: "finalSwitchOnEvidence",
        evidenceLabel: "Final switch-on",
      }),
    );
  }

  if (meterType === "water") {
    checks.push(
      validateRequiredCommissioningCheck({
        commissioning,
        media,
        fieldKey: "waterMeterOperational",
        fieldLabel: "Water meter operational / service confirmation",
        evidenceTag: "waterOperationalEvidence",
        evidenceLabel: "Water operational",
      }),
    );

    checks.push(
      validateRequiredCommissioningCheck({
        commissioning,
        media,
        fieldKey: "waterReadingOrFlowConfirmed",
        fieldLabel: "Water reading or flow confirmation",
        evidenceTag: "waterReadingEvidence",
        evidenceLabel: "Water reading / flow",
      }),
    );
  }

  const failedValidation = checks.find((check) => !check?.ok);

  if (failedValidation) {
    return {
      ...failedValidation,
      currentState,
      meterType,
      meterKind,
      commissioningPassed: false,
      nextAstState: "FIELD",
      astStatusChanged: false,
    };
  }

  const commissioningPassed = checks.every((check) => check?.passed === true);

  return {
    ok: true,
    currentState,
    meterType,
    meterKind,
    commissioningPassed,
    nextAstState: commissioningPassed ? "CONNECTED" : "FIELD",
    astStatusChanged: commissioningPassed,
  };
}

export function buildCommissioningTrnPayload({
  data = {},
  astDoc = {},
  now,
  actorUid,
  actorName,
}) {
  const serverAstData = getAstData(astDoc);
  const inputAstData = data?.ast?.astData || {};
  const astId = getCommissioningAstId(data);

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

    commissioning: sanitizeCommissioningAnswers(data?.commissioning || {}),

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
  });
}

export function buildCommissioningAstPatch({
  astDoc = {},
  trn = {},
  now,
  actorUid,
  actorName,
}) {
  const lmPcode =
    astDoc?.status?.id ||
    astDoc?.accessData?.parents?.lmPcode ||
    trn?.accessData?.parents?.lmPcode ||
    "NAv";

  return {
    ok: true,
    patch: {
      "status.state": "CONNECTED",
      "status.id": lmPcode,
      "status.detail": lmPcode,
      "metadata.updatedAt": now,
      "metadata.updatedByUid": actorUid,
      "metadata.updatedByUser": actorName,
    },
  };
}
