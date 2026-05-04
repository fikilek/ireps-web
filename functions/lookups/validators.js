import { HttpsError } from "firebase-functions/v2/https";

import {
  LOOKUP_ADMIN_ROLES,
  LOOKUP_KEY_REGEX,
  MAX_DESCRIPTION_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_LOOKUP_KEY_LENGTH,
  MAX_OPTION_CODE_LENGTH,
  MAX_TITLE_LENGTH,
  OPTION_CODE_REGEX,
  RESERVED_OPTION_CODES,
} from "./constants.js";

export function sanitizeString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function sanitizeLookupKey(value) {
  const lookupKey = sanitizeString(value).toUpperCase();

  if (!lookupKey) {
    throw new HttpsError("invalid-argument", "lookupKey is required.");
  }

  if (lookupKey.length > MAX_LOOKUP_KEY_LENGTH) {
    throw new HttpsError("invalid-argument", "lookupKey is too long.");
  }

  if (!LOOKUP_KEY_REGEX.test(lookupKey)) {
    throw new HttpsError(
      "invalid-argument",
      "lookupKey must use uppercase letters, numbers, and underscores only.",
    );
  }

  return lookupKey;
}

export function sanitizeOptionCode(value) {
  const optionCode = sanitizeString(value).toUpperCase();

  if (!optionCode) {
    throw new HttpsError("invalid-argument", "option code is required.");
  }

  if (optionCode.length > MAX_OPTION_CODE_LENGTH) {
    throw new HttpsError("invalid-argument", "option code is too long.");
  }

  if (!OPTION_CODE_REGEX.test(optionCode)) {
    throw new HttpsError(
      "invalid-argument",
      "option code must use uppercase letters, numbers, and underscores only.",
    );
  }

  if (RESERVED_OPTION_CODES.includes(optionCode)) {
    throw new HttpsError(
      "invalid-argument",
      `${optionCode} is reserved and cannot be created as a normal option.`,
    );
  }

  return optionCode;
}

export function assertAuthenticated(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
}

export async function resolveAdminActor({ db, auth }) {
  if (!auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const userSnap = await db.collection("users").doc(auth.uid).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};

  const role = sanitizeString(
    auth.token?.role || userData?.employment?.role || userData?.role,
  ).toUpperCase();

  if (!LOOKUP_ADMIN_ROLES.includes(role)) {
    throw new HttpsError(
      "permission-denied",
      "Only ADM or SPU may manage iREPS lookup options.",
    );
  }

  const displayName =
    sanitizeString(auth.token?.name) ||
    sanitizeString(auth.token?.email) ||
    sanitizeString(userData?.profile?.displayName) ||
    sanitizeString(
      `${userData?.profile?.name || ""} ${userData?.profile?.surname || ""}`,
    ) ||
    auth.uid;

  return {
    uid: auth.uid,
    role,
    name: displayName,
  };
}

export function sanitizeLimitedString(value, fieldName, maxLength) {
  const clean = sanitizeString(value);

  if (clean.length > maxLength) {
    throw new HttpsError("invalid-argument", `${fieldName} is too long.`);
  }

  return clean;
}

export function sanitizeRequiredString(value, fieldName, maxLength) {
  const clean = sanitizeLimitedString(value, fieldName, maxLength);

  if (!clean) {
    throw new HttpsError("invalid-argument", `${fieldName} is required.`);
  }

  return clean;
}

