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
};

export function parsePendingTrnFromReason(row = {}) {
  const reason = String(row?.nonEligibleReason || "").trim();
  const lifecycle = row?.activeLifecycle || row?.astActiveLifecycle || null;
  const match = reason.match(/Active\s+([A-Z_]+)\s+job\s+(TRN_[^\s]+)\s+already exists/i);
  const trnType = String(lifecycle?.trnType || match?.[1] || "").trim().toUpperCase();
  const trnId = String(lifecycle?.trnId || match?.[2] || "").trim();
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
