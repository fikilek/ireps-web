function unitText(value) {
  if (typeof value !== "string" && typeof value !== "number") return "NAv";
  const text = String(value).trim();
  return text || "NAv";
}

// Read saved fields only. Current premise edits must not rewrite the identity
// shown for a historical transaction. Do not guess units from address text.
export function savedRegistryUnits(premise) {
  return {
    unitName: unitText(premise?.unitName),
    unitNo: unitText(premise?.unitNo),
  };
}
