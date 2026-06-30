import {
  DEFAULT_OTHER_CODE,
  DEFAULT_OTHER_LABEL,
  OPTION_STATUSES,
} from "./constants.js";

import { sanitizeString } from "./validators.js";

export function timestampToJson(value) {
  if (!value) return null;

  if (typeof value.toDate === "function") {
    const date = value.toDate();

    return {
      iso: date.toISOString(),
      millis: date.getTime(),
    };
  }

  if (value instanceof Date) {
    return {
      iso: value.toISOString(),
      millis: value.getTime(),
    };
  }

  if (typeof value === "string") {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return {
        iso: date.toISOString(),
        millis: date.getTime(),
      };
    }

    return {
      iso: value,
      millis: null,
    };
  }

  return null;
}

export function normalizeLookupForForm({ lookupKey, lookup, options }) {
  return {
    lookupKey,

    title: sanitizeString(lookup?.title),
    description: sanitizeString(lookup?.description),

    domain: sanitizeString(lookup?.domain),
    fieldKey: sanitizeString(lookup?.fieldKey),

    version: Number.isFinite(Number(lookup?.version))
      ? Number(lookup.version)
      : 1,

    allowOther: lookup?.allowOther !== false,

    otherCode: sanitizeString(lookup?.otherCode) || DEFAULT_OTHER_CODE,

    otherLabel: sanitizeString(lookup?.otherLabel) || DEFAULT_OTHER_LABEL,

    updatedAt: timestampToJson(lookup?.metadata?.updatedAt),

    options,
  };
}

export function normalizeOptionForForm(doc) {
  const data = doc.data() || {};

  const code = sanitizeString(data.code || doc.id).toUpperCase();
  const label = sanitizeString(data.label);
  const rawStatus = sanitizeString(data.status).toUpperCase();
  const status =
    rawStatus ||
    (data.enabled !== false ? OPTION_STATUSES.PUBLISHED : OPTION_STATUSES.DISABLED);

  if (!code || !label) return null;

  return {
    code,
    label,
    value: sanitizeString(data.value) || code,
    name: sanitizeString(data.name) || label,
    description: sanitizeString(data.description),
    sortOrder: Number.isFinite(Number(data.sortOrder))
      ? Number(data.sortOrder)
      : 9999,
    status,
    enabled: data.enabled !== false,
    parentCode: sanitizeString(data.parentCode).toUpperCase(),
    appliesTo: Array.isArray(data.appliesTo)
      ? data.appliesTo.map(sanitizeString).filter(Boolean)
      : [],
  };
}

export function sortLookupOptions(a, b) {
  if (a.sortOrder !== b.sortOrder) {
    return a.sortOrder - b.sortOrder;
  }

  return String(a.label || "").localeCompare(String(b.label || ""));
}
