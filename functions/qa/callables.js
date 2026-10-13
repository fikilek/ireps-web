import { onCall } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getQaReview, saveQaReview } from "./review.js";

export const getTrnQaReview = onCall({ timeoutSeconds: 120 }, request => getQaReview(getFirestore(), request.auth?.uid, request.data || {}, { bucket: getStorage().bucket() }));
export const saveTrnQaReview = onCall(request => saveQaReview(getFirestore(), request.auth?.uid, request.data || {}));
