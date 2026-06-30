import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

const RAW_APP_ENV = (
  import.meta.env.VITE_APP_ENV ||
  import.meta.env.MODE ||
  "development"
)
  .trim()
  .toLowerCase();

const APP_ENV_ALIASES = {
  development: "dev",
  dev: "dev",
  test: "test",
};

const APP_ENV = APP_ENV_ALIASES[RAW_APP_ENV];

const FIREBASE_CONFIGS = {
  dev: {
    apiKey: "AIzaSyAkE9nf-G-gW9Pv9ZSxRzyr0FL3G6XXJA8",
    authDomain: "ireps2.firebaseapp.com",
    projectId: "ireps2",
    storageBucket: "ireps2.appspot.com",
    messagingSenderId: "885517634969",
    appId: "1:885517634969:web:f013c3961097836245d708",
  },

  test: {
    apiKey: "AIzaSyByO39nV149fricf4ltUcOWDIsJHpLQ7Lg",
    authDomain: "ireps-test.firebaseapp.com",
    projectId: "ireps-test",
    storageBucket: "ireps-test.firebasestorage.app",
    messagingSenderId: "941227937262",
    appId: "1:941227937262:web:92d002062f1e39784a92ff",
  },
};

const firebaseConfig = FIREBASE_CONFIGS[APP_ENV];

if (!firebaseConfig) {
  throw new Error(
    `[iREPS Web Firebase] Unsupported VITE_APP_ENV/MODE="${RAW_APP_ENV}". Expected one of: ${Object.keys(
      FIREBASE_CONFIGS,
    ).join(", ")}`,
  );
}

if (!firebaseConfig.projectId) {
  throw new Error(
    `[iREPS Web Firebase] Missing Firebase projectId for APP_ENV="${APP_ENV}".`,
  );
}

console.log(
  `[iREPS Web Firebase] APP_ENV="${APP_ENV}" project="${firebaseConfig.projectId}"`,
);

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);
export const storage = getStorage(app);
export const firebaseApp = app;
export const firebaseProjectId = firebaseConfig.projectId;
export const firebaseEnvironment = APP_ENV;

export default app;
