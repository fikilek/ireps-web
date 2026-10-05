const iso = value => {
  const date = typeof value?.toDate === "function" ? value.toDate() :
    typeof value === "string" && value.trim() ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

// The card's Updated label follows a change to its recorded visit history too. Use the
// acknowledged server time, preserving capture times on the visit and never moving back.
export function noAccessPremiseMetadata(metadata = {}, current = {}) {
  const at = iso(metadata.updatedAt) || iso(metadata.createdAt);
  const previous = iso(current.updatedAt);
  if (!at || (previous && at <= previous)) return {};
  return {
    "metadata.updatedAt": at,
    "metadata.updatedByUid": metadata.updatedByUid || metadata.createdByUid || null,
    "metadata.updatedByUser": metadata.updatedByUser || metadata.createdByUser || null,
  };
}
