/* eslint-disable no-console */

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const ACCOUNT_DATA_COLLECTION = "field_account_data";
const ACCOUNT_MASTER_COLLECTION = "account_master";
const ACCOUNT_REGISTRY_COLLECTION = "registry_accounts";
const PREMISES_COLLECTION = "premises";

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function printUsage() {
  console.log(`
Usage:
  node ./scripts/resetDataCleansingPremise.js --premiseId <PREMISE_ID> --confirm

Optional:
  --dryRun       Show what would be reset, without changing Firestore.

Required safety:
  --confirm      Required for real reset.

Example:
  node ./scripts/resetDataCleansingPremise.js --premiseId PRM_1780570583703_527_W4_2020 --dryRun
  node ./scripts/resetDataCleansingPremise.js --premiseId PRM_1780570583703_527_W4_2020 --confirm
`);
}

function chunkArray(items, size = 400) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function commitDeletes(db, docs, label, dryRun) {
  if (!docs.length) {
    console.log(`${label}: 0 docs`);
    return 0;
  }

  console.log(`${label}: ${docs.length} docs`);

  if (dryRun) {
    docs.forEach((doc) => console.log(`  DRY RUN delete ${doc.ref.path}`));
    return docs.length;
  }

  for (const chunk of chunkArray(docs)) {
    const batch = db.batch();
    chunk.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  return docs.length;
}

async function queryDocsByPremiseId(db, collectionName, premiseId) {
  const snap = await db
    .collection(collectionName)
    .where("premise.premiseId", "==", premiseId)
    .get();

  return snap.docs;
}

async function main() {
  const premiseId = readArg("--premiseId");
  const dryRun = hasFlag("--dryRun");
  const confirm = hasFlag("--confirm");

  if (!premiseId) {
    printUsage();
    throw new Error("premiseId is required.");
  }

  if (!dryRun && !confirm) {
    printUsage();
    throw new Error("Refusing to reset without --confirm. Use --dryRun to inspect first.");
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS is not set. Point it to your local service account JSON first.",
    );
  }

  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  console.log("========================================");
  console.log("iREPS Data Cleansing premise reset");
  console.log("========================================");
  console.log(`premiseId: ${premiseId}`);
  console.log(`mode: ${dryRun ? "DRY RUN" : "CONFIRMED RESET"}`);
  console.log("");

  const fieldAccountDocs = await queryDocsByPremiseId(
    db,
    ACCOUNT_DATA_COLLECTION,
    premiseId,
  );

  const accountMasterDocs = await queryDocsByPremiseId(
    db,
    ACCOUNT_MASTER_COLLECTION,
    premiseId,
  );

  const registryRef = db.collection(ACCOUNT_REGISTRY_COLLECTION).doc(premiseId);
  const registrySnap = await registryRef.get();

  const premiseRef = db.collection(PREMISES_COLLECTION).doc(premiseId);
  const premiseSnap = await premiseRef.get();

  console.log("Found:");
  console.log(`  field_account_data: ${fieldAccountDocs.length}`);
  console.log(`  account_master: ${accountMasterDocs.length}`);
  console.log(`  registry_accounts row: ${registrySnap.exists ? "yes" : "no"}`);
  console.log(`  premise row: ${premiseSnap.exists ? "yes" : "no"}`);
  console.log("");

  await commitDeletes(db, fieldAccountDocs, "field_account_data", dryRun);

  if (premiseSnap.exists) {
    if (dryRun) {
      console.log(`DRY RUN clear ${premiseRef.path}.accountRefs = []`);
    } else {
      await premiseRef.set(
        {
          accountRefs: [],
          metadata: {
            updatedAt: new Date().toISOString(),
            updatedByUid: "SYSTEM",
            updatedByUser: "Data Cleansing Reset Script",
          },
        },
        { merge: true },
      );
      console.log(`premises: cleared ${premiseRef.path}.accountRefs`);
    }
  }

  await commitDeletes(db, accountMasterDocs, "account_master", dryRun);

  if (registrySnap.exists) {
    if (dryRun) {
      console.log(`DRY RUN delete ${registryRef.path}`);
    } else {
      // Delete registry_accounts last because account_master writes/deletes can rebuild it.
      await registryRef.delete();
      console.log(`registry_accounts: deleted ${registryRef.path}`);
    }
  } else {
    console.log("registry_accounts: 0 docs");
  }

  if (!dryRun) {
    // Give any account_master trigger a moment to finish, then delete registry again if it reappeared.
    await new Promise((resolve) => setTimeout(resolve, 3500));
    const registryAfterSnap = await registryRef.get();
    if (registryAfterSnap.exists) {
      await registryRef.delete();
      console.log(`registry_accounts: deleted again after trigger rebuild ${registryRef.path}`);
    }

    // Keep this small marker so the premise shows it was intentionally reset without storing account data.
    await premiseRef.set(
      {
        metadata: {
          updatedAt: new Date().toISOString(),
          updatedByUid: "SYSTEM",
          updatedByUser: "Data Cleansing Reset Script",
        },
      },
      { merge: true },
    );
  }

  console.log("");
  console.log(dryRun ? "Dry run complete. No writes were made." : "Reset complete.");
  console.log("");
}

main().catch((error) => {
  console.error("resetDataCleansingPremise ---- ERROR");
  console.error(error?.message || error);
  process.exit(1);
});
