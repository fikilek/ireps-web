const TRN_SHORT_CODES = {
  METER_INSPECTION: "INSP",
  MINSP: "INSP",
  METER_DISCONNECTION: "DCN",
  MDCN: "DCN",
  METER_RECONNECTION: "RCN",
  MRCN: "RCN",
  METER_REMOVAL: "REM",
  MREM: "REM",
  METER_READING: "RDG",
  MRDG: "RDG",
  METER_COMMISSIONING: "COMM",
  MCOMM: "COMM",
  METER_DISPOSAL: "DISP",
  MDISP: "DISP",
};

const TRN_DISPLAY_NAMES = {
  INSP: "Inspection (INSP)",
  DCN: "Disconnection (DCN)",
  RCN: "Reconnection (RCN)",
  REM: "Removal (REM)",
  RDG: "Meter Reading (RDG)",
  COMM: "Commissioning (COMM)",
  DISP: "Disposal (DISP)",
};

export function parseFallbackReason(row = {}, selectedTrnType = "") {
  if (!row?.isProposedInspection) return null;
  const uploadType = String(selectedTrnType || "").trim().toUpperCase();
  const shortCode = TRN_SHORT_CODES[uploadType] || "TRN";
  const meterState = String(
    row?.astStatus || row?.irepsValues?.meterStatus || row?.meterStatus || "NAv",
  )
    .trim()
    .toUpperCase();
  const rawMessage = String(row?.proposedReason || "").trim();
  const isDuplicateFallback = /^Active\s+/i.test(rawMessage);
  const explanation =
    isDuplicateFallback
      ? rawMessage
      : meterState && meterState !== "NAV" && meterState !== "NOT_IN_ASTS"
        ? `Cannot ${shortCode} a meter that is ${meterState}. INSP will investigate the mismatch on site.`
        : rawMessage || `Proposed for Inspection (INSP).`;

  return {
    shortCode,
    pillLabel: `${shortCode} → INSP Fallback`,
    uploadTrnLabel: TRN_DISPLAY_NAMES[shortCode] || uploadType || "Upload TRN",
    fallbackTrnLabel: TRN_DISPLAY_NAMES.INSP,
    meterState,
    explanation,
  };
}

