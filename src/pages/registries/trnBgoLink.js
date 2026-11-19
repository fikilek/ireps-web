function clean(value) {
  const text = String(value ?? "").trim();
  return text && text.toUpperCase() !== "NAV" ? text : "";
}

export function resolveTrnBgoLink(row = {}) {
  const batchId = clean(row.bgoBatchId || row.batchId || row.tcId);
  if (!batchId) return null;

  const channel = clean(row.originChannel).toUpperCase();
  const isMdBgo = channel === "MD_BGO" || batchId.toUpperCase().startsWith("MD_BGO_");
  const rowId = clean(row.bgoRowId || row.tcRowId);
  const path = isMdBgo ? "/operations/md-bgo-rows" : "/operations/trn-bgo-rows";
  const params = new URLSearchParams({ batchId });
  if (rowId) params.set("bgoRowId", rowId);

  return {
    kind: isMdBgo ? "MD_BGO" : "TRN_BGO",
    kindLabel: isMdBgo ? "MD BGO" : "TRN BGO",
    batchId,
    rowId,
    href: `${path}?${params.toString()}`,
  };
}
