import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { rebuildErfBaseRow } from "../../../registry/erfBaseRowRebuild.js";

function getArgument(name) {
  const index = process.argv.indexOf(name);

  if (index < 0) return null;

  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value.trim() : null;
}

function printUsage() {
  console.log(
    "Usage: node ./scripts/tools/registry/backfillInformalErfRegistry.js --lm-pcode ZA7423",
  );
}

async function main() {
  const startedAtMs = Date.now();
  const lmPcode = String(getArgument("--lm-pcode") || "").toUpperCase();

  if (!lmPcode) {
    printUsage();
    throw new Error("--lm-pcode is required.");
  }

  initializeApp();

  const db = getFirestore();

  console.log("[INFORMAL ERF REGISTRY BACKFILL] START", {
    lmPcode,
  });

  const sourceSnapshot = await db
    .collection("ireps_erfs")
    .where("admin.localMunicipality.pcode", "==", lmPcode)
    .where("erf.type", "==", "INFORMAL")
    .get();

  const total = sourceSnapshot.size;

  console.log("[INFORMAL ERF REGISTRY BACKFILL] SOURCE READ COMPLETE", {
    lmPcode,
    total,
  });

  let succeeded = 0;
  let failed = 0;
  let created = 0;
  let refreshed = 0;

  for (const [index, sourceDocument] of sourceSnapshot.docs.entries()) {
    const erfId = sourceDocument.id;
    const registryRef = db.collection("registry_erfs").doc(erfId);

    console.log("[INFORMAL ERF REGISTRY BACKFILL] PROGRESS", {
      current: index + 1,
      total,
      erfId,
    });

    try {
      const existingRegistrySnapshot = await registryRef.get();
      const result = await rebuildErfBaseRow(erfId);

      if (!result) {
        throw new Error("No registry row was produced.");
      }

      if (existingRegistrySnapshot.exists) {
        refreshed += 1;
      } else {
        created += 1;
      }

      succeeded += 1;

      console.log("[INFORMAL ERF REGISTRY BACKFILL] ROW COMPLETE", {
        current: index + 1,
        total,
        erfId,
        erfNo: result.erfNo,
        action: existingRegistrySnapshot.exists ? "REFRESHED" : "CREATED",
      });
    } catch (error) {
      failed += 1;

      console.error("[INFORMAL ERF REGISTRY BACKFILL] ROW FAILED", {
        current: index + 1,
        total,
        erfId,
        code: error?.code || "BACKFILL_ROW_FAILED",
        message: error?.message || String(error),
        stack: error?.stack || null,
      });
    }
  }

  console.log("[INFORMAL ERF REGISTRY BACKFILL] COMPLETE", {
    lmPcode,
    total,
    succeeded,
    failed,
    created,
    refreshed,
    elapsedMs: Date.now() - startedAtMs,
  });

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[INFORMAL ERF REGISTRY BACKFILL] FAILED", {
    code: error?.code || "BACKFILL_FAILED",
    message: error?.message || String(error),
    stack: error?.stack || null,
  });
  process.exitCode = 1;
});
