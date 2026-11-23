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

export function parseRegistrationDisagreeReason(row = {}) {
  const reason = String(row?.nonEligibleReason || "").trim();
  if (!/premise does not list this meter|two records disagree/i.test(reason)) {
    return null;
  }
  const meterState = String(
    row?.astStatus || row?.irepsValues?.meterStatus || row?.meterStatus || "REMOVED",
  )
    .trim()
    .toUpperCase();
  return {
    pillLabel: meterState === "REMOVED" ? "Meter Removed" : `Premise Mismatch`,
    meterState,
    explanation: reason,
  };
}

export function parseGenericNonEligibleReason(row = {}) {
  const reason = String(row?.nonEligibleReason || "").trim();
  if (!reason) return null;
  const meterState = String(
    row?.astStatus || row?.irepsValues?.meterStatus || row?.meterStatus || "NAv",
  )
    .trim()
    .toUpperCase();

  let pillLabel = "Ineligible";
  if (/not found in asts/i.test(reason)) pillLabel = "Not Found in ASTS";
  else if (/decommissioned/i.test(reason)) pillLabel = "Decommissioned";
  else if (/prepaid|token/i.test(reason)) pillLabel = "Prepaid (MREAD N/A)";
  else if (/municipality|ward/i.test(reason)) pillLabel = "LM / Ward Mismatch";
  else if (/duplicate/i.test(reason)) pillLabel = "Duplicate Row";
  else if (/no authoritative premise|no premise/i.test(reason)) pillLabel = "No Premise";

  return {
    pillLabel,
    meterState,
    explanation: reason,
  };
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
