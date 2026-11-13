import { HttpsError } from "firebase-functions/v2/https";
import { OFFICIAL_HEADERS, UPLOAD_TRN_TYPES, meterKey, validateSourceRows, resolveDuplicates } from "./stage1Validation.js";

const pcode = (value) => typeof value === "string" ? value : value?.lmPcode || value?.pcode || value?.id || "";
export async function validateStage1Upload({ db, uid, data = {} }) {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to validate a TRN BGO upload.");
  const profile = (await db.collection("users").doc(uid).get()).data() || {};
  const role = profile.employment?.role;
  const lmPcode = String(data.lmPcode || "").trim();
  const workbases = [profile.access?.activeWorkbase, ...(profile.access?.workbases || [])].map(pcode);
  if (profile.accountStatus !== "ACTIVE" || !["SPU", "ADM", "MNG", "SPV"].includes(role) || !workbases.includes(lmPcode)) throw new HttpsError("permission-denied", "An active authorized office account and assigned municipality are required.");
  if (!UPLOAD_TRN_TYPES.includes(data.trnType)) throw new HttpsError("invalid-argument", "Select a supported TRN upload type.");
  let rows;
  try { rows = resolveDuplicates(validateSourceRows(data.rows), data.keep); }
  catch (error) { throw new HttpsError("invalid-argument", error.message); }
  const meterAstMap = new Map(), meterRegMap = new Map(), meterSalesMap = new Map(), premiseMap = new Map();
  const numbers = new Set();
  for (const row of rows) {
    const number = meterKey(row.meterNo);
    numbers.add(number);
    // Preserve the existing 10/11-digit registry matching aliases.
    if (number.length === 10 && /^\d+$/.test(number)) numbers.add(`0${number}`);
    if (number.length === 11 && number.startsWith("0")) numbers.add(number.slice(1));
  }
  const register = (map, number, entry) => {
    if (!number) return;
    map.set(number, entry);
    if (number.startsWith("0")) map.set(number.slice(1), entry);
    else if (number.length === 10) map.set(`0${number}`, entry);
  };
  const queries = [
    ["asts", "ast.astData.astNo", meterAstMap], ["asts", "master.id", meterAstMap],
    ["registry_meters", "meterNo", meterRegMap], ["sales-all-meters", "__name__", meterSalesMap],
  ];
  const values = [...numbers];
  for (let index = 0; index < values.length; index += 30) {
    const chunk = values.slice(index, index + 30);
    const snapshots = await Promise.all(queries.map(([collection, field]) => db.collection(collection).where(field, "in", chunk).get()));
    snapshots.forEach((snapshot, queryIndex) => snapshot.forEach((doc) => {
      const entry = { ...doc.data(), id: doc.id };
      const map = queries[queryIndex][2];
      const identifiers = map === meterAstMap ? [entry.ast?.astData?.astNo, entry.master?.id]
        : map === meterRegMap ? [entry.meterNo] : [entry.meterNoNormalized || entry.meterNo || entry.MeterNumber || doc.id];
      identifiers.forEach((number) => register(map, meterKey(number), entry));
    }));
  }
  const premiseIds = new Set([...meterAstMap.values(), ...meterRegMap.values()].map((entry) => entry.accessData?.premise?.id || entry.accessData?.premiseId || entry.premise?.id || entry.premiseId).filter((id) => id && id !== "NAv"));
  const ids = [...premiseIds];
  for (let index = 0; index < ids.length; index += 100) {
    const docs = await db.getAll(...ids.slice(index, index + 100).map((id) => db.collection("premises").doc(id)));
    docs.filter((doc) => doc.exists).forEach((doc) => premiseMap.set(doc.id, { ...doc.data(), id: doc.id }));
  }
  const mismatches = rows.filter((row) => {
    const ast = meterAstMap.get(meterKey(row.meterNo));
    const registry = meterRegMap.get(meterKey(row.meterNo));
    const actual = ast?.accessData?.parents?.lmPcode || registry?.parents?.lmPcode;
    return ast && actual && actual !== lmPcode;
  }).map((row) => ({ ...Object.fromEntries(OFFICIAL_HEADERS.map((key) => [key, row[key]])), actualLmPcode: meterAstMap.get(meterKey(row.meterNo))?.accessData?.parents?.lmPcode || meterRegMap.get(meterKey(row.meterNo))?.parents?.lmPcode }));
  return { context: { fileName: String(data.fileName || ""), lmPcode, lmName: String(data.lmName || ""), trnType: data.trnType }, mismatches,
    meterAstEntries: [...meterAstMap], meterRegEntries: [...meterRegMap], meterSalesEntries: [...meterSalesMap], premiseEntries: [...premiseMap] };
}
