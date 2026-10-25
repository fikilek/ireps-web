export const PREMISE_QA_STATUS_OPTIONS = [
  "QA PENDING",
  "QA PASS",
  "QA FAIL",
  "QA NAv",
];

export const PREMISE_QA_REASONS = [
  { code: "ADDRESS_INCORRECT", label: "Address Incorrect (wrong street number, name or type)" },
  { code: "ERF_MISMATCH", label: "ERF Mismatch (premise located on different ERF)" },
  { code: "PROPERTY_TYPE_INCORRECT", label: "Property Type Incorrect (wrong category, building name or unit)" },
  { code: "PHOTO_UNCLEAR", label: "Photo Unclear (premise/address photo blurred or dark)" },
  { code: "PHOTO_MISSING", label: "Photo Missing (required facade or street number photo missing)" },
  { code: "COORDINATES_INACCURATE", label: "Coordinates Inaccurate (GPS location does not match property position)" },
  { code: "OTHER", label: "Other (requires explanation)" },
];

export function getPremiseQaStatus(row) {
  const raw = row?.qa?.status || row?.qaStatus;
  if (!raw) return "QA NAv";
  const upper = String(raw).trim().toUpperCase();
  if (upper === "QA PASS" || upper === "PASS" || upper === "QA_PASS") return "QA PASS";
  if (upper === "QA FAIL" || upper === "FAIL" || upper === "QA_FAIL") return "QA FAIL";
  if (upper === "QA PENDING" || upper === "PENDING" || upper === "QA_PENDING") return "QA PENDING";
  if (upper === "QA NAV" || upper === "NAV" || upper === "QA_NAV" || upper === "NOT_AVAILABLE") return "QA NAv";
  return raw;
}

export function getPremiseQaLabel(row) {
  return getPremiseQaStatus(row);
}

export function formatQaStatusDate(value) {
  if (!value || value === "NAv") return null;
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function getPremiseHistoryCount(row) {
  if (!row) return 0;
  if (typeof row.qa?.historyCount === "number") return row.qa.historyCount;
  if (typeof row.historyCount === "number") return row.historyCount;
  if (Array.isArray(row.qaHistory)) return row.qaHistory.length;
  const resubmissions = Number(row.qa?.resubmissionCount) || 0;
  const reviews = row.qa?.reviewedByUser || row.qa?.reviewedAt ? 1 : 0;
  const initial = (row.qa?.status && row.qa?.status !== "QA_NAV" && row.qa?.status !== "QA NAv") ? 1 : 0;
  return initial + resubmissions + reviews;
}

export function getPremiseUpdatedByUser(row) {
  if (!row) return "NAv";
  const status = getPremiseQaStatus(row);
  const isPending = status === "QA PENDING";
  if (isPending && row.qa?.resubmissionCount > 0 && row.qa?.lastSubmittedByUser) {
    return row.qa.lastSubmittedByUser;
  }
  if (row.qa?.reviewedByUser) {
    return row.qa.reviewedByUser;
  }
  return row.qa?.lastSubmittedByUser || row.createdByUser || row.metadata?.createdByUser || "NAv";
}

// Isolated sample preview records to demonstrate all 4 states safely without altering real Firestore data
export const DEMO_QA_PREMISES = [
  {
    id: "PRM_DEMO_01_PENDING",
    premiseId: "PRM_01J9X8K2M4N5P6Q7R8S9T0V1W1",
    erfNo: "5220",
    addressText: "10 Victoria Street",
    propertyTypeType: "Residential",
    propertyTypeName: "Single Residential",
    unitNo: "1",
    occupancyStatus: "Occupied",
    electricityMeterCount: 1,
    waterMeterCount: 0,
    meterCount: 1,
    updatedAt: "2026-10-21T06:30:00Z",
    createdByUser: "Sipho Dlamini (FWR)",
    metadata: { createdByUid: "FWR_001", createdByUser: "Sipho Dlamini (FWR)" },
    qa: {
      status: "QA PENDING",
      lastSubmittedAt: "2026-10-21T06:30:00Z",
      lastSubmittedByUid: "FWR_001",
      lastSubmittedByUser: "Sipho Dlamini (FWR)",
      resubmissionCount: 1,
    },
  },
  {
    id: "PRM_DEMO_02_PASS",
    premiseId: "PRM_01J9X8K2M4N5P6Q7R8S9T0V1W2",
    erfNo: "5221",
    addressText: "12 Victoria Street",
    propertyTypeType: "Residential",
    propertyTypeName: "Single Residential",
    unitNo: "2",
    occupancyStatus: "Occupied",
    electricityMeterCount: 1,
    waterMeterCount: 1,
    meterCount: 2,
    updatedAt: "2026-10-20T14:20:00Z",
    createdByUser: "Sipho Dlamini (FWR)",
    metadata: { createdByUid: "FWR_001", createdByUser: "Sipho Dlamini (FWR)" },
    qa: {
      status: "QA PASS",
      reviewedAt: "2026-10-20T15:10:00Z",
      reviewedByUid: "MNG_001",
      reviewedByUser: "Jane Khumalo (MNG)",
      comment: "Verified front facade and meter serial against GIS layer.",
    },
  },
  {
    id: "PRM_DEMO_03_FAIL",
    premiseId: "PRM_01J9X8K2M4N5P6Q7R8S9T0V1W3",
    erfNo: "5222",
    addressText: "14 Victoria Street",
    propertyTypeType: "Commercial",
    propertyTypeName: "Corner Shop",
    unitNo: "Shop A",
    occupancyStatus: "Occupied",
    electricityMeterCount: 2,
    waterMeterCount: 0,
    meterCount: 2,
    updatedAt: "2026-10-19T10:00:00Z",
    createdByUser: "Thabo Molefe (FWR)",
    metadata: { createdByUid: "FWR_002", createdByUser: "Thabo Molefe (FWR)" },
    qa: {
      status: "QA FAIL",
      reviewedAt: "2026-10-19T11:45:00Z",
      reviewedByUid: "SPV_001",
      reviewedByUser: "John Sithole (SPV)",
      reasonCode: "ADDRESS_INCORRECT",
      reasonLabel: "Address Incorrect (wrong street number, name or type)",
      comment: "House number is 16 on the facade photo, not 14.",
    },
  },
  {
    id: "PRM_DEMO_04_NAV",
    premiseId: "PRM_01J9X8K2M4N5P6Q7R8S9T0V1W4",
    erfNo: "5223",
    addressText: "16 Victoria Street",
    propertyTypeType: "Residential",
    propertyTypeName: "Duplex",
    unitNo: "NAv",
    occupancyStatus: "Vacant",
    electricityMeterCount: 0,
    waterMeterCount: 0,
    meterCount: 0,
    updatedAt: "2026-10-18T08:00:00Z",
    createdByUser: "Historical Import",
    metadata: { createdByUid: "OFFICE_IMPORT", createdByUser: "Office System" },
    qa: null, // Evaluates to "QA NAv"
  },
];
