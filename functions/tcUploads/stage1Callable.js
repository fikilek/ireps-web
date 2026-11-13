import { onCall } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { validateStage1Upload } from "./stage1Matching.js";

export const onValidateTrnBgoStage1Callable = onCall(
  { region: "us-central1", timeoutSeconds: 300, memory: "512MiB" },
  (request) => validateStage1Upload({ db: getFirestore(), uid: request.auth?.uid, data: request.data }),
);
