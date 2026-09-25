import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  clearIndexedDbPersistence,
  enablePersistentCacheIndexAutoCreation,
  getPersistentCacheIndexManager,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
} from "firebase/firestore";
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

// Web Data Copy rules WD-R001: one saved copy of the records read, kept in the
// browser and shared by all iREPS tabs (one tab talks to the server for all).
// Endumeni's Sales alone are about 38 MB, so the standard 40 MB is too small.
export const SAVED_COPY_MAX_BYTES = 200 * 1024 * 1024;
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
    cacheSizeBytes: SAVED_COPY_MAX_BYTES,
  }),
});

// WD-R001: the saved copy answers a question about one small area by reading the whole saved
// collection, unless the browser keeps a lookup for it. Firestore does not keep one unless asked,
// so a map layer asking for one street had to read every Sales record ever saved (Endumeni: about
// 10,273) before it could draw. Let the browser build its own lookups: it does so the first time a
// read is worth one, and every later read of the same shape uses it. Without this, the saved copy
// WD-R001 added makes every bounded read (the map layers of 18.7 and TB-R055.7) slower than before.
// Returns null if the saved copy is not in use, so nothing is assumed.
export const savedCopyIndexes = getPersistentCacheIndexManager(db);
if (savedCopyIndexes) enablePersistentCacheIndexAutoCreation(savedCopyIndexes);

// WD-R001.4: signing out, from any tab or page, deletes the saved copy and
// returns the tab to the sign-in page. Every tab of the browser sees the
// sign-out and stops its connection. The browser deletes the copy only once
// all of them have; until then it waits rather than failing, so give up
// after 10 seconds and go to the sign-in page either way.
export const SAVED_COPY_DELETE_LIMIT_MS = 10_000;
let signedInUid = null;

function deleteSavedCopy() {
  let timer = null;
  const timeUp = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("The saved copy was not deleted within 10 seconds.")),
      SAVED_COPY_DELETE_LIMIT_MS,
    );
  });
  const deleting = terminate(db).then(() => clearIndexedDbPersistence(db));
  return Promise.race([deleting, timeUp]).finally(() => clearTimeout(timer));
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    signedInUid = user.uid;
    return;
  }
  if (!signedInUid) return;
  signedInUid = null;
  deleteSavedCopy()
    .catch((error) => console.error("[iREPS Web Firebase] The saved copy could not be deleted at sign-out", error?.code || error?.message || error))
    .finally(() => window.location.reload());
});

export const functions = getFunctions(app);
export const storage = getStorage(app);
export const firebaseApp = app;
export const firebaseProjectId = firebaseConfig.projectId;

export default app;
