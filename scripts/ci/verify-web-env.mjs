import fs from "node:fs";
import { loadEnv } from "vite";

const EXPECTED = {
  dev: {
    firebaseProjectId: "ireps2",
    firebaseAuthDomain: "ireps2.firebaseapp.com",
    firebaseStorageBucket: "ireps2.appspot.com",
    firebaseAlias: "ireps2",
  },
  test: {
    firebaseProjectId: "ireps-test",
    firebaseAuthDomain: "ireps-test.firebaseapp.com",
    firebaseStorageBucket: "ireps-test.firebasestorage.app",
    firebaseAlias: "ireps-test",
  },
};

const envName = process.argv[2];
const expected = EXPECTED[envName];

if (!expected) {
  fail(
    `Unsupported web environment "${envName}". Use one of: ${Object.keys(
      EXPECTED,
    ).join(", ")}`,
  );
}

const viteEnv = loadEnv(envName, process.cwd(), "VITE_");
const resolvedEnv = {
  ...viteEnv,
  ...process.env,
};

const requiredVars = {
  VITE_APP_ENV: envName,
  VITE_FIREBASE_PROJECT_ID: expected.firebaseProjectId,
  VITE_FIREBASE_AUTH_DOMAIN: expected.firebaseAuthDomain,
  VITE_FIREBASE_STORAGE_BUCKET: expected.firebaseStorageBucket,
};

for (const [key, expectedValue] of Object.entries(requiredVars)) {
  assertEqual(`env.${key}`, resolvedEnv[key], expectedValue);
}

const firebaseRc = JSON.parse(fs.readFileSync(".firebaserc", "utf8"));
assertEqual(
  `.firebaserc projects.${envName}`,
  firebaseRc?.projects?.[envName],
  expected.firebaseAlias,
);

const firebaseIndex = fs.readFileSync("src/firebase/index.js", "utf8");
for (const envVar of [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
]) {
  if (!firebaseIndex.includes(`import.meta.env.${envVar}`)) {
    fail(`src/firebase/index.js must read ${envVar} from import.meta.env.`);
  }
}

console.log(
  `[iREPS Web CI] ${envName.toUpperCase()} environment verified: Firebase project ${expected.firebaseProjectId}`,
);

function assertEqual(label, actual, expectedValue) {
  if (actual !== expectedValue) {
    fail(`${label} expected "${expectedValue}" but got "${actual ?? "<missing>"}".`);
  }
}

function fail(message) {
  console.error(`[iREPS Web CI] ${message}`);
  process.exit(1);
}