const NON_ELIGIBLE_REASON_DESCRIPTORS = [
  {
    code: "PREMISE_DOES_NOT_LIST_METER",
    pattern: /premise does not list this meter|two records disagree/i,
    pillLabel: "Meter Has No Linked Premise",
    isDataIntegrityFault: true,
  },
  {
    code: "PREMISE_NOT_NAMED",
    pattern: /no authoritative premise|names no premise/i,
    pillLabel: "Meter Has No Linked Premise",
    isDataIntegrityFault: true,
  },
  {
    code: "PREMISE_NOT_FOUND",
    pattern: /premise this meter belongs to cannot be found/i,
    pillLabel: "Linked Premise Missing",
    isDataIntegrityFault: true,
  },
  {
    code: "LM_WARD_CONTRADICTION",
    pattern: /municipality\/ward binding|ward binding is missing/i,
    pillLabel: "LM / Ward Conflict",
    isDataIntegrityFault: true,
  },
  {
    code: "WARD_OUTSIDE_LM",
    pattern: /ward does not belong to the selected municipality/i,
    pillLabel: "Ward Outside Selected LM",
    isDataIntegrityFault: true,
  },
  {
    code: "INVALID_AST_ID",
    pattern: /no meter was named/i,
    pillLabel: "Missing Meter ID",
    isDataIntegrityFault: true,
  },
  {
    code: "REGISTRATION_NOT_FOUND",
    pattern: /registration that created this meter cannot be found/i,
    pillLabel: "Missing Registration TRN",
    isDataIntegrityFault: true,
  },
  {
    code: "NOT_A_REGISTRATION",
    pattern: /not a meter discovery or a meter installation/i,
    pillLabel: "Invalid Registration TRN",
    isDataIntegrityFault: true,
  },
  {
    code: "REGISTRATION_METER_MISMATCH",
    pattern: /does not name the registration|do not agree on the meter number/i,
    pillLabel: "Registration Mismatch",
    isDataIntegrityFault: true,
  },
  {
    code: "REGISTRATION_WITHOUT_ACCESS",
    pattern: /nobody reached this meter/i,
    pillLabel: "Registered Without Access",
    isDataIntegrityFault: true,
  },
  {
    code: "METER_NUMBER_UNUSABLE",
    pattern: /number cannot be read|identity cannot be confirmed/i,
    pillLabel: "Invalid Meter Number",
    isDataIntegrityFault: true,
  },
  {
    code: "METER_MASTER_MISSING",
    pattern: /not registered in meter master/i,
    pillLabel: "Missing in Meter Master",
    isDataIntegrityFault: true,
  },
  {
    code: "METER_MASTER_NOT_LINKED",
    pattern: /meter master holds this number but does not name/i,
    pillLabel: "Master Record Unlinked",
    isDataIntegrityFault: true,
  },
  {
    code: "METER_MASTER_MISMATCH",
    pattern: /meter master holds this number against a different meter/i,
    pillLabel: "Master Meter Conflict",
    isDataIntegrityFault: true,
  },
  {
    code: "UNKNOWN_METER_STATUS",
    pattern: /meter status could not be resolved/i,
    pillLabel: "Missing Meter State",
    isDataIntegrityFault: true,
  },
  {
    code: "UNKNOWN_AST_STATE",
    pattern: /meter state .* is not recognized/i,
    pillLabel: "Unknown Meter State",
    isDataIntegrityFault: true,
  },
  {
    code: "METER_KIND_NOT_CONVENTIONAL_FOR_MREAD",
    pattern: /explicitly conventional for meter_reading/i,
    pillLabel: "Meter Kind Not Conventional",
    isDataIntegrityFault: false,
  },
  {
    code: "METER_NOT_FOUND",
    pattern: /not found in asts|no record of this meter/i,
    pillLabel: "Not Found in ASTS",
    isDataIntegrityFault: false,
  },
  {
    code: "DECOMMISSIONED_INSP_ONLY",
    pattern: /decommissioned/i,
    pillLabel: "Decommissioned (INSP Only)",
    isDataIntegrityFault: false,
  },
  {
    code: "PREPAID_NOT_SUPPORTED_FOR_MREAD_V1",
    pattern: /prepaid|token/i,
    pillLabel: "Prepaid (No MREAD)",
    isDataIntegrityFault: false,
  },
  {
    code: "PREPAID_MREAD_NOT_SUPPORTED",
    pattern: /conventional meters only/i,
    pillLabel: "Prepaid (No MREAD)",
    isDataIntegrityFault: false,
  },
  {
    code: "UNSUPPORTED_TRN_TYPE",
    pattern: /not supported by tc uploads|unsupported lifecycle instruction/i,
    pillLabel: "Unsupported TRN",
    isDataIntegrityFault: false,
  },
  {
    code: "INVALID_OFFICE_LCT_TYPE",
    pattern: /unsupported lifecycle instruction/i,
    pillLabel: "Unsupported TRN",
    isDataIntegrityFault: false,
  },
  {
    code: "INVALID_AST_STATE",
    pattern: /cannot be selected for|can only be issued for|has already been removed|can be removed/i,
    pillLabel: "State Not Eligible",
    isDataIntegrityFault: false,
  },
  {
    code: "STATUS_NOT_ELIGIBLE_FOR_DCN",
    pattern: /cannot be selected for meter_disconnection/i,
    pillLabel: "State Not Eligible",
    isDataIntegrityFault: false,
  },
  {
    code: "STATUS_NOT_ELIGIBLE_FOR_RCN",
    pattern: /cannot be selected for meter_reconnection/i,
    pillLabel: "State Not Eligible",
    isDataIntegrityFault: false,
  },
  {
    code: "STATUS_NOT_ELIGIBLE_FOR_REM",
    pattern: /cannot be selected for meter_removal/i,
    pillLabel: "State Not Eligible",
    isDataIntegrityFault: false,
  },
  {
    code: "DUPLICATE_ROW",
    pattern: /duplicate/i,
    pillLabel: "Duplicate Row",
    isDataIntegrityFault: false,
  },
];

