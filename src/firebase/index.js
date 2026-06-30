import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

export const firebaseEnvironment = String(
  import.meta.env.VITE_APP_ENV || import.meta.env.MODE || "unknown",
)
  .trim()
  .toLowerCase();

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missingFirebaseConfigKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingFirebaseConfigKeys.length > 0) {
  throw new Error(
    `[iREPS Web Firebase] Missing Firebase config values for APP_ENV="${firebaseEnvironment}": ${missingFirebaseConfigKeys.join(
      ", ",
    )}`,
  );
}

console.log(
  `[iREPS Web Firebase] APP_ENV="${firebaseEnvironment}" project="${firebaseConfig.projectId}"`,
);

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);
export const storage = getStorage(app);
export const firebaseApp = app;
export const firebaseProjectId = firebaseConfig.projectId;

export default app;