export function sanitizeLookupCreateInput(input = {}) {
  const lookupKey = sanitizeLookupKey(input.lookupKey);

  const title = sanitizeRequiredString(input.title, "title", MAX_TITLE_LENGTH);

  const description = sanitizeLimitedString(
    input.description,
    "description",
    MAX_DESCRIPTION_LENGTH,
  );

  const domain = sanitizeRequiredString(
    input.domain,
    "domain",
    MAX_TITLE_LENGTH,
  ).toUpperCase();

  const fieldKey = sanitizeLimitedString(
    input.fieldKey,
    "fieldKey",
    MAX_TITLE_LENGTH,
  );

  const allowOther = input.allowOther !== false;

  const otherCode = sanitizeString(input.otherCode || "OTHER").toUpperCase();

  const otherLabel = sanitizeLimitedString(
    input.otherLabel || "Other",
    "otherLabel",
    MAX_LABEL_LENGTH,
  );

  if (allowOther && !otherLabel) {
    throw new HttpsError(
      "invalid-argument",
      "otherLabel is required when allowOther is true.",
    );
  }

  return {
    lookupKey,
    title,
    description,
    domain,
    fieldKey,
    allowOther,
    otherCode,
    otherLabel,
    system: Boolean(input.system),
  };
}

export function sanitizeLookupPatch(input = {}) {
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(input, "title")) {
    patch.title = sanitizeRequiredString(
      input.title,
      "title",
      MAX_TITLE_LENGTH,
    );
  }

  if (Object.prototype.hasOwnProperty.call(input, "description")) {
    patch.description = sanitizeLimitedString(
      input.description,
      "description",
      MAX_DESCRIPTION_LENGTH,
    );
  }

  if (Object.prototype.hasOwnProperty.call(input, "domain")) {
    patch.domain = sanitizeRequiredString(
      input.domain,
      "domain",
      MAX_TITLE_LENGTH,
    ).toUpperCase();
  }

  if (Object.prototype.hasOwnProperty.call(input, "fieldKey")) {
    patch.fieldKey = sanitizeLimitedString(
      input.fieldKey,
      "fieldKey",
      MAX_TITLE_LENGTH,
    );
  }

  if (Object.prototype.hasOwnProperty.call(input, "allowOther")) {
    patch.allowOther = input.allowOther !== false;
  }

  if (Object.prototype.hasOwnProperty.call(input, "otherLabel")) {
    patch.otherLabel = sanitizeLimitedString(
      input.otherLabel,
      "otherLabel",
      MAX_LABEL_LENGTH,
    );
  }

  if (Object.prototype.hasOwnProperty.call(input, "system")) {
    patch.system = Boolean(input.system);
  }

  // Not allowed after creation.
  delete patch.lookupKey;
  delete patch.otherCode;
  delete patch.metadata;
  delete patch.optionCount;
  delete patch.version;
  delete patch.status;

  return patch;
}

export function sanitizeOptionCreateInput(input = {}) {
  const code = sanitizeOptionCode(input.code);

  const label = sanitizeRequiredString(input.label, "label", MAX_LABEL_LENGTH);

  const description = sanitizeLimitedString(
    input.description,
    "description",
    MAX_DESCRIPTION_LENGTH,
  );

  const sortOrder = Number(input.sortOrder ?? 9999);

  if (!Number.isFinite(sortOrder) || sortOrder < 0) {
    throw new HttpsError(
      "invalid-argument",
      "sortOrder must be a positive number.",
    );
  }

  return {
    code,
    label,
    description,
    sortOrder,
    system: Boolean(input.system),
  };
}

export function sanitizeOptionPatch(input = {}) {
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(input, "label")) {
    patch.label = sanitizeRequiredString(
      input.label,
      "label",
      MAX_LABEL_LENGTH,
    );
  }

  if (Object.prototype.hasOwnProperty.call(input, "description")) {
    patch.description = sanitizeLimitedString(
      input.description,
      "description",
      MAX_DESCRIPTION_LENGTH,
    );
  }

  if (Object.prototype.hasOwnProperty.call(input, "sortOrder")) {
    const sortOrder = Number(input.sortOrder);

    if (!Number.isFinite(sortOrder) || sortOrder < 0) {
      throw new HttpsError(
        "invalid-argument",
        "sortOrder must be a positive number.",
      );
    }

    patch.sortOrder = sortOrder;
  }

  if (Object.prototype.hasOwnProperty.call(input, "system")) {
    patch.system = Boolean(input.system);
  }

  // Not allowed after creation.
  delete patch.code;
  delete patch.lookupKey;
  delete patch.metadata;
  delete patch.status;

  return patch;
}
