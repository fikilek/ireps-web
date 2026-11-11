import { collection, onSnapshot, query, where } from "firebase/firestore";

export const emptyMdBgoDashboard = () => ({ batches: [], rows: [], wards: [], summaries: [], ready: false, error: "" });

export function mdBgoDashboardQueries(db, lmPcode) {
  return {
    batches: query(collection(db, "bgo_batches"), where("scope.lmPcode", "==", lmPcode)),
    rows: query(collection(db, "bgo_rows"), where("scope.lmPcode", "==", lmPcode)),
    wards: query(collection(db, "wards"), where("parents.localMunicipalityId", "==", lmPcode)),
    summaries: query(collection(db, "registry_wards"), where("localMunicipality.pcode", "==", lmPcode)),
  };
}

// A single lifecycle keeps all four server-confirmed sources scoped together.
// No limits: a truncated list cannot produce a municipal or workload total.
export function subscribeMdBgoDashboard(db, lmPcode, publish) {
  const state = emptyMdBgoDashboard();
  const received = new Set();
  const errors = new Map();
  const stops = [];
  let active = true;
  const emit = () => {
    if (!active) return;
    publish({ ...state, ready: received.size === 4 && !errors.size, error: [...errors.values()].join(" ") });
  };
  try {
    Object.entries(mdBgoDashboardQueries(db, lmPcode)).forEach(([key, source]) => {
      stops.push(onSnapshot(source, { includeMetadataChanges: true }, snapshot => {
        if (snapshot.metadata.fromCache) return;
        state[key] = snapshot.docs.map(item => ({ ...item.data(), id: item.id }));
        received.add(key);
        errors.delete(key);
        emit();
      }, error => {
        errors.set(key, `${key}: ${error.code || "read-error"}: ${error.message || "Could not read dashboard data."}`);
        emit();
      }));
    });
  } catch (error) {
    stops.forEach(stop => stop());
    errors.set("setup", error.message || "Could not start dashboard streams.");
    emit();
  }
  return () => { active = false; stops.forEach(stop => stop()); };
}
