import crypto from "crypto";

export const SCHEMA_VERSION = "1.0.0";
export const PROJECT_ID = "ireps2";
export const LM_PCODE = "ZA5241";
export const CONFIRM_TOKEN = "RESET_ENDUMENI_ZA5241_NUCLEAR";

const text = (value) => typeof value === "string" ? value.trim() : "";
const object = (value) => value && typeof value === "object" && !Array.isArray(value);

export function municipalityCodes(value, found = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => municipalityCodes(item, found));
  else if (object(value)) for (const [key, item] of Object.entries(value)) {
    if (["lmPcode", "lmCode", "localMunicipalityPcode"].includes(key) && text(item)) found.add(text(item));
    municipalityCodes(item, found);
  }
  return found;
}

export function classifyScope(data) {
  const codes = [...municipalityCodes(data)].sort();
  if (codes.includes(LM_PCODE) && codes.some((code) => code !== LM_PCODE)) return {scope: "AMBIGUOUS", codes};
  if (codes.includes(LM_PCODE)) return {scope: "TARGET", codes};
  return {scope: "NON_TARGET", codes};
}

export function exactUpdateTime(value) {
  const seconds = value?.seconds ?? value?._seconds;
  const nanoseconds = value?.nanoseconds ?? value?._nanoseconds;
  if (!/^\d+$/.test(String(seconds ?? "")) || !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds > 999999999) throw new Error("INVALID_UPDATE_TIME");
  return {seconds: String(seconds), nanoseconds};
}

export function updateTimeEqual(left, right) {
  return String(left?.seconds) === String(right?.seconds) && left?.nanoseconds === right?.nanoseconds;
}

export function stable(value) {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (value === undefined) return {__type__: "undefined"};
  if (Array.isArray(value)) return value.map(stable);
  if (value instanceof Date) return {__type__: "date", iso: value.toISOString()};
  if (value && typeof value.toDate === "function") return {__type__: "timestamp", ...exactUpdateTime(value)};
  if (value && typeof value.path === "string" && value.firestore) return {__type__: "reference", path: value.path};
  if (value instanceof Uint8Array) return {__type__: "bytes", base64: Buffer.from(value).toString("base64")};
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  throw new Error(`UNSUPPORTED_VALUE:${value?.constructor?.name || typeof value}`);
}

export const stringify = (value) => JSON.stringify(stable(value));
export const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

export function collectStrings(value, path = "", rows = []) {
  if (typeof value === "string") rows.push({path, value});
  else if (Array.isArray(value)) value.forEach((item, index) => collectStrings(item, `${path}[${index}]`, rows));
  else if (object(value)) Object.entries(value).forEach(([key, item]) => collectStrings(item, path ? `${path}.${key}` : key, rows));
  return rows;
}

export function parseStorageReference(raw, expectedBucket = "ireps2.appspot.com") {
  try {
    let bucket; let objectPath;
    if (raw.startsWith("gs://")) { const url = new URL(raw); bucket = url.hostname; objectPath = decodeURIComponent(url.pathname.slice(1)); }
    else { const url = new URL(raw); const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/); if (url.hostname !== "firebasestorage.googleapis.com" || !match) return null; bucket = decodeURIComponent(match[1]); objectPath = decodeURIComponent(match[2]); }
    if (bucket !== expectedBucket || !objectPath || objectPath.endsWith("/") || /[*?[\]{}]/.test(objectPath)) return {eligible: false, bucket, objectPath};
    return {eligible: true, bucket, objectPath};
  } catch { return null; }
}

export function removeExactReferences(value, removedIds) {
  if (Array.isArray(value)) return value.filter((item) => !(typeof item === "string" && removedIds.has(item))).map((item) => removeExactReferences(item, removedIds));
  if (!object(value)) return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (["premiseId", "meterId", "astId", "trnId"].includes(key) && typeof item === "string" && removedIds.has(item)) continue;
    next[key] = removeExactReferences(item, removedIds);
  }
  return next;
}

export function cleanSales(data, removedIds) {
  const next = removeExactReferences(data, removedIds);
  delete next.tbRefs;
  if (next.master && object(next.master)) next.master = {...next.master, visibility: "INVISIBLE"};
  return next;
}
