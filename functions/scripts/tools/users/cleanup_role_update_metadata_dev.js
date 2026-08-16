import fs from "node:fs";
import admin from "firebase-admin";

const EXPECTED_PROJECT_ID = "ireps2";
const DEFAULT_SERVICE_ACCOUNT = "C:\\dev\\secrets\\ireps2-e72fd9dc94de.json";
const CONFIRM_TOKEN = "REMOVE_ROLE_UPDATED_METADATA_FROM_IREPS2_USERS";
const BAD_METADATA_FIELDS = Object.freeze([
  "roleUpdatedAt",
  "roleUpdatedByUid",
  "roleUpdatedByUser",
]);

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function displayName(data = {}, fallback = "NAv") {
  const profile = data.profile || {};
  const joined = [profile.name, profile.surname]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");

  return (
    String(profile.displayName || "").trim() ||
    joined ||
    String(profile.email || "").trim() ||
    fallback
  );
}

function presentBadFields(data = {}) {
  const metadata = data.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }

  return BAD_METADATA_FIELDS.filter((field) => hasOwn(metadata, field));
}

function stripBadMetadata(data = {}) {
  const copy = { ...data };
  const metadata = data.metadata;

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return copy;
  }

  const cleanMetadata = { ...metadata };
  BAD_METADATA_FIELDS.forEach((field) => delete cleanMetadata[field]);
  copy.metadata = cleanMetadata;
  return copy;
}

function comparable(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (value instanceof Date) return { __type: "Date", iso: value.toISOString() };
  if (Buffer.isBuffer(value)) {
    return { __type: "Bytes", base64: value.toString("base64") };
  }
  if (value instanceof Uint8Array) {
    return { __type: "Bytes", base64: Buffer.from(value).toString("base64") };
  }
  if (
    typeof value.seconds !== "undefined" &&
    typeof value.nanoseconds !== "undefined" &&
    typeof value.toDate === "function"
  ) {
    return {
      __type: "Timestamp",
      seconds: String(value.seconds),
      nanoseconds: Number(value.nanoseconds),
    };
  }
  if (
    typeof value.latitude === "number" &&
    typeof value.longitude === "number"
  ) {
    return {
      __type: "GeoPoint",
      latitude: value.latitude,
      longitude: value.longitude,
    };
  }
  if (
    typeof value.path === "string" &&
    value.firestore &&
    typeof value.firestore === "object"
  ) {
    return { __type: "DocumentReference", path: value.path };
  }
  if (Array.isArray(value)) return value.map(comparable);

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, comparable(child)]),
  );
}

function canonical(value) {
  return JSON.stringify(comparable(value));
}

function updateTimeKey(snapshot) {
  const value = snapshot.updateTime;
  if (!value) return null;
  return `${String(value.seconds)}:${String(value.nanoseconds)}`;
}

async function readTargets(db) {
  const snapshot = await db.collection("users").get();
  const targets = [];

  snapshot.docs.forEach((doc) => {
    const data = doc.data() || {};
    const fields = presentBadFields(data);
    if (!fields.length) return;

    targets.push({
      ref: doc.ref,
      id: doc.id,
      data,
      displayName: displayName(data, doc.id),
      fields,
      updateTime: updateTimeKey(doc),
    });
  });

  targets.sort((left, right) => left.id.localeCompare(right.id));
  return { totalUsers: snapshot.size, targets };
}

function printTargets(label, inventory) {
  console.log("");
  console.log(label);
  console.log(`Users scanned: ${inventory.totalUsers}`);
  console.log(`Users containing roleUpdated metadata: ${inventory.targets.length}`);

  for (const target of inventory.targets) {
    const metadata = target.data.metadata || {};
    console.log(
      JSON.stringify({
        uid: target.id,
        displayName: target.displayName,
        fields: target.fields,
        values: Object.fromEntries(
          target.fields.map((field) => [field, metadata[field] ?? null]),
        ),
      }),
    );
  }
}

