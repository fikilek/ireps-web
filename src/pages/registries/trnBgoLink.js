function clean(value) {
  const text = String(value ?? "").trim();
  return text && text.toUpperCase() !== "NAV" ? text : "";
}

export function resolveTrnBgoLink(row = {}) {
  const batchId = clean(row.bgoBatchId) || clean(row.batchId) || clean(row.tcId);
  if (!batchId) return null;

  const explicitKind = clean(row.bgoKind).toUpperCase();
  const channel = clean(row.originChannel).toUpperCase();
  const isMdBgo =
    explicitKind === "MD_BGO" ||
    channel === "MD_BGO" ||
    /^(MD_BGO_|BMD_)/i.test(batchId);
  const rowId = clean(row.bgoRowId) || clean(row.tcRowId);
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
