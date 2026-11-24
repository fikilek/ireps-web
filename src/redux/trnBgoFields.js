function valueOrNav(value) {
  if (value === undefined || value === null) return "NAv";
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : "NAv";
  }
  return value;
}

export function getTcId(data = {}) {
  return valueOrNav(
    data.origin?.tcId ||
      data.origin?.trnBgo?.batchId ||
      data.origin?.trnBgoNoAccess?.batchId ||
      data.bgo?.tcId ||
      data.tcId ||
      data.refs?.tcId ||
      data.refs?.tcUploadId ||
      data.upload?.tcId,
  );
}

export function getBgoBatchId(data = {}) {
  return valueOrNav(
    data.origin?.trnBgo?.batchId ||
      data.origin?.trnBgoNoAccess?.batchId ||
      data.origin?.mdBgo?.batchId ||
      data.bgo?.batchId ||
      data.bgo?.bgoBatchId ||
      data.origin?.bgoBatchId ||
      data.bucket?.batchId ||
      data.bgoBatchId ||
      data.batchId ||
      data.refs?.bgoBatchId ||
      data.refs?.batchId,
  );
}

export function getBgoRowId(data = {}) {
  return valueOrNav(
    data.origin?.trnBgo?.rowId ||
      data.origin?.trnBgoNoAccess?.rowId ||
      data.origin?.mdBgo?.rowId ||
      data.bgo?.bgoRowId ||
      data.bgoRowId ||
      data.origin?.bgoRowId ||
      data.refs?.bgoRowId,
  );
}

export function getTcRowId(data = {}) {
  return valueOrNav(
    data.origin?.tcRowId ||
      data.origin?.trnBgo?.rowId ||
      data.origin?.trnBgoNoAccess?.rowId ||
      data.bgo?.tcRowId ||
      data.tcRowId ||
      data.refs?.tcRowId,
  );
}

export function getBgoKind(data = {}, bgoBatchId = "NAv") {
  const source = String(data.origin?.source || "").trim().toUpperCase();
  const kind = String(data.bgo?.kind || "").trim().toUpperCase();

  if (
    data.origin?.mdBgo?.batchId ||
    data.origin?.mdBgo?.rowId ||
    source === "MD_BGO" ||
    kind === "MD_BGO"
  ) {
    return "MD_BGO";
  }

  if (
    data.origin?.trnBgo?.batchId ||
    data.origin?.trnBgo?.rowId ||
    data.origin?.trnBgoNoAccess?.batchId ||
    source === "TRN_BGO" ||
    kind === "BGO_TRN" ||
    kind === "TRN_BGO"
  ) {
    return "TRN_BGO";
  }

  const batchStr = String(bgoBatchId || "").trim();
  if (/^(MD_BGO_|BMD_)/i.test(batchStr)) return "MD_BGO";
  if (batchStr && batchStr.toUpperCase() !== "NAV") return "TRN_BGO";
  return "NAv";
}

export function extractTrnBgoFields(data = {}) {
  const tcId = getTcId(data);
  const bgoBatchId = getBgoBatchId(data);
  const bgoRowId = getBgoRowId(data);
  const tcRowId = getTcRowId(data);
  const bgoKind = getBgoKind(data, bgoBatchId);

  return {
    tcId,
    bgoBatchId,
    batchId: bgoBatchId,
    bgoRowId,
    tcRowId,
    bgoKind,
  };
}
