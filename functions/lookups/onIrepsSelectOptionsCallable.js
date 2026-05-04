import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

import {
  DEFAULT_OTHER_CODE,
  LOOKUPS_COLLECTION,
  LOOKUP_STATUSES,
  OPTION_STATUSES,
} from "./constants.js";

import { assertAuthenticated, sanitizeLookupKey } from "./validators.js";

import {
  normalizeLookupForForm,
  normalizeOptionForForm,
  sortLookupOptions,
} from "./serializers.js";

export const onIrepsSelectOptionsCallable = onCall(async (request) => {
  assertAuthenticated(request);

  const db = getFirestore();

  const lookupKey = sanitizeLookupKey(request.data?.lookupKey);

  logger.info("onIrepsSelectOptionsCallable -- START", {
    lookupKey,
    uid: request.auth?.uid || "NAv",
  });

  const lookupRef = db.collection(LOOKUPS_COLLECTION).doc(lookupKey);
  const lookupSnap = await lookupRef.get();

  if (!lookupSnap.exists) {
    logger.warn("onIrepsSelectOptionsCallable -- lookup not found", {
      lookupKey,
    });

    throw new HttpsError("not-found", `Lookup ${lookupKey} does not exist.`);
  }

  const lookup = lookupSnap.data() || {};
  const lookupStatus = String(lookup.status || "").toUpperCase();

  if (lookupStatus !== LOOKUP_STATUSES.PUBLISHED) {
    logger.warn("onIrepsSelectOptionsCallable -- lookup not published", {
      lookupKey,
      lookupStatus,
    });

    throw new HttpsError(
      "failed-precondition",
      `Lookup ${lookupKey} is not published.`,
    );
  }

  const optionsSnap = await lookupRef
    .collection("options")
    .where("status", "==", OPTION_STATUSES.PUBLISHED)
    .get();

  const options = optionsSnap.docs
    .map(normalizeOptionForForm)
    .filter(Boolean)
    .filter((option) => option.code !== DEFAULT_OTHER_CODE)
    .sort(sortLookupOptions);

  const response = normalizeLookupForForm({
    lookupKey,
    lookup,
    options,
  });

  logger.info("onIrepsSelectOptionsCallable -- SUCCESS", {
    lookupKey,
    optionCount: options.length,
    version: response.version,
    allowOther: response.allowOther,
  });

  return response;
});
