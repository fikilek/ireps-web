import { collection, doc, documentId, onSnapshot, query, where } from "firebase/firestore";
import { buildMdBgoMapModel, mdBgoMapMembership } from "./mdBgoMapModel.js";

const chunks = (values) => Array.from({ length: Math.ceil(values.length / 30) }, (_, index) => values.slice(index * 30, index * 30 + 30));

// The same client entry point is exercised against the emulator and hosted DEV.
export function subscribeMdBgoMap(db, { batchId, lmPcode }, receive) {
  let active = true;
  const state = { batchId, lmPcode, batch: null, rows: [], erfById: {}, premiseById: {}, meterById: {}, geofence: null };
  const groups = new Map();
  let parentError = "";

  function publish() {
    if (!active) return;
    const error = parentError || [...groups.values()].find((group) => group.error)?.error || "";
    const ready = Boolean(error) || [...groups.values()].every((group) => group.ready);
    receive({ ...buildMdBgoMapModel(state), ready, error });
  }

  function stop(key) {
    const group = groups.get(key);
    groups.delete(key);
    group?.off.forEach((off) => off());
  }

  function watch(key, signature, sources, apply) {
    if (groups.get(key)?.signature === signature) return;
    stop(key);
    const group = { signature, off: [], values: new Map(), ready: sources.length === 0, error: "" };
    groups.set(key, group);
    apply([]);
    sources.forEach((source, index) => {
      const off = onSnapshot(source, (snapshot) => {
        if (!active || groups.get(key) !== group) return;
        const docs = snapshot.docs || (snapshot.exists() ? [snapshot] : []);
        group.values.set(index, docs.map((item) => ({ ...item.data(), id: item.id })));
        group.ready = group.values.size === sources.length;
        apply([...group.values.values()].flat());
        publish();
      }, (error) => {
        if (!active || groups.get(key) !== group) return;
        group.error = `${key}: ${error.code || "stream-error"} — ${error.message || "Firebase stream failed."}`;
        group.ready = true;
        publish();
      });
      group.off.push(off);
    });
  }

  const byId = (values) => Object.fromEntries(values.map((value) => [value.id, value]));
  const idSources = (name, ids) => chunks(ids).map((ids) => query(collection(db, name), where(documentId(), "in", ids)));

  function syncAssets() {
    const membership = mdBgoMapMembership(state.rows);
    watch("ERFs", JSON.stringify(membership.erfIds), idSources("ireps_erfs", membership.erfIds), (values) => { state.erfById = byId(values); });
    watch("Premises", JSON.stringify(membership.premiseIds), idSources("premises", membership.premiseIds), (values) => { state.premiseById = byId(values); });
    // MD BGO has one row per premise. Resolve every field meter linked to those premises.
    const meterSources = [
      ...idSources("asts", membership.meterIds),
      ...chunks(membership.premiseIds).map((ids) => query(collection(db, "asts"), where("accessData.premise.id", "in", ids))),
    ];
    watch("Meters", JSON.stringify([membership.meterIds, membership.premiseIds]), meterSources, (values) => { state.meterById = byId(values); });
  }

  watch("Batch", batchId, [doc(db, "bgo_batches", batchId)], (values) => {
    state.batch = values[0] || null;
    if (!state.batch) {
      parentError = "";
      for (const key of [...groups.keys()]) if (key !== "Batch") stop(key);
      state.rows = []; state.erfById = {}; state.premiseById = {}; state.meterById = {}; state.geofence = null;
      return;
    }
    const batch = state.batch;
    parentError = batch.batchMode !== "BMD" || batch.operationType !== "METER_DISCOVERY"
      ? "The selected batch is not an MD BGO batch."
      : batch.scope?.lmPcode !== lmPcode ? "This batch does not belong to the active Local Municipality workbase." : "";
    if (parentError) {
      for (const key of [...groups.keys()]) if (key !== "Batch") stop(key);
      state.rows = []; state.erfById = {}; state.premiseById = {}; state.meterById = {}; state.geofence = null;
      return;
    }
    watch("Rows", batchId, [query(collection(db, "bgo_rows"), where("bgoBatchId", "==", batchId))], (rows) => {
      state.rows = rows;
      syncAssets();
    });
    const fenceId = String(batch.geofenceRef?.id || batch.bgo?.geofenceId || "").trim();
    watch("Geofence", fenceId, fenceId ? [doc(db, "geo_fences", fenceId)] : [], (values) => { state.geofence = values[0] || null; });
  });

  return () => {
    active = false;
    for (const key of [...groups.keys()]) stop(key);
  };
}
