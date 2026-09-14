// Targeted Batch rules TB-R041 (1.3.12): owner-approved street-name corrections.
// Used only to build the address sent for geocoding and to match the street name in the
// geocoding result. The Sales record, Sales tables and batch rows keep the Sales spelling.
// Add an entry only with the owner's approval, naming the LM, town and both spellings.
export const STREET_NAME_CORRECTIONS = Object.freeze([
  { lmPcode: "ZA5241", town: "DUNDEE", from: "Ann", to: "Anne", approved: "2026-09-14" },
  { lmPcode: "ZA5241", town: "DUNDEE", from: "Argyle", to: "Argyll", approved: "2026-09-14" },
  { lmPcode: "ZA5241", town: "DUNDEE", from: "Oldacre", to: "Old Acre", approved: "2026-09-14" },
  { lmPcode: "ZA5241", town: "DUNDEE", from: "Mc Kenzie", to: "Mckenzie", approved: "2026-09-14" },
  { lmPcode: "ZA5241", town: "DUNDEE", from: "Karellandman", to: "Karel Landman", approved: "2026-09-14" },
]);

const correctionKey = (lmPcode, town, name) => [lmPcode, town, name]
  .map((value) => String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase())
  .join("|");
const correctedByKey = new Map(STREET_NAME_CORRECTIONS.map((entry) => [correctionKey(entry.lmPcode, entry.town, entry.from), entry.to]));

// The street name to use for geocoding: the approved correction for this LM and town, or
// the Sales spelling unchanged.
export function correctedStreetName(row = {}) {
  const name = row.adr?.strName;
  return correctedByKey.get(correctionKey(row.lmPcode, row.town, name)) ?? (typeof name === "string" ? name : "");
}
