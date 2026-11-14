import { collection, onSnapshot, query, where } from "firebase/firestore";
const clean = value => typeof value === "string" && value.trim() && value !== "NAv" ? value.trim() : "";
export function batchGeofenceNames(rows) {
  const refs = new Map();
  for (const row of rows) for (const ref of row.geofenceRefs || []) {
    const id = clean(typeof ref === "string" ? ref : ref.id);
    const name = clean(typeof ref === "string" ? ref : ref.name || ref.description);
    if (id && (!refs.has(id) || refs.get(id) === id)) refs.set(id, name || id);
  }
  return [...refs.values()].sort((a, b) => a.localeCompare(b)).join(", ") || "NAv";
}
export function batchCreator(batch) {
  return clean(batch.metadata?.createdByUser) || clean(batch.metadata?.createdByUid) || "NAv";
}
// One parent-constrained listener per batch respects tc_rows parent-based authorization.
export function subscribeTrnBgoRegisterDetails(db, batchIds, receive) {
  const values = {};
  const stops = [...new Set(batchIds)].map(id => onSnapshot(query(collection(db, "tc_rows"), where("tcId", "==", id)), snapshot => {
    values[id] = { text: batchGeofenceNames(snapshot.docs.map(doc => doc.data())), ready: true, error: "" };
    receive({ ...values });
  }, error => { values[id] = { text: "NAv", ready: true, error: error.message }; receive({ ...values }); }));
  return () => stops.forEach(stop => stop());
}
