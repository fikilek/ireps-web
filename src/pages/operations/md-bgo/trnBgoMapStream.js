import { batchPremisesWithGps } from "./mdBgoMapModel.js";
import { collection, doc, documentId, onSnapshot, query, where } from "firebase/firestore";
import { buildTargetedBatchMapReadModel } from "../../sales/models/salesTargetedBatchReadModel.js";
const unique = values => [...new Set(values.filter(value => value && value !== "NAv"))].sort();
const erfId = premise => premise?.erfId || premise?.parents?.erfId || premise?.erf?.id || premise?.refs?.erfId || premise?.accessData?.erf?.id || "";
function buildTrnMapModel(state) {
  const rows = state.rows.map(row => ({ id: row.id, rowNo: row.rowNo, refs: { meterId: row.astId, premiseId: row.premiseId || row.premise?.id, erfId: erfId(state.premiseById[row.premiseId || row.premise?.id]) } }));
  const model = buildTargetedBatchMapReadModel({ tbId: state.batchId, expectedLmPcode: state.lmPcode, batch: state.batch, rows, erfById: state.erfById, premiseById: batchPremisesWithGps(state.premiseById), meterById: state.meterById });
  return { ...model, batch: state.batch, geofences: state.geofences, geofence: state.geofences[0] || null, membership: { ...model.membership, rowCount: rows.length } };
}

const chunks = (values) => Array.from({ length: Math.ceil(values.length / 30) }, (_, index) => values.slice(index * 30, index * 30 + 30));

// The same client entry point is exercised against the emulator and hosted DEV.
export function subscribeTrnBgoMap(db, { batchId, lmPcode }, receive) {
  let active = true;
  const state = { batchId, lmPcode, batch: null, rows: [], erfById: {}, premiseById: {}, meterById: {}, geofence: null, geofences: [] };
  const groups = new Map();
  let parentError = "";
  state.wards = []; state.wardGeofences = [];

  function publish() {
    if (!active) return;
    const error = parentError || [...groups.values()].find((group) => group.error)?.error || "";
    const ready = Boolean(error) || [...groups.values()].every((group) => group.ready);
    receive({ ...buildTrnMapModel(state), wards: state.wards, wardGeofences: state.wardGeofences, ready, error });
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

  function syncErfs() {
    const ids = unique(Object.values(state.premiseById).map(erfId));
    watch("ERFs", JSON.stringify(ids), idSources("ireps_erfs", ids), values => { state.erfById = byId(values); });
  }
  function syncAssets() {
    const premiseIds = unique(state.rows.map(row => row.premiseId || row.premise?.id));
    const meterIds = unique(state.rows.map(row => row.astId));
    watch("Premises", JSON.stringify(premiseIds), idSources("premises", premiseIds), values => { state.premiseById = byId(values); syncErfs(); });
    watch("Meters", JSON.stringify(meterIds), idSources("asts", meterIds), values => { state.meterById = byId(values); });
    const fenceIds = unique(state.rows.flatMap(row => (row.geofenceRefs || []).map(ref => typeof ref === "string" ? ref : ref.id || ref.geofenceId)));
    watch("Geofences", JSON.stringify(fenceIds), idSources("geo_fences", fenceIds), values => {
      state.geofences = values.filter(fence => (fence.parents?.lmPcode || fence.lmPcode || fence.parents?.localMunicipalityId) === lmPcode);
    });
  }

  watch("Batch", batchId, [doc(db, "tc_uploads", batchId)], (values) => {
    state.batch = values[0] || null;
    if (!state.batch) {
      parentError = "";
      for (const key of [...groups.keys()]) if (key !== "Batch") stop(key);
      state.wards = []; state.wardGeofences = []; state.rows = []; state.erfById = {}; state.premiseById = {}; state.meterById = {}; state.geofence = null; state.geofences = [];
      return;
    }
    const batch = state.batch;
    parentError = !batch.contractVersion
      ? "The selected batch is not a TRN BGO batch."
      : (batch.lmPcode || batch.scope?.lmPcode) !== lmPcode ? "This batch does not belong to the active Local Municipality workbase." : "";
    if (parentError) {
      for (const key of [...groups.keys()]) if (key !== "Batch") stop(key);
      state.wards = []; state.wardGeofences = []; state.rows = []; state.erfById = {}; state.premiseById = {}; state.meterById = {}; state.geofence = null; state.geofences = [];
      return;
    }
    watch("Ward boundaries", lmPcode, [query(collection(db, "wards"), where("parents.localMunicipalityId", "==", lmPcode))], values => { state.wards = values; });
    const wardPcode = batch.scope?.wardPcode || batch.wardPcode || "";
    watch("Ward geofences", wardPcode, wardPcode ? [query(collection(db, "geo_fences"), where("parents.lmPcode", "==", lmPcode))] : [], values => {
      state.wardGeofences = values.filter(fence => fence.parents?.wardPcode === wardPcode);
    });
    watch("Rows", batchId, [query(collection(db, "tc_rows"), where("tcId", "==", batchId))], (rows) => {
      state.rows = rows;
      syncAssets();
    });

  });

  return () => {
    active = false;
    for (const key of [...groups.keys()]) stop(key);
  };
}
