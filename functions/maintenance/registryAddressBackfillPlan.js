export const ADDRESS_FIELDS = ["propertyType", "address", "strNo", "strName", "strType", "unitName", "unitNo"];
export function assertRegistryBackfillProject(project, credentialProject) {
  if (!["ireps2", "ireps-test"].includes(project)) throw new Error("Registry backfill is restricted to DEV and TEST");
  if (credentialProject !== project) throw new Error("Credential project does not match the selected backfill project");
  return project;
}
const text = value => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
const absent = value => !text(value) || ["NAV", "N/A", "SELECT..."].includes(text(value).toUpperCase());

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
    propertyType: absent(premise.propertyType?.type) ? "NAv" : text(premise.propertyType.type),
    strNo: text(premise.address?.strNo),
    strName: text(premise.address?.strName),
    strType: text(premise.address?.strType),
    unitName: absent(premise.propertyType?.name) ? "NAv" : text(premise.propertyType.name),
    unitNo: absent(premise.propertyType?.unitNo) ? "NAv" : text(premise.propertyType.unitNo),
  };
  if (["strNo", "strName", "strType"].some(key => absent(values[key])))
    return { status: "HOLD", reason: "Incomplete source street" };
  values.address = [values.strNo, values.strName, values.strType].join(" ");
  // Owner instruction: the linked premise's address and unit details prevail.
  const patch = {};
  for (const key of ADDRESS_FIELDS) {
    if (saved[key] !== values[key]) patch[`accessData.premise.${key}`] = values[key];
  }
  return { status: Object.keys(patch).length ? "UPDATE" : "UNCHANGED", previousAddress: saved.address ?? null, values, patch };
}
