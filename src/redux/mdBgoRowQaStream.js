import { doc, onSnapshot } from "firebase/firestore";

export const emptyMdBgoRowQa = () => ({ premises: {}, trns: {}, ready: false, error: "" });

// Exact registry source documents, never an ERF-wide or meter-number match.
export function mdBgoRowQaSources(db, { premiseIds = [], trnIds = [] }) {
  return [["premises", premiseIds], ["trns", trnIds]].flatMap(([collection, ids]) =>
    [...new Set(ids.filter(Boolean))].map(id => ({ collection, id, ref: doc(db, collection, id) })),
  );
}

export function subscribeMdBgoRowQa(db, links, publish) {
  const state = emptyMdBgoRowQa();
  const sources = mdBgoRowQaSources(db, links);
  const received = new Set(), errors = new Map(), stops = [];
  let active = true;
  const emit = () => active && publish({ ...state, premises: { ...state.premises }, trns: { ...state.trns }, ready: received.size === sources.length && !errors.size, error: [...errors.values()].join(" ") });
  try {
    sources.forEach(({ collection, id, ref }) => {
      const key = `${collection}/${id}`;
      stops.push(onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
        if (snapshot.metadata.fromCache) return;
        state[collection][id] = snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null;
        received.add(key);
        errors.delete(key);
        emit();
      }, error => {
        errors.set(key, `${key}: ${error.code || "read-error"}: ${error.message || "Could not read linked QA."}`);
        emit();
      }));
    });
    emit();
  } catch (error) {
    stops.forEach(stop => stop());
    errors.set("setup", error.message || "Could not start QA streams.");
    emit();
  }
  return () => { active = false; stops.forEach(stop => stop()); };
}