async function applyOne(db, target) {
  const expectedClean = stripBadMetadata(target.data);
  const deleteValue = admin.firestore.FieldValue.delete();

  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(target.ref);
    if (!current.exists) {
      throw new Error(`User disappeared before cleanup: ${target.id}`);
    }

    const currentTime = updateTimeKey(current);
    if (currentTime !== target.updateTime) {
      throw new Error(
        `Concurrent change detected for users/${target.id}. ` +
          `Expected updateTime ${target.updateTime}, found ${currentTime}.`,
      );
    }

    const currentData = current.data() || {};
    const currentFields = presentBadFields(currentData);
    if (!currentFields.length) return;

    const deleteFields = Object.fromEntries(
      BAD_METADATA_FIELDS.map((field) => [
        `metadata.${field}`,
        deleteValue,
      ]),
    );

    transaction.update(target.ref, deleteFields);
  });

  const after = await target.ref.get();
  if (!after.exists) {
    throw new Error(`User disappeared after cleanup: ${target.id}`);
  }

  const afterData = after.data() || {};
  const remaining = presentBadFields(afterData);
  if (remaining.length) {
    throw new Error(
      `Cleanup verification failed for users/${target.id}; remaining fields: ` +
        remaining.join(", "),
    );
  }

  if (canonical(afterData) !== canonical(expectedClean)) {
    throw new Error(
      `Cleanup verification failed for users/${target.id}; ` +
        "document data changed outside the three approved metadata fields.",
    );
  }
}

async function main() {
  const apply = hasFlag("--apply");
  const projectId = arg("--project-id", EXPECTED_PROJECT_ID);
  const serviceAccountPath = arg(
    "--service-account",
    process.env.IREPS_DEV_SERVICE_ACCOUNT || DEFAULT_SERVICE_ACCOUNT,
  );

  if (projectId !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `DEV guard failed. Expected project ${EXPECTED_PROJECT_ID}; got ${projectId}.`,
    );
  }

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(`Service account file not found: ${serviceAccountPath}`);
  }

  const credential = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
  if (credential.project_id !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `Service-account guard failed. Expected ${EXPECTED_PROJECT_ID}; ` +
        `got ${credential.project_id || "NAv"}.`,
    );
  }

  if (apply && arg("--confirm") !== CONFIRM_TOKEN) {
    throw new Error(
      `Apply mode requires --confirm ${CONFIRM_TOKEN}`,
    );
  }

  const app = admin.initializeApp(
    {
      credential: admin.credential.cert(credential),
      projectId,
    },
    `user-role-metadata-cleanup-${Date.now()}`,
  );

  try {
    const db = admin.firestore(app);
    const before = await readTargets(db);
    printTargets("USER ROLE METADATA CLEANUP PRECHECK", before);

    if (!apply) {
      console.log("");
      console.log("MODE: DRY RUN");
      console.log("Firestore writes: 0");
      console.log(
        `To apply exactly this cleanup, rerun with --apply --confirm ${CONFIRM_TOKEN}`,
      );
      return;
    }

    console.log("");
    console.log("MODE: APPLY");
    console.log(
      "Approved deletion scope: metadata.roleUpdatedAt, " +
        "metadata.roleUpdatedByUid, metadata.roleUpdatedByUser",
    );

    let writes = 0;
    for (const target of before.targets) {
      await applyOne(db, target);
      writes += 1;
      console.log(`VERIFIED users/${target.id} (${target.displayName})`);
    }

    const after = await readTargets(db);
    printTargets("USER ROLE METADATA CLEANUP POSTCHECK", after);

    if (after.targets.length !== 0) {
      throw new Error(
        `${after.targets.length} user document(s) still contain roleUpdated metadata.`,
      );
    }

    console.log("");
    console.log("STATUS: PASSED");
    console.log(`Firestore writes: ${writes}`);
    console.log("Remaining users with roleUpdated metadata: 0");
  } finally {
    await app.delete();
  }
}

main().catch((error) => {
  console.error("USER ROLE METADATA CLEANUP FAILED", error);
  process.exitCode = 1;
});