const DESCRIPTOR_BY_CODE = new Map(NON_ELIGIBLE_REASON_DESCRIPTORS.map((entry) => [entry.code, entry]));

export function resolveNonEligibleDescriptor(row = {}) {
  const code = String(row?.nonEligibleCode || "").trim().toUpperCase();
  const reason = String(row?.nonEligibleReason || "").trim();
  const meterState = String(
    row?.astStatus || row?.irepsValues?.meterStatus || row?.meterStatus || "NAv",
  )
    .trim()
    .toUpperCase();

  const matched =
    (code && DESCRIPTOR_BY_CODE.get(code)) ||
    NON_ELIGIBLE_REASON_DESCRIPTORS.find((entry) => entry.pattern.test(reason)) ||
    null;

  const isDataIntegrityFault =
    typeof row?.isDataIntegrityFault === "boolean"
      ? row.isDataIntegrityFault
      : Boolean(matched?.isDataIntegrityFault);

  if (!reason && !matched) return null;

  return {
    code: code || matched?.code || "INELIGIBLE",
    pillLabel: matched?.pillLabel || "Ineligible",
    meterState,
    explanation: reason || matched?.pillLabel || "Row is not eligible.",
    isDataIntegrityFault,
  };
}

export function parseRegistrationDisagreeReason(row = {}) {
  const code = String(row?.nonEligibleCode || "").trim().toUpperCase();
  const reason = String(row?.nonEligibleReason || "").trim();
  if (
    code !== "PREMISE_DOES_NOT_LIST_METER" &&
    !/premise does not list this meter|two records disagree/i.test(reason)
  ) {
    return null;
  }
  return resolveNonEligibleDescriptor({
    ...row,
    nonEligibleCode: code || "PREMISE_DOES_NOT_LIST_METER",
  });
}

export function parseGenericNonEligibleReason(row = {}) {
  if (!String(row?.nonEligibleReason || "").trim() && !row?.nonEligibleCode) return null;
  return resolveNonEligibleDescriptor(row);
}

const ACTIVE_TRN_WORKFLOW_STATES = new Set(["CREATED", "ISSUED", "ACCEPTED", "IN_PROGRESS"]);

export function parsePendingTrnFromReason(row = {}) {
  if (row?.isEligible === true) return null;
  const reason = String(row?.nonEligibleReason || "").trim();
  const lifecycle = row?.activeLifecycle || row?.astActiveLifecycle || null;
  const match = reason.match(/Active\s+([A-Z_]+)\s+job\s+(TRN_[^\s]+)\s+already exists/i);
  const lifecycleState = String(lifecycle?.workflowState || "").trim().toUpperCase();
  const hasActiveLifecycle = Boolean(lifecycle?.trnId) && ACTIVE_TRN_WORKFLOW_STATES.has(lifecycleState);
  if (!match && !hasActiveLifecycle) return null;
  const trnType = String((hasActiveLifecycle ? lifecycle?.trnType : null) || match?.[1] || "").trim().toUpperCase();
  const trnId = String((hasActiveLifecycle ? lifecycle?.trnId : null) || match?.[2] || "").trim();
  if (!trnId) return null;

  const shortCode = TRN_SHORT_CODES[trnType] || "TRN";
  const assigned = lifecycle?.assignedTo || {};
  const assignedName = String(assigned?.name || assigned?.label || "").trim();
  const assignedType = String(assigned?.type || "").trim().toUpperCase();
  const allocatedTo =
    assignedName && assignedName.toUpperCase() !== "NAV"
      ? assignedType && !assignedName.toUpperCase().startsWith(`${assignedType}:`)
        ? `${assignedType}: ${assignedName}`
        : assignedName
      : "Unallocated";

  return {
    trnId,
    trnType: trnType || "TRN",
    shortCode,
    buttonLabel: `Pending ${shortCode} Trn`,
    workflowState: String(lifecycle?.workflowState || "ACTIVE").replaceAll("_", " "),
    allocatedTo,
  };
}
