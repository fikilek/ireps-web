// Shared transient Stage 1 contract. Does not change stored TC or TRN contracts.
export const OFFICIAL_HEADERS = ["rowNo", "meterNo", "meterPhase", "meterType", "linkedAccountNo", "premiseAddress", "premisePropertyType", "wardNo", "geofence", "meterStatus", "erfNo"];
export const MAX_UPLOAD_ROWS = 200;
export const UPLOAD_TRN_TYPES = ["METER_DISCONNECTION", "METER_RECONNECTION", "METER_INSPECTION", "METER_REMOVAL", "METER_READING"];
export const meterKey = (value) => String(value ?? "").trim().toUpperCase();

export function validateSourceRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("The uploaded file contains 0 meter rows.");
  if (rows.length > MAX_UPLOAD_ROWS) throw new Error(`The file contains ${rows.length} nonblank rows. Maximum allowed is 200. Split the file and re-upload.`);
  return rows.map((row, index) => {
    const values = Object.fromEntries(OFFICIAL_HEADERS.map((key) => [key, String(row[key] ?? "")]));
    const rowNo = values.rowNo.trim();
    if (!/^\d+$/.test(rowNo) || Number(rowNo) !== index + 1) throw new Error(`Source row ${row.sourcePosition || index + 2}: rowNo must be ${index + 1}. Supply sequential whole numbers 1..${rows.length}; rows are never renumbered.`);
    if (!values.meterNo.trim()) throw new Error(`Source row ${row.sourcePosition || index + 2}: meterNo is mandatory.`);
    return { ...values, sourcePosition: Number(row.sourcePosition || index + 2) };
  });
}

export function duplicateGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = meterKey(row.meterNo);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].filter(([, entries]) => entries.length > 1);
}

export function resolveDuplicates(rows, keep = {}) {
  const groups = duplicateGroups(rows);
  for (const [key, entries] of groups) {
    if (!entries.some((row) => String(row.rowNo).trim() === String(keep[key]))) throw new Error(`Choose one occurrence to keep for meter ${key}.`);
  }
  const duplicateKeys = new Set(groups.map(([key]) => key));
  return rows.filter((row) => !duplicateKeys.has(meterKey(row.meterNo)) || String(row.rowNo).trim() === String(keep[meterKey(row.meterNo)]));
}
