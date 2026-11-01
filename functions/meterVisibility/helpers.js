// Meter visibility rules MV-R001 (ireps-rules/logic-rules/meter-visibility-rules.md).
// A meter is VISIBLE only when its meter master holds both a field link and a Sales link.

export const METER_VISIBILITY = Object.freeze({
  VISIBLE: "VISIBLE",
  INVISIBLE: "INVISIBLE",
});

export const SALES_LINK_SKIP_REASONS = Object.freeze({
  NO_SALES_RECORD: "NO_SALES_RECORD",
  LINK_ALREADY_SET: "LINK_ALREADY_SET",
  LINK_SET_TO_OTHER_METER: "LINK_SET_TO_OTHER_METER",
  SALES_PROVIDER_MISSING: "SALES_PROVIDER_MISSING",
  SALES_PROVIDER_NOT_GOVERNED: "SALES_PROVIDER_NOT_GOVERNED",
  SALES_LM_MISSING: "SALES_LM_MISSING",
  LM_MISMATCH: "LM_MISMATCH",
  METER_TYPE_MISMATCH: "METER_TYPE_MISMATCH",
});

export const AST_VISIBILITY_OUTCOMES = Object.freeze({
  UPDATED: "UPDATED",
  UNCHANGED: "UNCHANGED",
  AST_MISSING: "AST_MISSING",
  AST_MASTER_MISMATCH: "AST_MASTER_MISMATCH",
});

export const METER_VISIBILITY_SYSTEM_ACTOR = Object.freeze({
  uid: "SYSTEM",
  user: "Meter visibility rule (MV-R001)",
});

const text = (value) => String(value ?? "").trim();
const GOVERNED_SALES_PROVIDERS = new Set(["conlog", "contour"]);
const isTimestampLike = (value) =>
  Boolean(value) && typeof value === "object" && typeof value.toDate === "function";

export function deriveMeterVisibility(master) {
  return text(master?.refs?.asts?.id) && text(master?.refs?.sales?.id)
    ? METER_VISIBILITY.VISIBLE
    : METER_VISIBILITY.INVISIBLE;
}

// Section 4: a blank Sales link is filled only with the meter's own number, only when its
// Sales record exists, and only when that record is for the same LM and meter type.
// Sales records carry no meter type today; the Sales pipeline loads electricity meters only.
export function planBlankSalesLink({
  masterId, master, salesExists, salesData, masterLmPcode, masterMeterType,
}) {
  const skip = (reason) => ({ link: null, reason });
  if (!salesExists) return skip(SALES_LINK_SKIP_REASONS.NO_SALES_RECORD);

  const existingSalesId = text(master?.refs?.sales?.id);
  if (existingSalesId) {
    return skip(existingSalesId === masterId
      ? SALES_LINK_SKIP_REASONS.LINK_ALREADY_SET
      : SALES_LINK_SKIP_REASONS.LINK_SET_TO_OTHER_METER);
  }

  const provider = text(salesData?.provider).toLowerCase();
  if (!provider) return skip(SALES_LINK_SKIP_REASONS.SALES_PROVIDER_MISSING);
  if (!GOVERNED_SALES_PROVIDERS.has(provider)) {
    return skip(SALES_LINK_SKIP_REASONS.SALES_PROVIDER_NOT_GOVERNED);
  }

  const salesLm = text(salesData?.lmPcode).toUpperCase();
  if (!salesLm) return skip(SALES_LINK_SKIP_REASONS.SALES_LM_MISSING);
  if (salesLm !== text(masterLmPcode).toUpperCase()) {
    return skip(SALES_LINK_SKIP_REASONS.LM_MISMATCH);
  }

  const salesMeterType = text(salesData?.meterType).toLowerCase() || "electricity";
  if (salesMeterType !== text(masterMeterType).toLowerCase()) {
    return skip(SALES_LINK_SKIP_REASONS.METER_TYPE_MISMATCH);
  }

  return { link: { id: masterId, provider }, reason: null };
}

export function applySalesLink(master, link) {
  if (!link) return master;
  return {
    ...master,
    refs: {
      ...(master?.refs || {}),
      sales: { id: link.id, provider: link.provider },
    },
  };
}

// Section 3: the field record's copy follows the meter master. The metadata time stays a
// Firestore Timestamp only when the record already uses one; otherwise ISO text (asts.md).
export function planAstVisibilitySync({
  masterId, astData, desiredVisibility, isoNow, timestampNow,
}) {
  if (!astData) return { outcome: AST_VISIBILITY_OUTCOMES.AST_MISSING, patch: null };
  if (text(astData?.master?.id) !== masterId) {
    return { outcome: AST_VISIBILITY_OUTCOMES.AST_MASTER_MISMATCH, patch: null };
  }
  if (astData?.master?.visibility === desiredVisibility) {
    return { outcome: AST_VISIBILITY_OUTCOMES.UNCHANGED, patch: null };
  }
  const existingUpdatedAt = astData?.metadata?.updatedAt;
  return {
    outcome: AST_VISIBILITY_OUTCOMES.UPDATED,
    patch: {
      "master.visibility": desiredVisibility,
      "metadata.updatedAt": isTimestampLike(existingUpdatedAt) ? timestampNow : isoNow,
      "metadata.updatedByUid": METER_VISIBILITY_SYSTEM_ACTOR.uid,
      "metadata.updatedByUser": METER_VISIBILITY_SYSTEM_ACTOR.user,
    },
  };
}
