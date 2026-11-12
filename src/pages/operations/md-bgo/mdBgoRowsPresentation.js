export const MD_BGO_PREMISE_ADDRESS_WIDTH = 320;
export const MD_BGO_ROW_COLUMN_OPTIONS = Object.freeze([
  { key: "erfNo", label: "Erf No" },
  { key: "premiseAddress", label: "Premise Address" },
  { key: "propertyType", label: "Property Type" },
  { key: "propertyName", label: "Property Name" },
  { key: "unitNo", label: "Unit No" },
  { key: "progress", label: "Progress" },
  { key: "lastActivity", label: "Last Activity" },
  { key: "premiseQa", label: "Premise" },
  { key: "meterQa", label: "Meter" },
  { key: "qaFinal", label: "QA Final" },
  { key: "sourceRowId", label: "BGO Row ID" },
]);
export const MD_BGO_ROW_DEFAULT_VISIBILITY = Object.freeze(Object.fromEntries(
  MD_BGO_ROW_COLUMN_OPTIONS.map(({ key }) => [key, key !== "sourceRowId"]),
));

export function mdBgoVisibleRowColumns(columns, visibility) {
  return columns.filter(column => column.key === "meterNo" || visibility[column.key] !== false);
}

export function mdBgoMeterDetailsId(row) {
  const number = String(row?.meterNo || "").trim();
  const id = String(row?.meterId || "").trim();
  return number && number.toUpperCase() !== "NAV" && id && id.toUpperCase() !== "NAV" ? id : null;
}

export function clearMdBgoHiddenColumnFilter(filters, key) {
  const next = { ...filters };
  delete next[key];
  return next;
}
