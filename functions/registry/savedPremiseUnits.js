function text(value) {
  if (typeof value !== "string" && typeof value !== "number") return "NAv";
  return String(value).trim() || "NAv";
}

export function savedPremiseUnits(premise) {
  return {
    premiseUnitName: text(premise?.unitName),
    premiseUnitNo: text(premise?.unitNo),
  };
}

export function didSavedPremiseAddressChange(before, after) {
  return JSON.stringify(before?.accessData?.premise || {}) !==
    JSON.stringify(after?.accessData?.premise || {});
}
