import { onCall } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { createSalesBatch } from "./sales-batch-creation.js";
import { createProofCodec, salesBatchProofKey, callableFailure } from "./sales-batch-resolution.js";

// Both Sales origins must present the same saved-fence and frozen-confirmation
// contract. Historical readers remain compatible; the old chunked creator is retired.
export const onCreateTargetedBatchCallable = onCall({ secrets: [salesBatchProofKey], timeoutSeconds: 180, memory: "1GiB" }, async request => {
  try {
    return await createSalesBatch({ db: getFirestore(), request, codec: createProofCodec(salesBatchProofKey.value()) });
  } catch (error) { return callableFailure(error); }
});
