export const ADDRESS_FIELDS = ["strNo", "strName", "strType", "unitName", "unitNo"];
const text = value => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
const absent = value => !text(value) || ["NAV", "N/A", "SELECT..."].includes(text(value).toUpperCase());
const comparable = value => text(value).toLowerCase().replace(/\s+/g, " ");

// A one-time, explicitly recorded reconstruction from the linked premise.
// This does not claim that today's premise values were captured historically.
export function planRegistryAddressBackfill(record, premise) {
  const saved = record?.accessData?.premise;
  if (!saved?.id || !premise) return { status: "HOLD", reason: "Premise reference missing" };
  if (!record.accessData.parents?.lmPcode || record.accessData.parents.lmPcode !== premise.parents?.lmPcode)
    return { status: "HOLD", reason: "Municipality mismatch" };
  if (!record.accessData.erfId || record.accessData.erfId !== premise.erfId)
    return { status: "HOLD", reason: "ERF mismatch" };
  const values = {
    strNo: text(premise.address?.strNo),
    strName: text(premise.address?.strName),
    strType: text(premise.address?.strType),
    unitName: absent(premise.propertyType?.name) ? "NAv" : text(premise.propertyType.name),
    unitNo: absent(premise.propertyType?.unitNo) ? "NAv" : text(premise.propertyType.unitNo),
  };
  if (["strNo", "strName", "strType"].some(key => absent(values[key])))
    return { status: "HOLD", reason: "Incomplete source street" };
  if (comparable(saved.address) !== comparable([values.strNo, values.strName, values.strType].join(" ")))
    return { status: "HOLD", reason: "Saved address differs from current premise" };
  const patch = {};
  for (const key of ADDRESS_FIELDS) {
    if (!absent(saved[key]) && text(saved[key]) !== values[key])
      return { status: "HOLD", reason: `Existing ${key} conflicts with premise` };
    if (saved[key] !== values[key]) patch[`accessData.premise.${key}`] = values[key];
  }
  return { status: Object.keys(patch).length ? "UPDATE" : "UNCHANGED", values, patch };
}
