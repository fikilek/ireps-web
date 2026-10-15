import { HttpsError } from "firebase-functions/v2/https";

import { isQaPassLocked } from "./model.js";

export function assertQaUnlocked(trn) {
  if (isQaPassLocked(trn)) throw new HttpsError("failed-precondition", "QA Pass is final. This transaction is locked; record a new transaction for later work.");
}
