import { onCall } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getQaReview, saveQaReview } from "./review.js";
import { getQaAmendment, listQaAmendments, saveQaAmendment } from "./amendments.js";
import { markQaNoticeRead } from "./notifications.js";
import {
  getPremiseQaReview as getPremiseReviewHelper,
  savePremiseQaReview as savePremiseReviewHelper,
  savePremiseCorrection as savePremiseCorrectionHelper,
} from "./premiseQaReview.js";

export const getTrnQaReview = onCall({ timeoutSeconds: 120 }, request => getQaReview(getFirestore(), request.auth?.uid, request.data || {}, { bucket: getStorage().bucket() }));
export const saveTrnQaReview = onCall(request => saveQaReview(getFirestore(), request.auth?.uid, request.data || {}));
export const getTrnQaAmendment = onCall({ timeoutSeconds: 120 }, request => getQaAmendment(getFirestore(), request.auth?.uid, request.data || {}, { bucket: getStorage().bucket() }));
export const listTrnQaAmendments = onCall(request => listQaAmendments(getFirestore(), request.auth?.uid, request.data || {}));
export const saveTrnQaAmendment = onCall({ timeoutSeconds: 120 }, request => saveQaAmendment(getFirestore(), request.auth?.uid, request.data || {}, { bucket: getStorage().bucket() }));
export const markTrnQaNoticeRead = onCall(request => markQaNoticeRead(getFirestore(), request.auth?.uid, request.data || {}));

export const getPremiseQaReview = onCall(request => getPremiseReviewHelper(getFirestore(), request.auth?.uid, request.data || {}));
export const savePremiseQaReview = onCall(request => savePremiseReviewHelper(getFirestore(), request.auth?.uid, request.data || {}));
export const savePremiseCorrection = onCall(request => savePremiseCorrectionHelper(getFirestore(), request.auth?.uid, request.data || {}));

