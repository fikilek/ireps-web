// Geofences rules GF-R001: every new geofence name is "Gf W<Ward number> <name>".
// Plain module (no Firebase imports) shared by createGeoFence and the web forms.

// Ward pcodes are the LM pcode plus a three-digit Ward: ZA5241006 -> 6, ZA5241017 -> 17.
export function wardNumberFromPcode(wardPcode) {
  const value = String(wardPcode ?? "").trim();
  if (!/^ZA\d{7,}$/.test(value)) return null;
  const number = Number(value.slice(-3));
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function geofenceNamePrefix(wardNumber) {
  return `Gf W${wardNumber} `;
}

export function normalizeGeofenceNamePart(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

// The part the user types, from a full or partly typed name (any old "Gf W<n> " start removed).
export function geofenceNamePart(name) {
  return String(name ?? "").replace(/^Gf W\d+ ?/, "");
}

export function composeGeofenceName(wardNumber, namePart) {
  const part = normalizeGeofenceNamePart(namePart);
  return wardNumber && part ? `${geofenceNamePrefix(wardNumber)}${part}` : "";
}

export function checkGeofenceName(name, wardPcode) {
  const wardNumber = wardNumberFromPcode(wardPcode);
  if (!wardNumber) return { ok: false, reason: "The geofence Ward is missing or invalid." };
  const prefix = geofenceNamePrefix(wardNumber);
  const value = String(name ?? "");
  if (!value.startsWith(prefix)) return { ok: false, reason: `Geofence names must start with "${prefix.trim()}" (rule GF-R001).` };
  const part = value.slice(prefix.length);
  if (!part) return { ok: false, reason: `Type a name after "${prefix.trim()}".` };
  if (part !== normalizeGeofenceNamePart(part)) return { ok: false, reason: "Use single spaces and no spaces at the start or end of the name." };
  if (/^gf\s+w\d+(\s|$)/i.test(part)) return { ok: false, reason: `Do not repeat "${prefix.trim()}" in the name.` };
  return { ok: true, reason: null };
}
