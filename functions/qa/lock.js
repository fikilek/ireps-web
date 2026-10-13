import { HttpsError } from "firebase-functions/v2/https";

export function assertQaUnlocked(trn) {
  if (trn?.qa?.state === "PASS") throw new HttpsError("failed-precondition", "QA Pass is final. This transaction is locked; record a new transaction for later work.");
}
