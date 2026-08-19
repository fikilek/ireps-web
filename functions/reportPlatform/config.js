export const GENERATED_REPORTS_ROOT = "generated-reports";

export const REPORT_TYPES = Object.freeze({
  QUICK_TRN: "QUICK_TRN",
  TRNS: "TRNS",
  NO_ACCESS: "NO_ACCESS",
  ANOMALY: "ANOMALY",
  NORMALISATION: "NORMALISATION",
  USER_ACTIVITY: "USER_ACTIVITY",
  REGISTRY_WARDS: "REGISTRY_WARDS",
  REGISTRY_ERFS: "REGISTRY_ERFS",
  REGISTRY_PREMISES: "REGISTRY_PREMISES",
  REGISTRY_METERS: "REGISTRY_METERS",
  MANAGEMENT_OPERATIONAL: "MANAGEMENT_OPERATIONAL",
});

export const REPORT_TYPE_VALUES = Object.freeze(Object.values(REPORT_TYPES));

export const REPORT_FORMATS = Object.freeze({
  XLSX: "XLSX",
  PDF: "PDF",
});

export const REPORT_FORMAT_VALUES = Object.freeze(Object.values(REPORT_FORMATS));

export const REPORT_MIME_TYPES = Object.freeze({
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  PDF: "application/pdf",
});

export const REPORT_FILE_EXTENSIONS = Object.freeze({
  XLSX: ".xlsx",
  PDF: ".pdf",
});

export const LOCKED_REPORT_FORMATS = Object.freeze({
  [REPORT_TYPES.QUICK_TRN]: REPORT_FORMATS.PDF,
  [REPORT_TYPES.USER_ACTIVITY]: REPORT_FORMATS.XLSX,
});

export const REPORT_RETENTION_DAYS = Object.freeze({
  DEFAULT: 3,
  [REPORT_TYPES.QUICK_TRN]: 3,
  [REPORT_TYPES.TRNS]: 3,
  [REPORT_TYPES.NO_ACCESS]: 3,
  [REPORT_TYPES.ANOMALY]: 3,
  [REPORT_TYPES.NORMALISATION]: 3,
  [REPORT_TYPES.USER_ACTIVITY]: 3,
  [REPORT_TYPES.REGISTRY_WARDS]: 3,
  [REPORT_TYPES.REGISTRY_ERFS]: 3,
  [REPORT_TYPES.REGISTRY_PREMISES]: 3,
  [REPORT_TYPES.REGISTRY_METERS]: 3,
  [REPORT_TYPES.MANAGEMENT_OPERATIONAL]: 3,
});

const PROJECT_ENVIRONMENTS = Object.freeze({
  ireps2: "DEV",
  "ireps-test": "TEST",
  "ireps-5c3e9": "LIVE",
});

export function getLockedReportFormat(reportType) {
  return LOCKED_REPORT_FORMATS[reportType] || null;
}

export function getReportRetentionDays(reportType) {
  return REPORT_RETENTION_DAYS[reportType] || REPORT_RETENTION_DAYS.DEFAULT;
}

export function deriveServerEnvironment(projectId) {
  const normalizedProjectId = String(projectId || "").trim().toLowerCase();

  if (!normalizedProjectId) return null;
  if (normalizedProjectId.startsWith("demo-")) return "DEMO";

  return PROJECT_ENVIRONMENTS[normalizedProjectId] || null;
}
