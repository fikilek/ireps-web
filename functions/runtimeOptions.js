import { setGlobalOptions } from "firebase-functions/v2";

// index.js imports this module before any endpoint-defining dependencies.
// Firebase captures these defaults when each endpoint is constructed; setting
// them later would leave already imported endpoints on historical defaults.
// Source-defined options override this profile (including Batch Stats' cap).
setGlobalOptions({
  region: "us-central1",
  memory: "256MiB",
  cpu: 1,
  timeoutSeconds: 60,
  concurrency: 80,
  minInstances: 0,
  maxInstances: 20,
  preserveExternalChanges: false,
});
